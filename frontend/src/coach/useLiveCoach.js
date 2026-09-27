// The live coaching loop: camera → pose + ball → tracking quality → skill phases → rules → cue
// scheduler → voice. Runs entirely in the browser; the server only gets measurements at the end,
// or with a question. State for the UI is published ~6 times a second, not every frame.
import { useCallback, useEffect, useRef, useState } from 'react'
import { RULES } from './config'
import { BallTracker, body, frameQuality, LegLength, PoseSmoother } from './tracking'
import { createBallFinder, createLumaMeter, detectPose, feetRoi, loadVision } from './vision'
import { createShootingDetector } from './skills/shooting'
import { createDribblingDetector } from './skills/dribbling'
import { createCueScheduler } from './feedback'
import { evaluateAttempt } from './rules'
import { createVoice, recordQuestion } from './voice'
import { drawOverlay } from './overlay'
import { createBallAlert, isBallAlert, playChime } from './alerts'
import { contactStats, createContactCoach } from './contact'

let visionPromise = null   // models are loaded (and benchmarked) once per page, then reused
const getVision = (video) => (visionPromise ??= loadVision(video).catch((e) => { visionPromise = null; throw e }))
const CRITICAL_PHASES = ['approach', 'plant', 'follow_through', 'dribbling', 'lost_control']
const FRAME_BUDGET_MS = 45       // above this, search for the ball every other frame outside critical phases

const UI_INTERVAL_MS = 160
const LIVE_HINT_AFTER_MS = 3000     // a tracking problem must persist this long before it's spoken
const LIVE_HINT_ISSUES = ['no_person', 'dark', 'feet_out', 'facing_camera', 'no_ball']
const SPOKEN_LIVE_HINTS = LIVE_HINT_ISSUES.filter((i) => i !== 'no_ball')   // a missing ball gets a chime instead
const CHIME_SPACING_MS = 3000

async function postJson(path, body) {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`)
  return data
}

/**
 * Start playback. Browsers pause muted, video-only media in background tabs to save power; if that
 * happens we wait until the tab is visible again instead of failing.
 */
async function playWhenVisible(video, onWaiting) {
  for (let tries = 0; tries < 20; tries++) {
    try {
      await video.play()
      return
    } catch (e) {
      if (e.name === 'NotAllowedError') throw e
      onWaiting?.()
      await new Promise((resolve) => {
        if (document.visibilityState === 'visible') setTimeout(resolve, 1000)
        else document.addEventListener('visibilitychange', resolve, { once: true })
      })
    }
  }
  throw new Error('The video could not start. Keep this tab in the foreground and try again.')
}

/** Attempts in the shape the server accepts (numbers only). */
const forServer = (attempts) => attempts.map((a) => ({
  measurements: a.measurements, quality: a.quality,
  ...(a.contact ? { contact: { zone: a.contact.zone ?? null, target: a.contact.target ?? null, conf: a.contact.conf ?? 0, reason: a.contact.reason ?? null } } : {}),
}))

export default function useLiveCoach() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const loop = useRef(null)        // everything the per-frame loop needs, kept out of React state
  const voiceRef = useRef(null)
  const [status, setStatus] = useState('idle')          // idle | loading | running | ending | ended | error
  const [error, setError] = useState(null)
  const [live, setLive] = useState({ phase: 'setup', quality: null, fps: 0 })
  const [attempts, setAttempts] = useState([])
  const [cues, setCues] = useState([])
  const [summary, setSummary] = useState(null)
  const [voiceState, setVoiceState] = useState({ speaking: false, recording: false, answering: false })
  const [capabilities, setCapabilities] = useState(null)
  const [chat, setChat] = useState([])

  // Voice + server capabilities.
  useEffect(() => {
    voiceRef.current = createVoice({ onSpeakingChange: (speaking) => setVoiceState((s) => ({ ...s, speaking })) })
    fetch('/api/coach/status').then((r) => r.json()).then((caps) => {
      setCapabilities(caps)
      voiceRef.current.setServerVoice(!!caps.tts)
    }).catch(() => setCapabilities({ llm: false, tts: false, stt: false, offline: true }))
    return () => voiceRef.current?.stop()
  }, [])

  // Keep the scheduler silent while anyone is talking.
  useEffect(() => {
    loop.current?.scheduler.setBusy(voiceState.speaking || voiceState.recording || voiceState.answering)
  }, [voiceState])

  // The latest cue is also shown as a banner on the preview for a few seconds.
  const [banner, setBanner] = useState(null)
  const bannerTimer = useRef(null)
  // Sound on/off (the app's mute setting) covers both speech and alert chimes.
  const mutedRef = useRef(false)
  const lastChimeRef = useRef(-Infinity)
  const chime = useCallback((now) => {
    if (mutedRef.current || now - lastChimeRef.current < CHIME_SPACING_MS) return
    lastChimeRef.current = now
    playChime()
  }, [])

  // Boot zones to highlight: set by a cue about where to contact the ball, cleared after a while.
  const [zoneCue, setZoneCue] = useState(null)
  // Shooting: the latest shot's contact area vs the target ({ target, detected, status, conf }).
  const [lastContact, setLastContact] = useState(null)
  const zoneTimer = useRef(null)

  const say = useCallback((cue) => {
    setCues((c) => [{ ...cue, at: Date.now(), silent: isBallAlert(cue) }, ...c].slice(0, 30))
    if (cue.zones?.length) {
      setZoneCue({ zones: cue.zones, text: cue.text })
      clearTimeout(zoneTimer.current)
      zoneTimer.current = setTimeout(() => setZoneCue(null), 10000)
    }
    setBanner(cue)
    clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(null), 6000)
    if (isBallAlert(cue)) chime(performance.now())        // ball not visible: short chime + on-screen text, no speech
    else voiceRef.current?.speak(cue.text)
  }, [chime])

  const stopLoop = useCallback(() => {
    const l = loop.current
    if (!l) return
    l.running = false
    if (l.frameHandle && videoRef.current?.cancelVideoFrameCallback) videoRef.current.cancelVideoFrameCallback(l.frameHandle)
    if (l.raf) cancelAnimationFrame(l.raf)
    l.stream?.getTracks().forEach((t) => t.stop())      // camera off
    if (l.fileUrl) URL.revokeObjectURL(l.fileUrl)
    const v = videoRef.current
    if (v) { v.onpause = null; v.pause(); v.srcObject = null; v.removeAttribute('src') }
  }, [])

  useEffect(() => () => stopLoop(), [stopLoop])

  const start = useCallback(async ({ skill, kickingFoot = 'auto', shotType = 'driven', file = null }) => {
    setError(null)
    setSummary(null)
    setAttempts([])
    setCues([])
    setChat([])
    setLastContact(null)
    setStatus('loading')
    const video = videoRef.current
    let stream = null
    let fileUrl = null
    try {
      if (file) {
        fileUrl = URL.createObjectURL(file)                       // stays in this browser tab
        video.srcObject = null
        video.src = fileUrl
        video.loop = true
        video.muted = true
      } else {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access (use Chrome, Edge or Safari over localhost/https).')
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        video.srcObject = stream
      }
      await playWhenVisible(video, () => setError('Waiting for this tab to be in the foreground…'))
      setError(null)
      // If the browser pauses the stream later (tab hidden), resume when it's visible again.
      video.onpause = () => {
        if (loop.current?.running) playWhenVisible(video).then(scheduleFrame).catch(() => {})
      }
      const vision = await getVision(video)
      let sessionId = null
      try {
        sessionId = (await postJson('/coach/sessions', { skill, kicking_foot: kickingFoot, source: file ? 'file' : 'camera' })).session_id
      } catch { /* backend unreachable: coaching still works, the summary is built locally */ }

      loop.current = {
        running: true, skill, sessionId, stream, fileUrl, vision,
        detector: skill === 'shooting' ? createShootingDetector({ rules: RULES, kickingFoot }) : createDribblingDetector({ rules: RULES }),
        scheduler: createCueScheduler(RULES, skill),
        smoother: new PoseSmoother(), tracker: new BallTracker(), legs: new LegLength(),
        findBall: createBallFinder(vision.ball), luma: createLumaMeter(),
        lastTs: 0, lastUi: 0, lastLumaAt: 0, lumaValue: null, frames: 0, fpsSince: performance.now(), fps: 0,
        poseMs: vision.info.poseMs, ballMs: vision.info.ballMs, frameNo: 0,
        trail: [], issueSince: {}, attempts: [], ballAlert: createBallAlert(),
        contactCoach: skill === 'shooting' ? createContactCoach(RULES, shotType) : null,
      }
      setStatus('running')
      // Say which part of the boot to strike with before the first shot.
      if (loop.current.contactCoach) {
        say({ key: 'instruction', kind: 'instruction', text: loop.current.contactCoach.instruction, zones: [loop.current.contactCoach.target] })
      }
      scheduleFrame()
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop())
      if (fileUrl) URL.revokeObjectURL(fileUrl)
      setStatus('error')
      setError(e.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in the browser bar and try again.'
        : e.message || String(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function scheduleFrame() {
    const l = loop.current
    const video = videoRef.current
    if (!l?.running || !video) return
    if (video.requestVideoFrameCallback) l.frameHandle = video.requestVideoFrameCallback(processFrame)
    else l.raf = requestAnimationFrame(processFrame)
  }

  function processFrame() {
    const l = loop.current
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!l?.running || !video || !canvas) return
    if (video.readyState < 2 || !video.videoWidth) { scheduleFrame(); return }
    const nowMs = performance.now()
    const ts = Math.max(nowMs, l.lastTs + 1)     // MediaPipe needs strictly increasing timestamps
    l.lastTs = ts
    const t = ts / 1000
    const width = video.videoWidth, height = video.videoHeight

    let lm = null, world = null, ball = null, roi = null
    try {
      let t0 = performance.now()
      const raw = detectPose(l.vision.pose, video, ts)
      l.poseMs = 0.8 * l.poseMs + 0.2 * (performance.now() - t0)
      lm = raw ? l.smoother.smooth(raw.lm, t) : null
      world = raw?.world ?? null
      const b = lm ? body(lm) : null
      const legLength = b ? l.legs.update(b.legLength) : null
      roi = feetRoi(b, legLength, width, height)
      // Ball search is the expensive part: on slow devices skip every other frame (the tracker
      // predicts in between), except around shots and touches, where every frame matters.
      l.frameNo += 1
      const critical = CRITICAL_PHASES.includes(l.detector.phase)
      if (critical || l.poseMs + l.ballMs < FRAME_BUDGET_MS || l.frameNo % 2 === 0) {
        t0 = performance.now()
        const detections = l.findBall(video, ts, roi)
        l.ballMs = 0.8 * l.ballMs + 0.2 * (performance.now() - t0)
        ball = l.tracker.update(detections, t)
      } else {
        ball = l.tracker.update([], t)
      }
    } catch (e) {
      console.warn('[coach] vision error, skipping frame', e)
    }
    if (nowMs - l.lastLumaAt > 500) { l.lumaValue = l.luma(video); l.lastLumaAt = nowMs }
    const quality = frameQuality({ lm, ball, width, height, luma: l.lumaValue, skill: l.skill, rules: RULES })

    // Skill phases → attempts → rules → cue.
    const out = l.detector.update({ t, lm, world, ball, quality })
    if (out.attempt) {
      const attempt = { ...out.attempt, at: Date.now() }
      // Shooting: which part of the boot met the ball, against the target for this shot type.
      const contactFb = l.contactCoach && out.attempt.skill === 'shooting' ? l.contactCoach.assess(out.attempt.contact) : null
      if (contactFb) {
        attempt.contact = { ...(attempt.contact ?? {}), target: contactFb.target, status: contactFb.status }
        attempt.contactFeedback = contactFb
        setLastContact(contactFb)
      }
      const { result, cue } = l.scheduler.onAttempt(attempt, nowMs, contactFb)
      attempt.result = result
      l.attempts.push(attempt)
      setAttempts([...l.attempts])
      if (cue) say(cue)
    }
    const deferred = l.scheduler.tick(nowMs)
    if (deferred) say(deferred)

    // Persistent setup problems between attempts get a (rate-limited) spoken hint.
    const idle = out.phase === 'setup'
    for (const issue of LIVE_HINT_ISSUES) {
      if (quality.issues.includes(issue)) l.issueSince[issue] ??= nowMs
      else delete l.issueSince[issue]
    }
    const persistent = SPOKEN_LIVE_HINTS.find((i) => l.issueSince[i] && nowMs - l.issueSince[i] > LIVE_HINT_AFTER_MS)
    if (idle && persistent) {
      const cue = l.scheduler.onTrackingProblem(persistent, nowMs)
      if (cue) say(cue)
    }
    // Ball missing for a while: debounced chime (never spoken), on-screen note, respects mute.
    const ballMissing = !!l.issueSince.no_ball && nowMs - l.issueSince.no_ball > LIVE_HINT_AFTER_MS && !!lm
    if (l.ballAlert.update({ now: nowMs, ballMissing, muted: mutedRef.current })) {
      chime(nowMs)
      setBanner({ key: 'tracking:no_ball', kind: 'tracking', text: RULES.tracking.messages.no_ball })
      clearTimeout(bannerTimer.current)
      bannerTimer.current = setTimeout(() => setBanner(null), 4000)
    }

    // Overlay.
    if (ball?.detected) {
      l.trail.push({ x: ball.x, y: ball.y, t })
    }
    l.trail = l.trail.filter((p) => t - p.t < 0.8)
    if (canvas.width !== width) { canvas.width = width; canvas.height = height }
    drawOverlaySafe(canvas, { width, height, lm, ball, trail: l.trail, roi, highlight: l.detector.plant ?? null })

    // FPS + throttled UI state.
    l.frames += 1
    if (nowMs - l.fpsSince > 1000) { l.fps = Math.round((l.frames * 1000) / (nowMs - l.fpsSince)); l.frames = 0; l.fpsSince = nowMs }
    if (nowMs - l.lastUi > UI_INTERVAL_MS) {
      l.lastUi = nowMs
      setLive({ phase: out.phase, quality: { ...quality, luma: l.lumaValue }, fps: l.fps,
        perf: { ...l.vision.info, poseMs: Math.round(l.poseMs), ballMs: Math.round(l.ballMs) } })
    }
    scheduleFrame()
  }

  const end = useCallback(async () => {
    const l = loop.current
    stopLoop()
    voiceRef.current?.stop()
    if (!l) return
    setStatus('ending')
    try {
      if (l.sessionId == null) throw new Error('offline')
      const s = await postJson(`/coach/sessions/${l.sessionId}/end`, { attempts: forServer(l.attempts) })
      setSummary({ ...s, source: 'server' })
      if (s.narrative) voiceRef.current?.speak(s.narrative, { cache: false })
    } catch {
      setSummary({ ...localSummary(l.skill, l.attempts), source: 'local' })
    }
    setStatus('ended')
  }, [stopLoop])

  /** Ask by text, or by voice when `audio` is a recorded Blob. */
  const ask = useCallback(async ({ text = '', audio = null }) => {
    const l = loop.current
    const skill = l?.skill ?? 'shooting'
    setVoiceState((s) => ({ ...s, answering: true }))
    try {
      const form = new FormData()
      form.append('skill', skill)
      form.append('attempts_json', JSON.stringify(forServer(l?.attempts ?? []).slice(-20)))
      form.append('question', text)
      if (audio) form.append('audio', audio, 'question.webm')
      const res = await fetch('/api/coach/ask', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`)
      setChat((c) => [...c, { q: data.question, a: data.answer, source: data.source }])
      await voiceRef.current?.speak(data.answer, { cache: false })
    } catch (e) {
      setChat((c) => [...c, { q: text || '(spoken question)', a: e.message, source: 'error' }])
    } finally {
      setVoiceState((s) => ({ ...s, answering: false }))
    }
  }, [])

  const recorder = useRef(null)
  const startRecording = useCallback(async () => {
    voiceRef.current?.stop()
    try {
      recorder.current = await recordQuestion()
      setVoiceState((s) => ({ ...s, recording: true }))
    } catch (e) {
      setChat((c) => [...c, { q: '(microphone)', a: e.name === 'NotAllowedError'
        ? 'Microphone permission was denied. You can type your question instead.' : e.message, source: 'error' }])
    }
  }, [])
  const stopRecording = useCallback(async () => {
    if (!recorder.current) return
    const blob = await recorder.current.stop()
    recorder.current = null
    setVoiceState((s) => ({ ...s, recording: false }))
    if (blob.size > 1000) await ask({ audio: blob })
  }, [ask])

  return {
    videoRef, canvasRef, status, error, live, attempts, cues, banner, summary, capabilities, chat, voiceState, zoneCue, lastContact,
    contactTarget: loop.current?.contactCoach?.target ?? null,
    footSide: footSideOf(attempts),
    start, end, ask, startRecording, stopRecording,
    setSoundEnabled: (on) => { mutedRef.current = !on; voiceRef.current?.setEnabled(on) },
    reset: () => { setStatus('idle'); setSummary(null) },
  }
}

// Keeps the loop alive if drawing ever throws.
function drawOverlaySafe(canvas, args) {
  try { drawOverlay(canvas.getContext('2d'), args) } catch (e) { console.warn('[coach] overlay error', e) }
}

/** Minimal summary if the backend can't be reached: cue counts from the same rules. */
function localSummary(skill, attempts) {
  const counts = {}
  const withheld = {}
  for (const a of attempts) {
    const r = a.result ?? evaluateAttempt(skill, a.measurements, RULES)
    for (const c of r.corrections) counts[c.key] = (counts[c.key] ?? 0) + 1
    for (const w of r.withheld) withheld[w.reason] = (withheld[w.reason] ?? 0) + 1
  }
  const cues = RULES.skills[skill].cues
  return {
    skill, attempts: attempts.length, strengths: [],
    corrections: Object.entries(counts).map(([key, count]) => ({ key, count, text: cues.find((c) => c.key === key).text,
      evidence: `Seen on ${count} of ${attempts.length} ${RULES.skills[skill].attempt_noun}.` })),
    limitations: [
      ...Object.entries(withheld).map(([r, n]) => `${RULES.tracking.labels[r] ?? r} on ${n} of ${attempts.length}.`),
      'The server was unreachable, so this is a basic summary.',
    ],
    narrative: null,
    drills: [],
    drills_note: 'Drill suggestions need the server. Reconnect and try another session.',
    contact: contactStats(attempts),
  }
}

/** Which boot to draw: the kicking foot of the last shot, or the foot used most while dribbling. */
function footSideOf(attempts) {
  const a = attempts[attempts.length - 1]
  if (!a) return 'right'
  if (a.kicking_foot) return a.kicking_foot
  if (a.touches_by_foot) return a.touches_by_foot.left > a.touches_by_foot.right ? 'left' : 'right'
  return 'right'
}
