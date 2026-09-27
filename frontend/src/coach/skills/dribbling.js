// Dribbling: runs, touches and close control from pose + ball tracks.
//
// Phases: setup → dribbling ⇄ lost_control → (run ends) → setup
//   dribbling     hips moving with the ball near the feet
//   lost_control  ball more than LOST_DIST leg lengths from the nearest foot for LOST_TIME seconds
// A run ends when the player stops (STOP_TIME), loses the body for a moment, or after RUN_WINDOW
// seconds of continuous dribbling (then the next window starts immediately).
//
// Measurements per run (distances in leg lengths from the nearest foot to the ball):
//   close_control_pct  share of ball-tracked time with the ball within CLOSE_DIST
//   touch_rate         touches per second (touch = foot near ball + ball suddenly sped up or redirected)
//   max_separation     95th percentile of the foot-ball distance
//   knee_bend          average knee bend while dribbling (degrees)
//   weak_foot_share    % of touches with the less-used foot (needs MIN_TOUCHES_FOR_FEET touches)
//   lost_control       number of times the ball got away
//   heavy_touch_pct    % of judged touches after which the ball ran more than HEAVY_DIST from the feet
//                      within HEAVY_WINDOW (needs the ball tracked through that window)
//   toe_touch_pct      % of judged touches where the ball met the toe end of the foot (needs heel and toe
//                      clearly visible and the foot seen side-on). Both need MIN_JUDGED touches.
// Dribbling speed and distance are never estimated (no calibration).
import { body, LegLength } from '../tracking'
import { alongFoot, dist, percentile } from '../geometry'

export const DRIB = {
  MOVE_SPEED: 0.35,          // hip speed (leg lengths / s) that counts as moving
  START_HOLD: 0.25,          // seconds of continuous movement to start a run (time-based: any frame rate)
  START_MAX_DIST: 2.0,       // ball must be this close when a run starts
  CLOSE_DIST: 1.0,
  TOUCH_DIST: 0.5,
  TOUCH_DV: 1.2,             // change in ball velocity (leg lengths / s) that marks a touch
  TOUCH_GAP: 0.2,            // seconds between touches (debounce)
  LOST_DIST: 1.8,
  LOST_TIME: 0.5,
  RECOVER_DIST: 1.2,
  STOP_TIME: 1.0,
  RUN_WINDOW: 8.0,
  MIN_RUN: 2.0,
  MIN_TRACKED_FRAC: 0.6,     // ball must be tracked for this share of the run to judge ball measures
  MIN_TOUCHES_FOR_FEET: 8,
  POSE_LOST_TIMEOUT: 0.7,
  HEAVY_DIST: 1.5,           // ball this far from the feet after a touch = heavy touch
  HEAVY_WINDOW: 0.6,         // seconds after a touch to watch for that
  HEAVY_MIN_TRACKED: 0.6,    // share of that window the ball must be tracked to judge it
  TOE_T: 0.85,               // contact point this far along heel→toe (0..1) or beyond = toe end
  MIN_FOOT_LENGTH: 0.15,     // heel→toe in leg lengths; shorter = foot turned toward the camera
  MIN_JUDGED: 4,             // judged touches needed before reporting touch quality
}

export function createDribblingDetector({ rules }) {
  const minConf = rules.confidence.measurement_min
  const legLength = new LegLength()
  let phase = 'setup'
  let run = null
  let prev = null
  let movingSince = null
  let lastPoseT = -Infinity
  let index = 0
  let ballPrev = null        // last detected ball sample, for velocity
  let ballVel = null

  const newRun = (t) => ({
    t0: t, frames: 0, ballFrames: 0, ballConfSum: 0, closeFrames: 0, seps: [], touches: [], lastTouchT: -Infinity,
    kneeSum: 0, kneeN: 0, poseVisSum: 0, lostEvents: 0, lostSince: null, lost: false, stillSince: null,
    pendingHeavy: [], heavyJudged: 0, heavyCount: 0, toeJudged: 0, toeCount: 0, toeVisSum: 0,
  })

  /** Close a heavy-touch window: judged only if the ball was tracked for most of it. */
  function settleHeavy(r, h) {
    if (h.frames && h.tracked / h.frames >= DRIB.HEAVY_MIN_TRACKED) {
      r.heavyJudged += 1
      if (h.maxSep > DRIB.HEAVY_DIST) r.heavyCount += 1
    }
  }

  function finishRun(t) {
    const r = run
    r.pendingHeavy.forEach((h) => settleHeavy(r, h))
    r.pendingHeavy = []
    run = null
    phase = 'setup'
    const duration = t - r.t0
    if (duration < DRIB.MIN_RUN || r.frames === 0) return null
    const tracked = r.ballFrames / r.frames
    const ballConf = r.ballFrames ? r.ballConfSum / r.ballFrames : 0
    const ballMeasureConf = tracked * ballConf
    const poseConf = r.poseVisSum / r.frames
    const m = {}
    const put = (key, value, conf, reason) => {
      m[key] = conf >= minConf && value != null && Number.isFinite(value)
        ? { value: +value.toFixed(3), conf: +conf.toFixed(2), reason: null }
        : { value: null, conf: +(conf || 0).toFixed(2), reason: reason ?? 'low_confidence' }
    }
    const ballOk = tracked >= DRIB.MIN_TRACKED_FRAC
    const ballReason = ballOk ? 'low_confidence' : 'ball_not_tracked'
    const ballConfOrZero = ballOk ? ballMeasureConf : 0
    put('close_control_pct', r.ballFrames ? (r.closeFrames / r.ballFrames) * 100 : null, ballConfOrZero, ballReason)
    put('touch_rate', r.touches.length / duration, ballConfOrZero, ballReason)
    put('max_separation', percentile(r.seps, 95), ballConfOrZero, ballReason)
    put('lost_control', r.lostEvents, ballConfOrZero, ballReason)
    put('knee_bend', r.kneeN ? r.kneeSum / r.kneeN : null, poseConf, 'low_pose')
    const left = r.touches.filter((x) => x.foot === 'left').length
    const right = r.touches.length - left
    if (r.heavyJudged >= DRIB.MIN_JUDGED) {
      put('heavy_touch_pct', (r.heavyCount / r.heavyJudged) * 100, ballConfOrZero, ballReason)
    } else {
      m.heavy_touch_pct = { value: null, conf: 0, reason: !ballOk ? 'ball_not_tracked' : 'not_enough_touches' }
    }
    if (r.toeJudged >= DRIB.MIN_JUDGED) {
      put('toe_touch_pct', (r.toeCount / r.toeJudged) * 100, Math.min(ballConfOrZero, r.toeVisSum / r.toeJudged), ballReason)
    } else {
      m.toe_touch_pct = { value: null, conf: 0,
        reason: !ballOk ? 'ball_not_tracked' : r.touches.length >= DRIB.MIN_JUDGED ? 'low_pose' : 'not_enough_touches' }
    }
    if (r.touches.length >= DRIB.MIN_TOUCHES_FOR_FEET) {
      put('weak_foot_share', (Math.min(left, right) / r.touches.length) * 100, ballConfOrZero, ballReason)
    } else {
      m.weak_foot_share = { value: null, conf: 0, reason: ballOk ? 'not_enough_touches' : 'ball_not_tracked' }
    }
    index += 1
    return {
      skill: 'dribbling', index, t: r.t0, duration: +duration.toFixed(2), touches: r.touches.length,
      touches_by_foot: { left, right }, measurements: m,
      quality: { pose: +poseConf.toFixed(2), ball: +ballConf.toFixed(2), ball_tracked: +tracked.toFixed(2) },
    }
  }

  /** frame = {t, lm (px, smoothed) | null, ball (tracker snapshot) | null, quality}. */
  function update(frame) {
    const out = { phase, attempt: null, event: null }
    const t = frame.t
    if (!frame.lm) {
      if (run && t - lastPoseT > DRIB.POSE_LOST_TIMEOUT) out.attempt = finishRun(lastPoseT)
      out.phase = phase
      return out
    }
    lastPoseT = t
    const b = body(frame.lm)
    const L = legLength.update(b.legLength)
    if (!L) return out

    let hipSpeed = 0
    if (prev && t > prev.t) {
      const raw = Math.abs(b.hip.x - prev.b.hip.x) / L / (t - prev.t)
      hipSpeed = 0.4 * raw + 0.6 * prev.hipSpeed
    }

    // Ball: nearest foot point and velocity change (from actual detections only).
    const ball = frame.ball && frame.ball.conf >= 0.4 ? frame.ball : null
    let footDist = null, nearestFoot = null, dv = 0, kicked = false
    if (ball) {
      for (const side of ['left', 'right']) {
        for (const p of [b[side].ankle, b[side].toe]) {
          const d = dist(p, ball) / L
          if (footDist === null || d < footDist) { footDist = d; nearestFoot = side }
        }
      }
      if (ball.detected) {
        if (ballPrev && t - ballPrev.t > 0 && t - ballPrev.t < 0.15) {
          const v = { x: (ball.x - ballPrev.x) / L / (t - ballPrev.t), y: (ball.y - ballPrev.y) / L / (t - ballPrev.t) }
          if (ballVel) {
            dv = Math.hypot(v.x - ballVel.x, v.y - ballVel.y)
            // A touch speeds the ball up or changes its direction. A ball slowing down or stopping by
            // itself also changes velocity, but that isn't a touch.
            const before = Math.hypot(ballVel.x, ballVel.y), after = Math.hypot(v.x, v.y)
            const cos = before > 0 && after > 0 ? (v.x * ballVel.x + v.y * ballVel.y) / (before * after) : 1
            kicked = after > before + 0.4 || (after > 0.5 && before > 0.5 && cos < 0.7)
          }
          ballVel = v
        } else ballVel = null
        ballPrev = { t, x: ball.x, y: ball.y }
      }
    }

    const moving = hipSpeed > DRIB.MOVE_SPEED
    movingSince = moving ? (movingSince ?? t) : null

    if (!run) {
      const ballClose = ball ? footDist < DRIB.START_MAX_DIST : !frame.ball   // no ball at all: pose-only run
      if (movingSince !== null && t - movingSince >= DRIB.START_HOLD && ballClose) {
        run = newRun(t)
        phase = 'dribbling'
        out.event = 'run_start'
      }
    } else {
      run.frames += 1
      run.poseVisSum += b.vis.legs
      run.kneeSum += (b.kneeFlex.left + b.kneeFlex.right) / 2
      run.kneeN += 1
      for (const h of run.pendingHeavy) {
        h.frames += 1
        if (ball) { h.tracked += 1; h.maxSep = Math.max(h.maxSep, footDist) }
      }
      const expired = run.pendingHeavy.filter((h) => t - h.t > DRIB.HEAVY_WINDOW)
      expired.forEach((h) => settleHeavy(run, h))
      run.pendingHeavy = run.pendingHeavy.filter((h) => t - h.t <= DRIB.HEAVY_WINDOW)
      if (ball) {
        run.ballFrames += 1
        run.ballConfSum += ball.conf
        run.seps.push(footDist)
        if (footDist <= DRIB.CLOSE_DIST) run.closeFrames += 1
        if (ball.detected && kicked && footDist < DRIB.TOUCH_DIST && dv > DRIB.TOUCH_DV && t - run.lastTouchT > DRIB.TOUCH_GAP) {
          run.touches.push({ t, foot: nearestFoot })
          run.lastTouchT = t
          out.event = 'touch'
          // A new touch ends the previous touch's heavy-touch window.
          run.pendingHeavy.forEach((h) => settleHeavy(run, h))
          run.pendingHeavy = [{ t, frames: 0, tracked: 0, maxSep: 0 }]
          // Contact point along the touching foot: only judged when the foot is clearly visible side-on.
          const f = b[nearestFoot]
          const { t: along, length } = alongFoot(f.heel, f.toe, ball)
          const vis = Math.min(f.heel.v, f.toe.v, f.ankle.v)
          if (along !== null && vis >= 0.6 && length / L >= DRIB.MIN_FOOT_LENGTH) {
            run.toeJudged += 1
            run.toeVisSum += vis
            if (along >= DRIB.TOE_T) run.toeCount += 1
          }
        }
        if (footDist > DRIB.LOST_DIST) {
          run.lostSince ??= t
          if (!run.lost && t - run.lostSince > DRIB.LOST_TIME) {
            run.lost = true
            run.lostEvents += 1
            phase = 'lost_control'
            out.event = 'lost_control'
          }
        } else if (footDist < DRIB.RECOVER_DIST) {
          run.lostSince = null
          run.lost = false
          phase = 'dribbling'
        }
      }
      run.stillSince = moving ? null : (run.stillSince ?? t)
      if (run.stillSince !== null && t - run.stillSince > DRIB.STOP_TIME) {
        out.attempt = finishRun(t)
      } else if (t - run.t0 >= DRIB.RUN_WINDOW) {
        out.attempt = finishRun(t)
        run = newRun(t)               // keep going: next window
        phase = 'dribbling'
      }
    }
    prev = { t, b, hipSpeed }
    out.phase = phase
    return out
  }

  return { update, get phase() { return phase }, reset: () => { run = null; phase = 'setup' } }
}
