// Small geometry helpers for pose landmarks in PIXELS ({x, y, v}: y grows downward, v = visibility 0..1).

// MediaPipe Pose landmark indices we use.
export const LM = {
  nose: 0, lShoulder: 11, rShoulder: 12, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
}

export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v ?? 1, b.v ?? 1) })
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** Angle at b (degrees) between b→a and b→c. */
export function jointAngle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (!mag) return 180
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / mag))
  return (Math.acos(cos) * 180) / Math.PI
}

/** Knee (or hip) bend: 0° = straight leg. */
export const flexion = (a, b, c) => 180 - jointAngle(a, b, c)

/** Signed lean of the hip→shoulder line from vertical. Positive = leaning toward dir (+1 = image right). */
export function leanFromVertical(hip, shoulder, dir) {
  const dx = (shoulder.x - hip.x) * dir
  const dy = hip.y - shoulder.y
  return (Math.atan2(dx, dy) * 180) / Math.PI
}

export const minVis = (...points) => Math.min(...points.map((p) => p?.v ?? 0))
export const meanVis = (...points) => points.reduce((s, p) => s + (p?.v ?? 0), 0) / points.length

export function median(values) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function percentile(values, p) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0)

/**
 * Where along the foot a point lies: 0 = heel, 1 = toe tip (can be > 1 past the toe).
 * Also returns the foot length, so callers can reject a foreshortened foot.
 */
export function alongFoot(heel, toe, point) {
  const fx = toe.x - heel.x, fy = toe.y - heel.y
  const len2 = fx * fx + fy * fy
  if (!len2) return { t: null, length: 0 }
  return { t: ((point.x - heel.x) * fx + (point.y - heel.y) * fy) / len2, length: Math.sqrt(len2) }
}

/** Foot angle below horizontal, degrees (+ = toes pointing down, − = toes up), side view. */
export function footPitch(heel, toe) {
  return (Math.atan2(toe.y - heel.y, Math.abs(toe.x - heel.x)) * 180) / Math.PI
}
