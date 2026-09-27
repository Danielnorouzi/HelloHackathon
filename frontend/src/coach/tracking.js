// Tracking utilities: landmark smoothing, a ball tracker, the shared body model, and per-frame
// tracking quality. Everything is in pixels; distances are later divided by leg length.
import { LM, dist, flexion, mid, meanVis, median } from './geometry'

// ---------------------------------------------------------------------------
// One-Euro filter (Casiez et al.): smooths jitter at rest, stays responsive during fast kicks.
// ---------------------------------------------------------------------------
const smoothingAlpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))

export class OneEuro {
  constructor(minCutoff = 1.5, beta = 0.015, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: null })
  }

  filter(value, t) {
    if (this.x === null || t - this.t > 0.5) {
      Object.assign(this, { x: value, dx: 0, t })
      return value
    }
    const dt = Math.max(t - this.t, 1 / 240)
    const rawDx = (value - this.x) / dt
    this.dx += smoothingAlpha(this.dCutoff, dt) * (rawDx - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += smoothingAlpha(cutoff, dt) * (value - this.x)
    this.t = t
    return this.x
  }
}

export class PoseSmoother {
  constructor() { this.filters = [] }

  /** landmarks: [{x, y, v}] in px; t in seconds. */
  smooth(landmarks, t) {
    return landmarks.map((p, i) => {
      if (!this.filters[i]) this.filters[i] = [new OneEuro(), new OneEuro()]
      return { x: this.filters[i][0].filter(p.x, t), y: this.filters[i][1].filter(p.y, t), v: p.v }
    })
  }
}

// ---------------------------------------------------------------------------
// Ball tracker: alpha-beta filter over detections. Coasts briefly when the detector misses a frame
// (motion blur, occlusion), with confidence decaying, then gives up.
// ---------------------------------------------------------------------------
export class BallTracker {
  constructor({ alpha = 0.65, beta = 0.35, lostAfter = 0.8, decay = 0.35 } = {}) {
    Object.assign(this, { alpha, beta, lostAfter, decay, state: null })
  }

  /** detections: [{x, y, r, score}] in px. Returns {x, y, r, vx, vy, conf, detected} or null. */
  update(detections, t) {
    const s = this.state
    const dt = s ? Math.max(t - s.t, 1 / 240) : 0
    const px = s ? s.x + s.vx * dt : 0
    const py = s ? s.y + s.vy * dt : 0

    let det = null
    if (detections.length) {
      if (s && t - s.lastSeen < 0.3) {
        // Keep following the same ball: nearest detection to the prediction, within a gate.
        const gate = Math.max(6 * s.r, 60)
        const near = detections
          .map((d) => ({ d, e: Math.hypot(d.x - px, d.y - py) }))
          .filter((c) => c.e < gate)
          .sort((a, b) => a.e - b.e)[0]
        det = near?.d ?? null
      }
      if (!det) det = [...detections].sort((a, b) => b.score - a.score)[0]
    }

    if (det) {
      if (!s || t - s.lastSeen > this.lostAfter) {
        this.state = { x: det.x, y: det.y, r: det.r, vx: 0, vy: 0, conf: det.score, t, lastSeen: t }
      } else {
        const rx = det.x - px, ry = det.y - py
        this.state = {
          x: px + this.alpha * rx, y: py + this.alpha * ry,
          vx: s.vx + (this.beta * rx) / dt, vy: s.vy + (this.beta * ry) / dt,
          r: 0.7 * s.r + 0.3 * det.r, conf: 0.5 * s.conf + 0.5 * det.score, t, lastSeen: t,
        }
      }
      return { ...this.state, detected: true }
    }

    if (!s) return null
    if (t - s.lastSeen > this.lostAfter) {
      this.state = null
      return null
    }
    this.state = { ...s, x: px, y: py, t, conf: s.conf * Math.exp(-dt / this.decay) }
    return { ...this.state, detected: false }
  }

  reset() { this.state = null }
}

// ---------------------------------------------------------------------------
// Body model shared by the skill detectors.
// ---------------------------------------------------------------------------
const LEG_POINTS = [LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle]

export function body(lm) {
  const side = (s) => {
    const k = s === 'left' ? 'l' : 'r'
    return {
      hip: lm[LM[`${k}Hip`]], knee: lm[LM[`${k}Knee`]], ankle: lm[LM[`${k}Ankle`]],
      toe: lm[LM[`${k}Toe`]], heel: lm[LM[`${k}Heel`]],
    }
  }
  const left = side('left')
  const right = side('right')
  const kneeFlex = (s) => flexion(s.hip, s.knee, s.ankle)
  const legLen = (s) => dist(s.hip, s.knee) + dist(s.knee, s.ankle)
  const visibleLegs = [left, right].filter((s) => Math.min(s.hip.v, s.knee.v, s.ankle.v) > 0.5)
  return {
    hip: mid(lm[LM.lHip], lm[LM.rHip]),
    shoulder: mid(lm[LM.lShoulder], lm[LM.rShoulder]),
    left, right,
    kneeFlex: { left: kneeFlex(left), right: kneeFlex(right) },
    legLength: visibleLegs.length ? median(visibleLegs.map(legLen)) : null,
    vis: {
      core: meanVis(lm[LM.lShoulder], lm[LM.rShoulder], lm[LM.lHip], lm[LM.rHip]),
      legs: meanVis(...LEG_POINTS.map((i) => lm[i])),
      left: meanVis(left.hip, left.knee, left.ankle),
      right: meanVis(right.hip, right.knee, right.ankle),
    },
  }
}

/** Leg length (hip→knee→ankle, px) as a rolling median: the unit for every distance we report. */
export class LegLength {
  constructor(size = 45) { Object.assign(this, { size, values: [] }) }
  update(value) {
    if (value && value > 10) {
      this.values.push(value)
      if (this.values.length > this.size) this.values.shift()
    }
    return median(this.values)
  }
}

// ---------------------------------------------------------------------------
// Frame quality: what the UI shows, and what the detectors use to decide confidence.
// ---------------------------------------------------------------------------
export function frameQuality({ lm, ball, width, height, luma, skill, rules }) {
  const issues = []
  if (luma != null && luma < 45) issues.push('dark')
  if (!lm) {
    issues.unshift('no_person')
    return { pose: 0, ball: ball?.conf ?? 0, sideView: null, feetVisible: false, issues }
  }
  const b = body(lm)
  const feet = [b.left.ankle, b.right.ankle, b.left.toe, b.right.toe]
  const margin = 0.02
  const feetVisible = feet.every((p) => p.v > 0.5 && p.x > width * margin && p.x < width * (1 - margin) && p.y < height * (1 - margin))
  const shoulderWidth = dist(lm[LM.lShoulder], lm[LM.rShoulder])
  const torso = dist(b.shoulder, b.hip) || 1
  const sideView = b.vis.core > 0.5 ? shoulderWidth / torso < 0.55 : null
  const pose = Math.min(b.vis.core, b.vis.legs)

  if (!feetVisible) issues.push('feet_out')
  if (skill === 'shooting' && rules.skills.shooting.camera_view === 'side' && sideView === false) issues.push('facing_camera')
  if (!ball || ball.conf < 0.3) issues.push('no_ball')
  if (pose < rules.confidence.pose_min) issues.push('low_pose')
  const order = rules.tracking.order
  issues.sort((a, c) => order.indexOf(a) - order.indexOf(c))
  return { pose, ball: ball?.conf ?? 0, sideView, feetVisible, issues }
}
