// Which part of the boot met the ball, and whether that was the part the player was aiming to use.
//
// Estimated from the kicking foot at contact:
//   yaw   = how far the toes are turned OUT (+) or IN (−) from the kick direction, in degrees, from
//           MediaPipe's 3D (world) landmarks. Toes out ⇒ the inside of the foot faces the ball; toes in ⇒
//           the outside does; toes forward ⇒ laces or toe.
//   pitch = toes pointing down (+) or up (−), from the 2D side view. Toes down ⇒ laces.
//   along = where the ball sat along the foot (0 heel … 1 toe tip). At or past the tip ⇒ toe.
// Each frame around contact is classified and the majority wins; its share is the consistency.
// These are estimates from a single camera, so they carry a confidence and are withheld when unclear.
import { LM, alongFoot, footPitch, median } from './geometry'

export const ZONE_LABELS = {
  laces: 'laces', inside: 'inside of the foot', outside: 'outside of the foot', toe: 'toe', side: 'side of the foot',
}
/** How the coach says it in a sentence ("You struck it with ..."). */
export const ZONE_PHRASES = {
  laces: 'your laces', inside: 'the inside of your foot', outside: 'the outside of your foot', toe: 'your toe',
  side: 'the side of your foot',
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Outward yaw of a foot (degrees) from world landmarks, relative to the kick direction.
 * world: 33 × {x, y, z} (metres, y down, z depth). side: 'left' | 'right'. dir: +1 kick toward image right.
 */
export function footYaw3D(world, side, dir) {
  if (!world) return null
  const k = side === 'left' ? 'l' : 'r'
  const heel = world[LM[`${k}Heel`]], toe = world[LM[`${k}Toe`]]
  const lHip = world[LM.lHip], rHip = world[LM.rHip]
  if (!heel || !toe || !lHip || !rHip) return null
  const foot = { x: toe.x - heel.x, z: toe.z - heel.z }
  const fwd = { x: dir, z: 0 }                                   // kick direction (camera side-on)
  // The player's right, made perpendicular to the kick direction (horizontal plane x, z).
  const right = { x: rHip.x - lHip.x, z: rHip.z - lHip.z }
  const along = right.x * fwd.x + right.z * fwd.z
  const perp = { x: right.x - along * fwd.x, z: right.z - along * fwd.z }
  const n = Math.hypot(perp.x, perp.z)
  if (n < 1e-6 || Math.hypot(foot.x, foot.z) < 1e-6) return null
  const outward = side === 'right' ? 1 : -1                      // right foot turns out to the player's right
  const lateral = ((foot.x * perp.x + foot.z * perp.z) / n) * outward
  const forward = foot.x * fwd.x + foot.z * fwd.z
  return (Math.atan2(lateral, forward) * 180) / Math.PI
}

/** One frame's contact area from yaw / pitch / along (any may be null). */
export function classifyContact({ yaw, pitch, along, foreshortened }, t) {
  if (yaw != null) {
    if (yaw >= t.inside_yaw) return 'inside'
    if (yaw <= t.outside_yaw) return 'outside'
  } else if (foreshortened) {
    return 'side'                                                 // turned sideways, but 2D can't say which side
  }
  if (pitch == null) return null
  if (along != null && along >= t.toe_along && pitch < t.laces_pitch) return 'toe'
  return pitch >= t.laces_pitch ? 'laces' : 'toe'
}

/**
 * Estimate the contact area for a shot from the frames around contact.
 * frames: [{ b (2D body), world, L }], kick: 'left'|'right', dir, ballAt: {x, y} | null.
 * Returns { zone | null, conf, reason, yaw, pitch, along }.
 */
export function estimateContact({ frames, kick, dir, ballAt, thresholds, minConf, minFootLength, penalty = 1 }) {
  const per = []
  const vis = []
  for (const f of frames) {
    const foot = f.b[kick]
    const v = Math.min(foot.heel.v, foot.toe.v, foot.ankle.v)
    vis.push(v)
    if (v < 0.4) continue
    const length = Math.hypot(foot.toe.x - foot.heel.x, foot.toe.y - foot.heel.y)
    const yaw = footYaw3D(f.world, kick, dir)
    const pitch = footPitch(foot.heel, foot.toe)
    const along = ballAt ? alongFoot(foot.heel, foot.toe, ballAt).t : null
    const zone = classifyContact({ yaw, pitch, along, foreshortened: length / f.L < minFootLength }, thresholds)
    if (zone) per.push({ zone, yaw, pitch, along })
  }
  if (!per.length) return { zone: null, conf: 0, reason: 'foot_unclear', yaw: null, pitch: null, along: null }
  const counts = {}
  for (const p of per) counts[p.zone] = (counts[p.zone] ?? 0) + 1
  const zone = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]
  const consistency = counts[zone] / per.length
  const has3d = per.some((p) => p.yaw != null)
  const conf = (median(vis) ?? 0) * consistency * (has3d ? 1 : 0.75) * penalty
  const pick = (key) => { const vals = per.map((p) => p[key]).filter((x) => x != null); return vals.length ? +median(vals).toFixed(1) : null }
  return {
    zone: conf >= minConf ? zone : null, conf: +conf.toFixed(2), reason: conf >= minConf ? null : 'foot_unclear',
    yaw: pick('yaw'), pitch: pick('pitch'), along: pick('along'),
  }
}

/**
 * Per-shot feedback against the target area. Speaks every wrong contact; confirms a correct one when
 * the previous shot wasn't correct and then every 3rd correct in a row (so it doesn't nag);
 * an unclear contact is shown on screen, and a setup tip is spoken after 3 unclear shots in a row.
 */
export function createContactCoach(rules, shotType = 'driven') {
  const types = rules.skills.shooting.shot_types
  const type = types[shotType] ?? types.driven
  const target = type.zone
  let streak = 0
  let unclear = 0
  let last = null
  return {
    target,
    shotType: types[shotType] ? shotType : 'driven',
    instruction: type.instruction,
    assess(contact) {
      const detected = contact?.zone ?? null
      let out
      if (!detected || (detected === 'side' && target !== 'laces')) {
        unclear += 1
        const which = detected === 'side' ? 'I saw the side of your foot but couldn\'t tell inside from outside.' : 'I couldn\'t tell which part of your foot hit the ball.'
        out = { status: 'unclear', detected, target, text: which,
          speak: unclear === 3, spokenText: rules.tracking.messages.foot_unclear }
        if (unclear >= 3) unclear = 0
      } else if (detected === target) {
        unclear = 0
        streak += 1
        out = { status: 'correct', detected, target, text: `${cap(ZONE_LABELS[target])}, correct.`,
          speak: last !== 'correct' || streak % 3 === 0 }
      } else {
        unclear = 0
        streak = 0
        out = { status: 'incorrect', detected, target,
          text: `You struck it with ${ZONE_PHRASES[detected]}. Use ${ZONE_PHRASES[target]}: ${type.tip}.`, speak: true }
      }
      out.conf = contact?.conf ?? 0
      last = out.status
      return out
    },
  }
}

/** Contact area over the session, from the per-shot verdicts already given (null if not shooting). */
export function contactStats(attempts) {
  const shots = attempts.filter((a) => a.contact?.target)
  if (!shots.length) return null
  const judged = shots.filter((a) => a.contact.status === 'correct' || a.contact.status === 'incorrect')
  const zones = {}
  for (const a of judged) zones[a.contact.zone] = (zones[a.contact.zone] ?? 0) + 1
  return { target: shots[shots.length - 1].contact.target, shots: shots.length, judged: judged.length,
    correct: judged.filter((a) => a.contact.status === 'correct').length, zones }
}
