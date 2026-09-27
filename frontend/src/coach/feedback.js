// Cue scheduler: decides WHICH hint to speak and WHEN, so the coach helps without nagging.
//
// Per attempt, at most one cue. Candidates come from rules.evaluateAttempt:
//   • Urgent corrections (priority ≥ urgent_priority) can be spoken after a single attempt.
//   • Other corrections must repeat: seen in `confirm_needed` of the last `confirm_window` attempts.
//   • Each cue key has a cooldown (longer once it has been said `extended_after` times), and the
//     second time a cue is said it uses its alternative wording.
//   • If tracking withheld the measurements, a camera-setup hint is given instead (own cooldown),
//     and no specific correction is made from unreliable data.
//   • After a correction, a fixed measurement earns one short positive cue (with its own cooldown).
//   • Nothing is spoken within `min_gap_ms` of the last cue, or while the player or coach is talking;
//     the best candidate waits (up to `pending_ttl_ms`) and a better one can replace it.
// Shooting also passes per-shot contact-area feedback (coach/contact.js), which takes priority when
// the wrong part of the boot was used.
// All methods take `now` (ms) explicitly, so the behaviour is deterministic and testable.
import { evaluateAttempt, mainTrackingIssue } from './rules'

export function createCueScheduler(rules, skill) {
  const cfg = rules.scheduler
  const perKey = new Map()          // key → { lastAt, count }
  const recent = []                 // correction keys per recent attempt
  const corrected = new Set()       // measures we've corrected and not yet praised
  let lastSpokenAt = -Infinity
  let pending = null                // { cue, at }
  let busy = false
  const log = []

  const cooldownFor = (key, isTracking) => {
    const s = perKey.get(key)
    if (!s) return 0
    const base = isTracking ? cfg.tracking_cooldown_ms : s.count >= cfg.extended_after ? cfg.extended_cooldown_ms : cfg.cooldown_ms
    return base
  }
  const coolingDown = (key, now, isTracking = false) => {
    const s = perKey.get(key)
    return s ? now - s.lastAt < cooldownFor(key, isTracking) : false
  }

  function pick(result, trackingIssue, now) {
    // 1. Corrections (only from confident measurements).
    for (const c of result.corrections) {
      const seen = recent.filter((keys) => keys.includes(c.key)).length
      const urgent = c.priority >= cfg.urgent_priority
      if (!urgent && seen < cfg.confirm_needed) continue
      if (coolingDown(c.key, now)) continue
      const said = perKey.get(c.key)?.count ?? 0
      return { key: c.key, kind: 'correction', priority: c.priority, measure: c.measure, zones: c.zones ?? [],
        text: said % 2 === 1 && c.alt ? c.alt : c.text }
    }
    // 2. Tracking problem: say what to fix in the setup instead of guessing.
    if (trackingIssue && !result.corrections.length) {
      const key = `tracking:${trackingIssue}`
      if (!coolingDown(key, now, true)) {
        return { key, kind: 'tracking', priority: 2, text: rules.tracking.messages[trackingIssue] }
      }
    }
    // 3. Praise a fix we asked for.
    const skillCues = rules.skills[skill].cues
    for (const measure of result.good) {
      if (!corrected.has(measure)) continue
      const cue = skillCues.find((c) => c.measure === measure && c.positive)
      const key = `positive:${measure}`
      if (cue && !coolingDown(key, now) && now - (perKey.get(key)?.lastAt ?? -Infinity) >= cfg.positive_cooldown_ms) {
        return { key, kind: 'positive', priority: 0, measure, zones: cue.zones ?? [], text: cue.positive }
      }
    }
    return null
  }

  function commit(cue, now) {
    if (cue.also) commit(cue.also, now)
    const s = perKey.get(cue.key) ?? { lastAt: -Infinity, count: 0 }
    perKey.set(cue.key, { lastAt: now, count: s.count + 1 })
    lastSpokenAt = now
    if (cue.kind === 'correction') corrected.add(cue.measure)
    if (cue.kind === 'positive') corrected.delete(cue.measure)
    log.push({ ...cue, at: now })
    return cue
  }

  const canSpeak = (now) => !busy && now - lastSpokenAt >= cfg.min_gap_ms

  return {
    /** Evaluate a finished attempt. Returns { result, cue } where cue is to be spoken now (or null). */
    onAttempt(attempt, now, contact = null) {
      const result = evaluateAttempt(skill, attempt.measurements, rules)
      recent.push(result.corrections.map((c) => c.key))
      if (recent.length > cfg.confirm_window) recent.shift()
      const trackingIssue = mainTrackingIssue(result, rules)
      let cue = pick(result, trackingIssue, now)
      // Contact-area feedback (shooting): a wrong contact is said first, on its own; a correct one is
      // confirmed and, if there's also a technique correction, both go in one sentence.
      if (contact?.speak) {
        const zones = [contact.target]
        const text = contact.status === 'unclear' ? contact.spokenText : contact.text
        const contactCue = { key: `contact:${contact.status}`, kind: contact.status === 'correct' ? 'positive' : contact.status === 'incorrect' ? 'correction' : 'tracking',
          priority: contact.status === 'incorrect' ? 5 : 1, zones, contact, text }
        if (contact.status === 'correct' && cue?.kind === 'correction') {
          cue = { ...contactCue, key: `contact:correct+${cue.key}`, text: `${contact.text} ${cue.text}`,
            zones: cue.zones?.length ? cue.zones : zones, also: cue }  // the correction is recorded when spoken
        } else {
          cue = contactCue
        }
      }
      if (!cue) return { result, trackingIssue, cue: null }
      if (canSpeak(now)) {
        pending = null
        return { result, trackingIssue, cue: commit(cue, now) }
      }
      if (!pending || cue.priority >= pending.cue.priority) pending = { cue, at: now }
      return { result, trackingIssue, cue: null, deferred: true }
    },

    /** A live (between-attempts) tracking hint, e.g. "I can't see the ball". Same cooldown rules. */
    onTrackingProblem(issue, now) {
      const key = `tracking:${issue}`
      if (coolingDown(key, now, true) || !rules.tracking.messages[issue]) return null
      const cue = { key, kind: 'tracking', priority: 2, text: rules.tracking.messages[issue] }
      if (canSpeak(now)) return commit(cue, now)
      if (!pending) pending = { cue, at: now }
      return null
    },

    /** Call regularly: releases a deferred cue once talking stops and the gap has passed. */
    tick(now) {
      if (!pending) return null
      if (now - pending.at > cfg.pending_ttl_ms) { pending = null; return null }
      if (!canSpeak(now)) return null
      const cue = pending.cue
      pending = null
      return commit(cue, now)
    },

    /** True while the player is asking a question or the coach is speaking. */
    setBusy(value) { busy = value },
    get log() { return log },
  }
}
