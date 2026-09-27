// Live Skills Coach tab: pick a skill → camera preview with tracking overlay → spoken hints →
// ask the coach → end-of-session summary. Separate from the player-analysis pages and data.
import { useRef, useState } from 'react'
import useLiveCoach from '../coach/useLiveCoach'
import { RULES, skillRules } from '../coach/config'
import { formatMeasure } from '../coach/rules'
import { InfoTip, Section, Segmented } from '../components/ui'
import BootZones from '../components/BootZones'

const PHASE_LABELS = {
  setup: 'Ready', approach: 'Approach', plant: 'Plant & swing', follow_through: 'Follow-through', recovery: 'Recovering',
  dribbling: 'Dribbling', lost_control: 'Ball got away',
}
const SKILL_ICONS = { shooting: '🥅', dribbling: '⚽' }

export default function LiveCoach() {
  const coach = useLiveCoach()
  const [skill, setSkill] = useState('shooting')
  const [kickingFoot, setKickingFoot] = useState('auto')
  const [shotType, setShotType] = useState('driven')
  const [voiceOn, setVoiceOn] = useState(true)
  const fileInput = useRef(null)
  const running = coach.status === 'running'
  const busy = coach.status === 'loading' || coach.status === 'ending'

  const start = (file = null) => coach.start({ skill, kickingFoot, shotType, file })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Live Skills Coach</h1>
        <p className="text-muted mt-1">Practise shooting or dribbling in front of your camera and get short spoken hints.</p>
        <p className="text-xs text-muted mt-2">🔒 Video stays in your browser and is never recorded or uploaded. Only measurements
          (numbers) go to the server when you end a session or ask a question.</p>
      </div>

      {coach.status === 'ended' && coach.summary ? (
        <SummaryView summary={coach.summary} onRestart={coach.reset} />
      ) : (
        <>
          {!running && !busy && (
            <SetupPanel skill={skill} setSkill={setSkill} kickingFoot={kickingFoot} setKickingFoot={setKickingFoot}
              shotType={shotType} setShotType={setShotType}
              voiceOn={voiceOn} setVoiceOn={(v) => { setVoiceOn(v); coach.setSoundEnabled(v) }}
              capabilities={coach.capabilities} error={coach.error}
              onCamera={() => start()} onFile={() => fileInput.current?.click()} />
          )}
          <input ref={fileInput} type="file" accept="video/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) start(f); e.target.value = '' }} />

          <div className={`grid gap-6 ${running || busy ? 'lg:grid-cols-[1fr_380px]' : ''}`}>
            <div className="space-y-3">
              {busy && coach.error && <p className="text-sm text-yellow-300">{coach.error}</p>}
              <Preview videoRef={coach.videoRef} canvasRef={coach.canvasRef} status={coach.status} live={coach.live}
                banner={coach.banner} skill={skill} />
              {running && <TrackingStatus quality={coach.live.quality} skill={skill} />}
            </div>
            {(running || busy) && (
              <aside className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={coach.end} disabled={!running}
                    className="rounded-xl bg-accent text-black font-semibold px-5 py-2.5 disabled:opacity-50">
                    {coach.status === 'ending' ? 'Summarising…' : 'End session'}
                  </button>
                  <button type="button" onClick={() => { setVoiceOn(!voiceOn); coach.setSoundEnabled(!voiceOn) }} aria-pressed={!voiceOn}
                    className="rounded-xl border border-line px-4 py-2.5 text-sm text-muted hover:text-white">
                    {voiceOn ? '🔊 Sound on' : '🔇 Muted'}
                  </button>
                </div>
                <Section title="Contact area" explain={coach.contactTarget ? 'Target part of the boot, and the part you used on your last shot.' : 'Where the latest hint wants you to strike the ball.'}
                  info="The part of the boot that met the ball is estimated from which way your kicking foot points at contact (3D pose) and how far the toes point down. It's an estimate from one camera: it's withheld when the foot isn't clear, and it works best side-on with your feet in view.">
                  <BootZones zones={coach.zoneCue?.zones} cueText={null} foot={coach.footSide}
                    target={coach.contactTarget} last={coach.lastContact} />
                </Section>
                <CuePanel cues={coach.cues} onWhy={(cue) => coach.ask({ text: `Why did you say: "${cue.text}"?` })} />
                <LastAttempt attempts={coach.attempts} skill={skill} />
                <AskCoach coach={coach} />
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SetupPanel({ skill, setSkill, kickingFoot, setKickingFoot, shotType, setShotType, voiceOn, setVoiceOn, capabilities, error, onCamera, onFile }) {
  const cfg = skillRules(skill)
  return (
    <Section title="1. Choose a skill" explain="The coach watches your body and the ball and speaks one short hint at a time.">
      <div className="grid sm:grid-cols-2 gap-3">
        {Object.entries(RULES.skills).map(([key, s]) => (
          <button key={key} type="button" onClick={() => setSkill(key)} aria-pressed={skill === key}
            className={`text-left rounded-2xl border p-4 transition ${skill === key ? 'border-accent bg-accent/10' : 'border-line hover:border-muted'}`}>
            <p className="text-2xl">{SKILL_ICONS[key]}</p>
            <p className="font-semibold mt-1">{s.label}</p>
            <p className="text-xs text-muted mt-1">Checks: {[...(s.shot_types ? ['part of the boot that met the ball (vs your target)'] : []),
              ...Object.values(s.measurements).map((m) => m.label.toLowerCase())].join(' · ')}</p>
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <div>
          <p className="text-sm font-semibold mb-2">Camera setup</p>
          <ul className="space-y-1.5 text-sm text-gray-300 list-disc pl-5">{cfg.setup_tips.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div className="space-y-4">
          {skill === 'shooting' && (
            <div className="text-sm">
              <span className="block text-xs text-muted mb-1">Shot type (which part of the boot to strike with)</span>
              <Segmented size="md" value={shotType} onChange={setShotType}
                options={Object.entries(cfg.shot_types).map(([k, t]) => ({ value: k, label: `${t.label}: ${RULES.zones[t.zone].split(' (')[0].toLowerCase()}` }))} />
              <p className="text-xs text-muted mt-1">{cfg.shot_types[shotType].instruction} After each shot the coach says which part you used.</p>
            </div>
          )}
          {skill === 'shooting' && (
            <div className="text-sm">
              <span className="block text-xs text-muted mb-1">Kicking foot</span>
              <Segmented size="md" value={kickingFoot} onChange={setKickingFoot}
                options={[{ value: 'auto', label: 'Detect' }, { value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }]} />
            </div>
          )}
          <div className="text-sm flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} className="accent-[#c6ff3d]" />
              Sound (spoken hints and a soft chime when the ball is lost)
            </label>
            <VoiceBadge capabilities={capabilities} />
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onCamera} className="rounded-xl bg-accent text-black font-semibold px-5 py-3">
              📷 Start camera
            </button>
            <button type="button" onClick={onFile} className="rounded-xl border border-line px-5 py-3 text-sm hover:border-muted">
              Use a video file
            </button>
          </div>
          <p className="text-xs text-muted">Your browser will ask for camera permission. The microphone is only requested if you
            use “Hold to ask”. A video file is analysed in this tab and never uploaded.</p>
          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
      </div>
    </Section>
  )
}

function VoiceBadge({ capabilities }) {
  if (!capabilities) return null
  const text = capabilities.tts ? 'AI voice' : 'Browser voice (AI voice unavailable)'
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full border border-line text-muted flex items-center gap-1">
      {text}
      <InfoTip text={`Spoken hints: ${capabilities.tts ? 'server AI voice (key stays on the server), falling back to your browser’s voice' : 'your browser’s built-in voice'}. Questions: ${capabilities.stt ? 'spoken or typed' : 'typed only'}. Answers: ${capabilities.llm ? 'AI coach using your measurements' : 'rule-based (AI unavailable)'}. Tracking and on-screen cues work either way.`} />
    </span>
  )
}

function Preview({ videoRef, canvasRef, status, live, banner, skill }) {
  return (
    <div className="relative rounded-2xl overflow-hidden bg-black border border-line">
      <video ref={videoRef} playsInline muted className="w-full h-auto block" />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      {status !== 'running' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <p className="text-muted text-sm text-center px-6">
            {status === 'loading' ? 'Starting camera and loading tracking models (first time takes a few seconds)…'
              : status === 'ending' ? 'Ending session…' : 'Camera preview appears here.'}
          </p>
        </div>
      )}
      {status === 'idle' && <div className="aspect-video" />}
      {status === 'running' && (
        <>
          <div className="absolute top-3 left-3 flex gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-black/70 text-accent">{skillRules(skill).label}</span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-black/70">{PHASE_LABELS[live.phase] ?? live.phase}</span>
          </div>
          <span className="absolute top-3 right-3 text-[11px] px-2 py-1 rounded-full bg-black/70 text-muted"
            title={live.perf ? `Pose: ${live.perf.poseModel} model on ${live.perf.poseDelegate} · ball detector on ${live.perf.ballDelegate}` : ''}>
            {live.fps} fps{live.perf ? ` · pose ${live.perf.poseMs} ms · ball ${live.perf.ballMs} ms` : ''}
          </span>
          {banner && (
            <div className={`absolute bottom-3 left-3 right-3 rounded-xl px-4 py-3 text-sm font-semibold backdrop-blur ${banner.kind === 'tracking'
              ? 'bg-yellow-300/90 text-black' : banner.kind === 'positive' ? 'bg-good/90 text-black' : 'bg-black/75 text-white'}`}>
              {banner.kind === 'tracking' ? '📷 ' : '💬 '}{banner.text}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Meter({ label, value, ok, note }) {
  const pct = Math.round((value ?? 0) * 100)
  return (
    <div className="min-w-0">
      <div className="flex justify-between text-xs"><span className="text-muted">{label}</span><span className={ok ? 'text-good' : 'text-yellow-300'}>{note ?? `${pct}%`}</span></div>
      <div className="h-1.5 rounded-full bg-surface-2 mt-1"><div className={`h-1.5 rounded-full ${ok ? 'bg-good' : 'bg-yellow-300'}`} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function TrackingStatus({ quality, skill }) {
  if (!quality) return null
  const light = quality.luma == null ? null : Math.min(1, quality.luma / 120)
  const issues = quality.issues.filter((i) => i !== 'low_pose' || quality.pose > 0)
  return (
    <div className="rounded-2xl bg-surface border border-line p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Meter label="Body" value={quality.pose} ok={quality.pose >= RULES.confidence.pose_min} />
        <Meter label="Ball" value={quality.ball} ok={quality.ball >= RULES.confidence.ball_min} />
        <Meter label="Light" value={light} ok={!quality.issues.includes('dark')} note={light == null ? '…' : quality.issues.includes('dark') ? 'too dark' : 'ok'} />
        {skill === 'shooting'
          ? <Meter label="Side-on view" value={quality.sideView ? 1 : quality.sideView === false ? 0.3 : 0} ok={quality.sideView === true}
              note={quality.sideView ? 'yes' : quality.sideView === false ? 'facing camera' : '…'} />
          : <Meter label="Feet in view" value={quality.feetVisible ? 1 : 0.2} ok={quality.feetVisible} note={quality.feetVisible ? 'yes' : 'no'} />}
      </div>
      {issues.length > 0 ? (
        <p className="text-xs text-yellow-300">⚠ {RULES.tracking.labels[issues[0]]}: {RULES.tracking.messages[issues[0]]} Specific corrections
          are withheld while tracking is unreliable.</p>
      ) : <p className="text-xs text-good">Tracking looks good.</p>}
    </div>
  )
}

function CuePanel({ cues, onWhy }) {
  return (
    <Section title="Coach" explain="One short hint per attempt at most."
      info="Hints come from explicit rules on measured positions and angles. Minor issues must repeat before they're mentioned, each hint has a cooldown, and nothing is said while you or the coach are talking.">
      {cues.length === 0 ? <p className="text-sm text-muted">No hints yet. Have a go!</p> : (
        <ul className="space-y-2">
          {cues.slice(0, 5).map((c, i) => (
            <li key={`${c.key}-${c.at}`} className={`text-sm flex gap-2 items-start ${i ? 'text-muted' : ''}`}>
              <span>{c.silent ? '🔔' : c.kind === 'tracking' ? '📷' : c.kind === 'positive' ? '✅' : '💬'}</span>
              <span className="flex-1">{c.text}</span>
              {i === 0 && c.kind === 'correction' && (
                <button type="button" onClick={() => onWhy(c)} className="text-xs text-accent hover:underline shrink-0">Why?</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function LastAttempt({ attempts, skill }) {
  const a = attempts[attempts.length - 1]
  const defs = skillRules(skill).measurements
  const noun = skillRules(skill).attempt_noun
  return (
    <Section title={`Last attempt${a ? ` · ${attempts.length} ${noun}` : ''}`} explain="Measured from the video; confidence shown for each."
      info="Distances are in leg lengths (hip to ankle), measured in the image. No speed, power or accuracy is measured.">
      {!a ? <p className="text-sm text-muted">Waiting for a complete {skill === 'shooting' ? 'shot' : 'run'}…</p> : (
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(defs).map(([key, d]) => {
              const m = a.measurements[key]
              if (!m) return null
              const flagged = a.result?.corrections.some((c) => c.measure === key)
              return (
                <tr key={key} className="border-b border-line/50 align-top">
                  <td className="py-1.5 pr-2 text-muted">{d.label}</td>
                  <td className="py-1.5 text-right">
                    {m.value == null
                      ? <span className="text-xs text-yellow-300">withheld: {(RULES.tracking.labels[m.reason] ?? 'low confidence').toLowerCase()}</span>
                      : <span className={flagged ? 'text-yellow-300' : ''}>{formatMeasure(m.value, d)}</span>}
                    <span className="block text-[10px] text-muted">{Math.round((m.conf ?? 0) * 100)}% confidence</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {a?.contactFeedback && (
        <p className="text-xs mt-2">
          <span className="text-muted">Contact area: </span>
          {a.contactFeedback.status === 'unclear'
            ? <span className="text-yellow-300">not judged ({a.contactFeedback.text.toLowerCase().replace(/\.$/, '')})</span>
            : <span className={a.contactFeedback.status === 'correct' ? 'text-good' : 'text-orange-400'}>
                {RULES.zones[a.contactFeedback.detected] ?? 'Side of the foot'}, {a.contactFeedback.status === 'correct' ? 'correct' : `target was ${(RULES.zones[a.contactFeedback.target] ?? '').toLowerCase()}`}
              </span>}
          <span className="text-muted"> · {Math.round((a.contactFeedback.conf ?? 0) * 100)}% confidence</span>
        </p>
      )}
      {a?.ball_path && <p className="text-xs text-muted mt-2">Ball path in the image: {a.ball_path} (direction only, not a speed).</p>}
      {a?.contact_source === 'estimated' && <p className="text-xs text-yellow-300 mt-2">Contact moment estimated: the ball wasn't visible.</p>}
    </Section>
  )
}

function AskCoach({ coach }) {
  const [text, setText] = useState('')
  const { voiceState, capabilities, chat } = coach
  const submit = (e) => {
    e.preventDefault()
    if (!text.trim()) return
    coach.ask({ text: text.trim() })
    setText('')
  }
  return (
    <Section title="Ask the coach" explain="Answers use only what was measured this session.">
      <div className="flex gap-2">
        {capabilities?.stt && (
          <button type="button"
            onPointerDown={coach.startRecording} onPointerUp={coach.stopRecording} onPointerLeave={() => voiceState.recording && coach.stopRecording()}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold select-none touch-none ${voiceState.recording ? 'bg-bad text-white' : 'bg-surface-2 border border-line hover:border-muted'}`}>
            {voiceState.recording ? '● Listening…' : '🎙 Hold to ask'}
          </button>
        )}
        <form onSubmit={submit} className="flex-1 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type a question…" maxLength={400}
            className="flex-1 min-w-0 rounded-xl bg-surface-2 border border-line focus:border-accent outline-none px-3 py-2 text-sm" />
        </form>
      </div>
      {voiceState.answering && <p className="text-xs text-muted mt-2">Thinking…</p>}
      <ul className="mt-3 space-y-3 max-h-64 overflow-y-auto">
        {[...chat].reverse().map((c, i) => (
          <li key={i} className="text-sm">
            <p className="text-muted">You: {c.q}</p>
            <p className={c.source === 'error' ? 'text-bad' : 'text-gray-200'}>Coach: {c.a}
              {c.source === 'rules' && <span className="text-[10px] text-muted"> (rule-based, AI unavailable)</span>}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** Contact area over the session: target part of the boot, how often it was hit, what else was used. */
function ContactSummary({ contact }) {
  const others = Object.entries(contact.zones).filter(([z]) => z !== contact.target).sort((a, b) => b[1] - a[1])
  const notJudged = contact.shots - contact.judged
  return (
    <Section title="Contact area" explain="Which part of the boot met the ball, against the target for this shot type."
      info="Estimated from which way the kicking foot points at contact and how far the toes point down. Shots where the foot wasn't clear aren't judged.">
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <p className="text-xs text-muted">Target</p>
          <p className="font-semibold">{RULES.zones[contact.target] ?? contact.target}</p>
        </div>
        <div>
          <p className="text-xs text-muted">On target</p>
          <p className="font-semibold">
            {contact.judged ? <>{contact.correct} of {contact.judged} judged shots</> : 'No shot could be judged'}
          </p>
        </div>
        {others.length > 0 && (
          <div>
            <p className="text-xs text-muted">Also used</p>
            <p className="font-semibold text-orange-400">{others.map(([z, n]) => `${RULES.zones[z] ?? 'Side of the foot'} (${n})`).join(', ')}</p>
          </div>
        )}
        {notJudged > 0 && <p className="text-xs text-yellow-300">Not judged on {notJudged} of {contact.shots} (foot not clear at contact).</p>}
      </div>
    </Section>
  )
}

function SummaryView({ summary, onRestart }) {
  const cfg = skillRules(summary.skill)
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-accent font-semibold">{cfg.label} session</p>
          <h2 className="text-2xl font-bold">{summary.attempts} {cfg.attempt_noun} analysed</h2>
        </div>
        <button type="button" onClick={onRestart} className="rounded-xl bg-accent text-black font-semibold px-5 py-2.5">New session</button>
      </div>
      {summary.narrative && (
        <div className="rounded-2xl bg-surface border border-line p-5 text-gray-200 leading-relaxed">💬 {summary.narrative}</div>
      )}
      {summary.contact && <ContactSummary contact={summary.contact} />}
      <div className="grid lg:grid-cols-3 gap-6">
        <Section title="Strengths" explain="In the target range on most attempts.">
          {summary.strengths.length ? (
            <ul className="space-y-3">{summary.strengths.map((s) => <li key={s.measure} className="text-sm flex gap-2"><span className="text-good">✓</span>{s.text}</li>)}</ul>
          ) : <p className="text-sm text-muted">Nothing measured consistently enough to call a strength yet.</p>}
        </Section>
        <Section title="Corrections" explain="Issues that repeated, with the evidence.">
          {summary.corrections.length ? (
            <ul className="space-y-3">{summary.corrections.map((c) => (
              <li key={c.key} className="text-sm"><p className="font-semibold">{c.text}</p><p className="text-xs text-muted mt-0.5">{c.evidence}</p></li>
            ))}</ul>
          ) : <p className="text-sm text-muted">No repeated issues found in what could be measured.</p>}
        </Section>
        <Section title="Tracking limitations" explain="What couldn't be judged, and what is never measured.">
          <ul className="space-y-2">{summary.limitations.map((l) => <li key={l} className="text-sm text-gray-300 flex gap-2"><span className="text-yellow-300">⚠</span>{l}</li>)}</ul>
        </Section>
      </div>
      <Section title="Suggested drills" explain="Chosen from the issues this session actually measured.">
        {summary.drills?.length ? (
          <div className="grid md:grid-cols-2 gap-4">
            {summary.drills.map((d) => (
              <div key={d.name} className="rounded-xl bg-surface-2 p-4 space-y-2">
                <p className="font-semibold">{d.name}</p>
                <p className="text-xs text-muted">Needs: {d.needs.join(', ')} · {d.reps}</p>
                <p className="text-sm text-gray-300"><span className="text-muted">Setup: </span>{d.setup}</p>
                <p className="text-sm text-gray-300"><span className="text-muted">How: </span>{d.how}</p>
                <p className="text-sm"><span className="text-accent font-semibold">Why this drill: </span>{d.why} {d.because}</p>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted">{summary.drills_note ?? 'No drill suggested for this session.'}</p>}
      </Section>
      {summary.source === 'local' && <p className="text-xs text-muted">Built in the browser because the server was unreachable.</p>}
    </div>
  )
}
