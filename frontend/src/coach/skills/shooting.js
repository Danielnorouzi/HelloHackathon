// Shooting: phase detection and measurements from pose + ball tracks.
//
// Phases: setup → approach → plant → contact → follow_through → recovery → setup
//   approach       hips moving toward the ball
//   plant          one foot stops next to the ball while the other swings
//   contact        kicking foot reaches the ball and the ball starts moving (or, without a ball
//                  track, the kicking ankle's speed peaks as it passes the standing foot: "estimated")
//   follow_through 0.7 s after contact, tracking how high the kicking leg carries on
//
// Measurements (per attempt, each with a 0–1 confidence and a reason when withheld):
//   plant_offset   standing ankle vs ball along the kick direction, in leg lengths (+ = ahead)
//   trunk_lean     hip→shoulder lean at contact, degrees (+ = over the ball, − = leaning back)
//   support_knee   standing-knee bend at contact, degrees
//   backswing_knee max kicking-knee bend between plant and contact, degrees
//   follow_through peak height of the kicking ankle above the ground after contact, leg lengths
// Each attempt also carries `contact`: which part of the boot met the ball (laces / inside / outside / toe),
// estimated from the kicking foot around contact (see coach/contact.js), with a confidence.
// Side-on is judged from the run-up (before the kick rotates the shoulders), not at contact.
//   foot_pitch     kicking foot (heel→toe) angle below horizontal at contact, degrees (+ = toes down,
//                  as for a laces strike); needs a side view and a clearly visible, not foreshortened foot
// Ball speed, power and accuracy are never estimated.
import { body, LegLength } from '../tracking'
import { dist, footPitch, leanFromVertical, median, minVis, sign } from '../geometry'
import { estimateContact } from '../contact'

export const SHOT = {
  APPROACH_SPEED: 0.5,      // hip speed toward the ball, leg lengths / s
  APPROACH_MAX_DIST: 5,     // ball within this many leg lengths to count as an approach
  PLANT_STILL: 0.8,         // standing-ankle speed below this = planted
  SWING_SPEED: 1.8,         // kicking-ankle speed above this = swinging
  PLANT_NEAR_BALL: 1.2,     // standing ankle within this horizontal distance of the ball
  CONTACT_NEAR: 0.7,        // kicking toe within this distance of the ball around contact
  BALL_LAUNCH_SPEED: 2.5,   // ball speed that marks it being struck
  NO_BALL_PEAK: 3.0,        // (no ball track) kicking-ankle peak speed for an estimated contact
  FOLLOW_WINDOW: 0.7,       // seconds after contact to watch the follow-through
  APPROACH_HOLD: 0.1,       // seconds the approach must be sustained (time-based, so any frame rate works)
  RECOVERY_HOLD: 0.4,       // seconds of stillness that end the recovery
  APPROACH_TIMEOUT: 3.0,
  PLANT_TIMEOUT: 1.5,
  RECOVERY_TIMEOUT: 2.5,
  POSE_LOST_TIMEOUT: 0.6,
  MIN_FOOT_LENGTH: 0.15,    // heel→toe in leg lengths; shorter = foot turned toward the camera
  BACKSWING_LOOKBACK: 0.6,  // the leg is drawn back mostly BEFORE the standing foot lands
  SIDE_LOOKBACK: 1.2,       // judge side-on from this much run-up before the plant
}

const SIDES = ['left', 'right']
const other = (s) => (s === 'left' ? 'right' : 'left')

export function createShootingDetector({ rules, kickingFoot = 'auto' }) {
  const minConf = rules.confidence.measurement_min
  const contactCfg = rules.skills.shooting.contact
  const legLength = new LegLength()
  let phase = 'setup'
  let phaseStart = 0
  let prev = null          // previous derived frame (for speeds)
  let approachSince = null
  let dir = 0              // +1 kick toward image right, −1 toward left
  let plant = null
  let contact = null
  let follow = null
  let lastPoseT = -Infinity
  let index = 0
  let stillSince = null
  let ballHistory = []     // recent confident ball positions (for the ball position at contact)
  let recent = []          // last second of derived frames (backswing look-back, contact window)

  const setPhase = (p, t) => { phase = p; phaseStart = t }
  const reset = (t) => { setPhase('setup', t); plant = contact = follow = null; approachSince = null; dir = 0 }

  function derive(frame) {
    const b = body(frame.lm)
    const L = legLength.update(b.legLength)
    if (!L) return null
    const d = { t: frame.t, b, L, ball: frame.ball, quality: frame.quality, world: frame.world ?? null, speed: {}, hipVx: 0 }
    if (prev && frame.t > prev.t) {
      const dt = frame.t - prev.t
      for (const s of SIDES) {
        const raw = dist(b[s].ankle, prev.b[s].ankle) / L / dt
        d.speed[s] = 0.5 * raw + 0.5 * (prev.speed[s] ?? raw)   // light smoothing
      }
      const rawVx = (b.hip.x - prev.b.hip.x) / L / dt
      d.hipVx = 0.5 * rawVx + 0.5 * prev.hipVx
    } else {
      d.speed = { left: 0, right: 0 }
    }
    d.ballSpeed = frame.ball ? Math.hypot(frame.ball.vx, frame.ball.vy) / L : 0
    return d
  }

  function tryPlant(d) {
    for (const support of SIDES) {
      const kick = other(support)
      if (kickingFoot !== 'auto' && kick !== kickingFoot) continue
      const still = d.speed[support] < SHOT.PLANT_STILL
      const swinging = d.speed[kick] > SHOT.SWING_SPEED
      const nearBall = d.ball && d.ball.conf >= 0.3
        ? Math.abs(d.ball.x - d.b[support].ankle.x) / d.L < SHOT.PLANT_NEAR_BALL
        : true
      if (still && swinging && nearBall) {
        if (!dir) dir = d.ball ? sign(d.ball.x - d.b.hip.x) || 1 : sign(d.hipVx) || 1
        // Backswing: the kicking leg is drawn back mostly before the plant, so look back a little.
        const before = recent.filter((f) => d.t - f.t <= SHOT.BACKSWING_LOOKBACK)
        const kneeFlex = [d, ...before].map((f) => f.b.kneeFlex[kick])
        const kickVis = [d, ...before].map((f) => minVis(f.b[kick].hip, f.b[kick].knee, f.b[kick].ankle))
        // Side-on: majority of the run-up frames (at contact the shoulders open up and look front-on).
        const votes = recent.filter((f) => d.t - f.t <= SHOT.SIDE_LOOKBACK && f.quality?.sideView != null).map((f) => f.quality.sideView)
        const sideView = votes.length ? votes.filter(Boolean).length >= votes.length / 2 : d.quality?.sideView ?? null
        plant = { t: d.t, support, kick, maxKneeFlex: Math.max(...kneeFlex), kickVis, sideView,
          minToeBall: Infinity, nearestFrame: null, peakKickSpeed: 0, peakFrame: null }
        setPhase('plant', d.t)
        return true
      }
    }
    return false
  }

  function measure(c, source) {
    const { support } = plant
    const b = c.b
    const estimated = source === 'estimated'
    const poseFactor = estimated ? 0.85 : 1
    const poseReason = estimated ? 'estimated_contact' : 'low_pose'
    const m = {}
    const put = (key, value, conf, reason) => {
      m[key] = conf >= minConf && value != null && Number.isFinite(value)
        ? { value: +value.toFixed(3), conf: +conf.toFixed(2), reason: null }
        : { value: null, conf: +(conf || 0).toFixed(2), reason: reason ?? 'low_confidence' }
    }

    // Ball position just before contact (the ball is still then, so this is the most reliable fix).
    const nearBall = ballHistory.filter((p) => p.t <= c.t + 0.05 && p.t >= c.t - 0.4)
    const ballAt = nearBall.length ? { x: median(nearBall.map((p) => p.x)), y: median(nearBall.map((p) => p.y)), conf: median(nearBall.map((p) => p.conf)) } : null
    const side = plant.sideView ?? c.quality?.sideView
    if (!ballAt) put('plant_offset', null, 0, 'ball_not_at_contact')
    else {
      const conf = Math.min(b[support].ankle.v, ballAt.conf) * (side === false ? 0.4 : 1)
      put('plant_offset', ((b[support].ankle.x - ballAt.x) * dir) / c.L, conf, side === false ? 'facing_camera' : 'low_confidence')
    }
    // Lean needs BOTH shoulders and hips: use the worse of the two (an average would hide one being occluded).
    put('trunk_lean', leanFromVertical(b.hip, b.shoulder, dir), Math.min(b.shoulder.v, b.hip.v) * poseFactor, poseReason)
    put('support_knee', b.kneeFlex[support], minVis(b[support].hip, b[support].knee, b[support].ankle) * poseFactor, poseReason)
    put('backswing_knee', plant.maxKneeFlex, median(plant.kickVis) * poseFactor, poseReason)

    // Kicking-foot angle: only trusted side-on, with heel and toe clearly visible and the foot not
    // foreshortened (a foot turned toward the camera looks short and its angle means little).
    const kf = b[plant.kick]
    const footLen = dist(kf.heel, kf.toe) / c.L
    let footConf = minVis(kf.heel, kf.toe, kf.ankle) * poseFactor * (side === false ? 0.4 : 1)
    if (footLen < SHOT.MIN_FOOT_LENGTH) footConf *= 0.5
    put('foot_pitch', footPitch(kf.heel, kf.toe), footConf, side === false ? 'facing_camera' : poseReason)

    // Which part of the boot met the ball (frames just around contact).
    const w = contactCfg.window_s
    const contact = estimateContact({
      frames: recent.filter((f) => Math.abs(f.t - c.t) <= w), kick: plant.kick, dir, ballAt,
      thresholds: contactCfg, minConf, minFootLength: SHOT.MIN_FOOT_LENGTH,
      penalty: (estimated ? 0.85 : 1) * (side === false ? 0.7 : 1),
    })
    return { measurements: m, ballAt, contact }
  }

  function finishAttempt() {
    const { support, kick } = plant
    const m = contact.measurements
    const conf = median(follow.kickVis) * (contact.source === 'estimated' ? 0.85 : 1)
    const height = (follow.groundY - follow.minKickY) / contact.L
    m.follow_through = conf >= minConf
      ? { value: +height.toFixed(3), conf: +conf.toFixed(2), reason: null }
      : { value: null, conf: +conf.toFixed(2), reason: contact.source === 'estimated' ? 'estimated_contact' : 'low_pose' }

    // Direction of the ball's path in the image right after contact (only a direction, never a speed).
    let ballPath = null
    if (follow.ballPts.length >= 3 && contact.quality?.sideView !== false) {
      const a = follow.ballPts[0], z = follow.ballPts[follow.ballPts.length - 1]
      const angle = (Math.atan2(a.y - z.y, Math.abs(z.x - a.x)) * 180) / Math.PI
      ballPath = angle < 10 ? 'low' : angle < 30 ? 'rising' : 'steep'
    }
    index += 1
    return {
      skill: 'shooting', index, t: contact.t, kicking_foot: kick, support_foot: support,
      contact_source: contact.source, measurements: m, ball_path: ballPath, contact: contact.area,
      quality: { pose: +contact.b.vis.legs.toFixed(2), ball: +(contact.ballAt?.conf ?? 0).toFixed(2), side_view: plant.sideView ?? contact.quality?.sideView ?? null },
    }
  }

  /** frame = {t, lm (px, smoothed) | null, ball (tracker snapshot) | null, quality}. */
  function update(frame) {
    const out = { phase, attempt: null, event: null }
    if (frame.ball && frame.ball.detected && frame.ball.conf >= 0.3) {
      ballHistory.push({ t: frame.t, x: frame.ball.x, y: frame.ball.y, conf: frame.ball.conf })
      ballHistory = ballHistory.filter((p) => frame.t - p.t < 1.5)
    }
    if (!frame.lm) {
      if (phase === 'follow_through' && frame.t - contact.t >= SHOT.FOLLOW_WINDOW) {
        out.attempt = finishAttempt()            // keep the shot; follow-through is withheld if unseen
        setPhase('recovery', frame.t)
      } else if (frame.t - lastPoseT > SHOT.POSE_LOST_TIMEOUT && !['setup', 'follow_through', 'recovery'].includes(phase)) {
        out.event = 'aborted'
        reset(frame.t)
        prev = null
      }
      out.phase = phase
      return out
    }
    lastPoseT = frame.t
    const d = derive(frame)
    if (!d) { out.phase = phase; return out }

    switch (phase) {
      case 'setup': {
        if (tryPlant(d)) break
        const toBall = d.ball && d.ball.conf >= 0.3 ? d.ball.x - d.b.hip.x : null
        const moving = Math.abs(d.hipVx) > (toBall == null ? SHOT.APPROACH_SPEED * 1.6 : SHOT.APPROACH_SPEED)
        const towardBall = toBall == null || (sign(d.hipVx) === sign(toBall) && Math.abs(toBall) / d.L < SHOT.APPROACH_MAX_DIST)
        approachSince = moving && towardBall ? (approachSince ?? d.t) : null
        if (approachSince !== null && d.t - approachSince >= SHOT.APPROACH_HOLD) {
          dir = toBall == null ? sign(d.hipVx) : sign(toBall)
          setPhase('approach', d.t)
        }
        break
      }
      case 'approach':
        if (!tryPlant(d) && d.t - phaseStart > SHOT.APPROACH_TIMEOUT) reset(d.t)
        break
      case 'plant': {
        // During a run-up every stride looks like a plant. If the "standing" foot lifts off again
        // before any contact, that was just a stride: look for the next plant instead.
        if (d.speed[plant.support] > SHOT.SWING_SPEED && !plant.nearestFrame?.nearContact) {
          plant = null
          setPhase('approach', d.t)
          tryPlant(d)
          break
        }
        const kick = d.b[plant.kick]
        plant.maxKneeFlex = Math.max(plant.maxKneeFlex, d.b.kneeFlex[plant.kick])
        plant.kickVis.push(minVis(kick.hip, kick.knee, kick.ankle))
        const toe = kick.toe.v > 0.4 ? kick.toe : kick.ankle
        const ballSeen = d.ball && d.ball.conf >= 0.3
        if (ballSeen) {
          const dToe = dist(toe, d.ball) / d.L
          if (dToe < plant.minToeBall) {
            plant.minToeBall = dToe
            plant.nearestFrame = { ...d, nearContact: dToe < SHOT.CONTACT_NEAR, ballX: d.ball.x }
          }
        }
        if (d.speed[plant.kick] > plant.peakKickSpeed) { plant.peakKickSpeed = d.speed[plant.kick]; plant.peakFrame = d }

        const struck = plant.nearestFrame && plant.minToeBall < SHOT.CONTACT_NEAR && (
          (ballSeen && d.ballSpeed > SHOT.BALL_LAUNCH_SPEED) ||                      // ball launched
          // ball vanished (motion blur) after the toe reached it and swung past it
          (!d.ball?.detected && d.t - plant.nearestFrame.t > 0.05 && plant.peakKickSpeed > SHOT.SWING_SPEED &&
            (toe.x - plant.nearestFrame.ballX) * dir > 0))
        const passedSupport = (kick.ankle.x - d.b[plant.support].ankle.x) * dir > 0
        const estimated = !plant.nearestFrame && plant.peakKickSpeed > SHOT.NO_BALL_PEAK &&
          d.speed[plant.kick] < 0.8 * plant.peakKickSpeed && passedSupport

        if (struck || estimated) {
          const c = struck ? plant.nearestFrame : plant.peakFrame
          const source = struck ? 'ball' : 'estimated'
          const { measurements, ballAt, contact: area } = measure(c, source)
          contact = { t: c.t, L: c.L, b: c.b, quality: c.quality, source, measurements, ballAt, area }
          follow = { groundY: c.b[plant.support].ankle.y, minKickY: c.b[plant.kick].ankle.y, kickVis: [], ballPts: [] }
          setPhase('follow_through', d.t)
          out.event = 'contact'
        } else if (d.t - phaseStart > SHOT.PLANT_TIMEOUT) {
          reset(d.t)
          out.event = 'aborted'
        }
        break
      }
      case 'follow_through': {
        const kick = d.b[plant.kick]
        follow.minKickY = Math.min(follow.minKickY, kick.ankle.y)
        follow.kickVis.push(kick.ankle.v)
        if (d.ball?.detected) follow.ballPts.push({ x: d.ball.x, y: d.ball.y })
        if (d.t - contact.t >= SHOT.FOLLOW_WINDOW) {
          out.attempt = finishAttempt()
          setPhase('recovery', d.t)
          stillSince = null
        }
        break
      }
      case 'recovery': {
        const still = d.speed.left < 1.0 && d.speed.right < 1.0 && Math.abs(d.hipVx) < 0.6
        stillSince = still ? (stillSince ?? d.t) : null
        if ((stillSince !== null && d.t - stillSince >= SHOT.RECOVERY_HOLD) || d.t - phaseStart > SHOT.RECOVERY_TIMEOUT) reset(d.t)
        break
      }
      default:
        break
    }
    prev = d
    recent.push(d)
    recent = recent.filter((f) => d.t - f.t <= 1.0)
    out.phase = phase
    return out
  }

  return {
    update,
    get phase() { return phase },
    /** Which foot is planted / kicking while a shot is in progress (for the overlay). */
    get plant() { return plant && ['plant', 'follow_through'].includes(phase) ? { support: plant.support, kick: plant.kick } : null },
    reset: () => reset(0),
  }
}
