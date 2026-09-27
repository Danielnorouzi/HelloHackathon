// Explicit, repeatable rules: attempt measurements → correction candidates.
// Mirrors backend/app/coach/rules.py (both read coach_rules.json; shared test cases keep them in sync).
// A measurement only supports a correction if it exists, is physically plausible and is confident
// enough; otherwise it is "withheld" with a reason the UI and the voice coach can explain.

const BOUNDS = { leg: [-6, 6], deg: [-180, 180], pct: [0, 100], per_s: [0, 20], count: [0, 100] }

export function usable(m, unit, rules) {
  if (!m || m.value == null || typeof m.value !== 'number' || !Number.isFinite(m.value)) return false
  const [lo, hi] = BOUNDS[unit] ?? [-1e9, 1e9]
  if (m.value < lo || m.value > hi) return false
  return (m.conf ?? 0) >= rules.confidence.measurement_min
}

export const inGoodRange = (value, good) => value >= good[0] && value <= good[1]

/** → { corrections: [{key, measure, priority, text, alt, positive, value}], good: [measure], withheld: [{measure, reason}] } */
export function evaluateAttempt(skill, measurements, rules) {
  const cfg = rules.skills[skill]
  const defs = cfg.measurements
  const corrections = []
  const good = []
  const withheld = []
  for (const [key, d] of Object.entries(defs)) {
    const m = measurements[key]
    if (usable(m, d.unit, rules)) {
      if (inGoodRange(m.value, d.good)) good.push(key)
    } else if (m) {
      withheld.push({ measure: key, reason: m.reason || 'low_confidence' })
    }
  }
  for (const cue of cfg.cues) {
    const m = measurements[cue.measure]
    if (!usable(m, defs[cue.measure].unit, rules)) continue
    if ((cue.below !== undefined && m.value < cue.below) || (cue.above !== undefined && m.value > cue.above)) {
      corrections.push({ key: cue.key, measure: cue.measure, priority: cue.priority, text: cue.text,
        alt: cue.alt, positive: cue.positive, value: m.value, zones: cue.zones ?? [] })
    }
  }
  corrections.sort((a, b) => b.priority - a.priority)   // stable: config order breaks ties
  return { corrections, good, withheld }
}

/** The tracking problem most worth mentioning for an attempt (first in the configured order), if any. */
export function mainTrackingIssue(result, rules) {
  const order = rules.tracking.order
  const reasons = result.withheld.map((w) => w.reason).filter((r) => order.includes(r))
  if (!reasons.length) return null
  return reasons.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]
}

/** Human-readable value, e.g. "0.40 leg lengths behind the ball", "8° leaning back", "62%". */
export function formatMeasure(value, d) {
  if (value == null) return 'n/a'
  if (d.unit === 'leg') {
    const base = `${Math.abs(value).toFixed(2)} leg lengths`
    return d.describe ? `${base} ${value < 0 ? d.describe.negative : d.describe.positive}` : base
  }
  if (d.unit === 'deg') return d.describe ? `${Math.abs(value).toFixed(0)}° ${value < 0 ? d.describe.negative : d.describe.positive}` : `${value.toFixed(0)}°`
  if (d.unit === 'pct') return `${value.toFixed(0)}%`
  if (d.unit === 'per_s') return `${value.toFixed(1)} per second`
  return `${value}`
}
