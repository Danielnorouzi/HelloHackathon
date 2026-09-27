// Synthetic side-on pose + ball sequences for testing skill-phase detection without a camera.
// Pixel frame 1280×720, player facing +x. Leg = hip→knee (120 px) + knee→ankle (120 px) = 240 px.
import { LM } from '../geometry'

export const FPS = 30
export const L = 240

/** Build 33 landmarks from a few key points. vis / coreVis / legVis control visibility. */
export function pose({ hipX, hipY = 400, lean = 0, left, right, vis = 0.95, coreVis = vis, shoulderVis = coreVis, legVis = vis, shoulderSpread = 6 }) {
  const lm = Array.from({ length: 33 }, () => ({ x: hipX, y: 300, v: vis }))
  const feet = {}
  const put = (i, x, y, v) => { lm[i] = { x, y, v } }
  put(LM.lShoulder, hipX + lean - shoulderSpread, hipY - 150, shoulderVis)
  put(LM.rShoulder, hipX + lean + shoulderSpread, hipY - 150, shoulderVis)
  put(LM.lHip, hipX - 4, hipY, coreVis)
  put(LM.rHip, hipX + 4, hipY, coreVis)
  for (const [side, p] of [['l', left], ['r', right]]) {
    const knee = p.knee ?? { x: (hipX + p.ankle.x) / 2 + 6, y: hipY + 120 }
    put(LM[`${side}Knee`], knee.x, knee.y, legVis)
    put(LM[`${side}Ankle`], p.ankle.x, p.ankle.y, legVis)
    // Realistic foot: heel→toe about 0.27 leg lengths. p.pitch (deg) tilts it (+ = toes down);
    // p.yaw (deg) turns the toes out (+) or in (−), which foreshortens the foot in the side view.
    const pitch = ((p.pitch ?? 5) * Math.PI) / 180
    const yaw = ((p.yaw ?? 0) * Math.PI) / 180
    const ux = Math.cos(pitch) * Math.cos(yaw), uy = Math.sin(pitch)
    put(LM[`${side}Toe`], p.ankle.x + 48 * ux, p.ankle.y + 8 + 48 * uy, legVis)
    put(LM[`${side}Heel`], p.ankle.x - 16 * ux, p.ankle.y + 8 - 16 * uy, legVis)
    feet[side === 'l' ? 'left' : 'right'] = { pitch, yaw }
  }
  lm.world = worldLandmarks(lm, hipX, hipY, feet)
  return lm
}

/**
 * 3D (world) landmarks in metres, like MediaPipe's: origin between the hips, y down, z depth.
 * Side-on camera: the player's right hip is nearer the camera (z −), so "outward" for the right foot
 * is −z and for the left foot +z. Each foot is rebuilt from its pitch and yaw.
 */
function worldLandmarks(lm, hipX, hipY, feet) {
  const m = 0.9 / L
  const world = lm.map((p) => ({ x: (p.x - hipX) * m, y: (p.y - hipY) * m, z: 0, v: p.v }))
  world[LM.lHip].z = 0.1
  world[LM.rHip].z = -0.1
  for (const [side, k, outZ] of [['left', 'l', 1], ['right', 'r', -1]]) {
    const f = feet[side]
    if (!f) continue
    const heel = world[LM[`${k}Heel`]]
    const len = 0.25
    world[LM[`${k}Toe`]] = {
      x: heel.x + len * Math.cos(f.pitch) * Math.cos(f.yaw),
      y: heel.y + len * Math.sin(f.pitch),
      z: heel.z + outZ * len * Math.cos(f.pitch) * Math.sin(f.yaw),
      v: heel.v,
    }
  }
  return world
}

const lerp = (a, b, k) => a + (b - a) * k
const lerpP = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) })

/**
 * A right-footed shot. plantBehind = standing (left) ankle distance behind the ball in leg lengths.
 * Returns frames {t, lm, ball, quality}.
 */
export function shotSequence({ plantBehind = 0.4, lean = 30, ballVisible = true, sideView = true, coreVis = 0.95, shoulderVis = coreVis, followHeight = 1.0, kickPitch = 40, kickYaw = 0, footVis = 0.95, contactSideView = sideView, backswingBeforePlant = false } = {}) {
  const frames = []
  let t = 0
  const ballX = 800
  const ground = 640
  const add = (lm, ball) => { frames.push({ t, lm, world: lm.world, ball, quality: { sideView, pose: 0.95 } }); t += 1 / FPS }
  const ballAt = (x, vx = 0) => (ballVisible ? { x, y: 630, r: 12, vx, vy: 0, conf: 0.9, detected: true } : null)

  // Setup: standing still, 0.5 s.
  for (let i = 0; i < 15; i++) add(pose({ hipX: 400, left: { ankle: { x: 390, y: ground } }, right: { ankle: { x: 410, y: ground } }, coreVis, shoulderVis }), ballAt(ballX))
  // Approach: hips (and both feet) move toward the ball at 1.25 leg lengths/s.
  const plantX = ballX - plantBehind * L
  const steps = Math.round((plantX - 20 - 400) / (1.25 * L / FPS))
  for (let i = 1; i <= steps; i++) {
    const hx = 400 + (i * 1.25 * L) / FPS
    add(pose({ hipX: hx, left: { ankle: { x: hx - 10, y: ground } }, right: { ankle: { x: hx + 10, y: ground } }, coreVis, shoulderVis }), ballAt(ballX))
  }
  // Plant + backswing: left foot stops at plantX, right ankle swings back and up (knee bends).
  const hipP = plantX + 6
  const r0 = { x: plantX - 20, y: ground }
  const rBack = { x: hipP - 90, y: 540 }
  for (let i = 1; i <= 6; i++) {
    const a = lerpP(r0, rBack, i / 6)
    // Real run-ups often draw the kicking leg back while the standing foot is still landing.
    const leftX = backswingBeforePlant ? plantX - 60 + i * 10 : plantX
    add(pose({ hipX: hipP, lean, left: { ankle: { x: leftX, y: ground } },
      right: { ankle: a, knee: { x: hipP + 10, y: 515 } }, coreVis, shoulderVis }), ballAt(ballX))
  }
  // Forward swing: right ankle drives to the ball.
  const rHit = { x: ballX - 16, y: 628 }
  for (let i = 1; i <= 5; i++) {
    const a = lerpP(rBack, rHit, i / 5)
    const lm = pose({ hipX: hipP, lean, left: { ankle: { x: plantX, y: ground } }, right: { ankle: a, pitch: kickPitch, yaw: kickYaw }, coreVis, shoulderVis })
    for (const i of [LM.rHeel, LM.rToe, LM.rAnkle]) lm[i].v = footVis
    add(lm, ballAt(ballX))
  }
  // Contact + follow-through: ball launches, kicking leg rises to followHeight leg lengths.
  const rTop = { x: ballX + 120, y: ground - followHeight * L }
  for (let i = 1; i <= 24; i++) {
    const a = lerpP(rHit, rTop, Math.min(1, i / 8))
    const bx = ballX + i * 50
    const lm = pose({ hipX: hipP + i * 2, lean, left: { ankle: { x: plantX, y: ground } }, right: { ankle: a, pitch: kickPitch, yaw: kickYaw }, coreVis, shoulderVis })
    for (const j of [LM.rHeel, LM.rToe, LM.rAnkle]) lm[j].v = footVis
    add(lm, bx < 1280 ? ballAt(bx, 1500) : null)
    // At contact the shoulders open up; a side-on camera can then look "front-on" for a moment.
    if (i <= 4) frames[frames.length - 1].quality = { sideView: contactSideView, pose: 0.95 }
  }
  // Recovery: stand still for 1.2 s.
  for (let i = 0; i < 36; i++) {
    add(pose({ hipX: hipP + 50, left: { ankle: { x: plantX, y: ground } }, right: { ankle: { x: plantX + 40, y: ground } }, coreVis, shoulderVis }), null)
  }
  return frames
}

/**
 * Dribbling across the view at 0.8 leg lengths/s, touching the ball every 0.5 s.
 * getAway: at this time (s) the ball runs 3 leg lengths ahead for a second.
 * trackedEvery: ball visible on 1 of every N frames (1 = always).
 */
export function dribbleSequence({ seconds = 5, getAway = null, trackedEvery = 1, kneeBend = true } = {}) {
  const frames = []
  const hipSpeed = 0.8 * L
  const n = Math.round(seconds * FPS)
  for (let i = 0; i < n + 45; i++) {
    const t = i / FPS
    const moving = i < n
    const hipX = 150 + hipSpeed * Math.min(t, seconds)
    const phase = (t % 0.5) / 0.5
    // Ball: pushed ahead during the first half of each 0.5 s cycle, sits during the second half.
    const cycleStart = Math.floor(t / 0.5) * 0.5
    let ballX = 150 + hipSpeed * cycleStart + 40 + (phase < 0.5 ? 2 * hipSpeed * (t - cycleStart) : hipSpeed * 0.5)
    if (!moving) ballX = 150 + hipSpeed * seconds + 60
    if (getAway !== null && t >= getAway && t < getAway + 1) ballX = hipX + 3 * L
    const step = Math.sin(t * 2 * Math.PI * 2) * 30
    const knee = (x) => ({ x: x + (kneeBend ? 45 : 2), y: 520 })
    const lm = pose({ hipX, left: { ankle: { x: hipX - step, y: 640 }, knee: knee(hipX - step / 2) },
      right: { ankle: { x: hipX + step, y: 640 }, knee: knee(hipX + step / 2) } })
    const visible = i % trackedEvery === 0
    frames.push({ t, lm, ball: visible ? { x: ballX, y: 630, r: 12, vx: 0, vy: 0, conf: 0.9, detected: true } : null,
      quality: { sideView: true, pose: 0.95 } })
  }
  return frames
}

export function run(detector, frames) {
  const attempts = []
  const phases = []
  for (const f of frames) {
    const out = detector.update(f)
    if (phases[phases.length - 1] !== out.phase) phases.push(out.phase)
    if (out.attempt) attempts.push(out.attempt)
  }
  return { attempts, phases }
}
