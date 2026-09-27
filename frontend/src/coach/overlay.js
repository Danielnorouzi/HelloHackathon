// Canvas overlay on the live preview: skeleton (dimmed where tracking is unsure), feet, the ball
// with a short trail and a confidence ring, the standing/kicking foot during a shot, and the
// search area used to find the ball.
import { LM } from './geometry'

const BONES = [
  [LM.lShoulder, LM.rShoulder], [LM.lShoulder, LM.lHip], [LM.rShoulder, LM.rHip], [LM.lHip, LM.rHip],
  [LM.lHip, LM.lKnee], [LM.lKnee, LM.lAnkle], [LM.rHip, LM.rKnee], [LM.rKnee, LM.rAnkle],
  [LM.lAnkle, LM.lHeel], [LM.lHeel, LM.lToe], [LM.lAnkle, LM.lToe],
  [LM.rAnkle, LM.rHeel], [LM.rHeel, LM.rToe], [LM.rAnkle, LM.rToe],
]
const LEFT = '#3987e5'     // left side: blue
const RIGHT = '#d95926'    // right side: orange (validated pair)
const ACCENT = '#c6ff3d'
const isLeft = (i) => [LM.lShoulder, LM.lHip, LM.lKnee, LM.lAnkle, LM.lHeel, LM.lToe].includes(i)

export function drawOverlay(ctx, { width, height, lm, ball, trail, roi, highlight }) {
  ctx.clearRect(0, 0, width, height)
  const unit = Math.max(2, width / 400)

  if (roi) {
    ctx.save()
    ctx.setLineDash([6 * unit, 6 * unit])
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = unit
    ctx.strokeRect(roi.x, roi.y, roi.w, roi.h)
    ctx.restore()
  }

  if (lm) {
    for (const [a, b] of BONES) {
      const p = lm[a], q = lm[b]
      const conf = Math.min(p.v, q.v)
      ctx.globalAlpha = conf > 0.6 ? 0.95 : 0.35
      ctx.setLineDash(conf > 0.6 ? [] : [4 * unit, 4 * unit])
      ctx.strokeStyle = isLeft(a) && isLeft(b) ? LEFT : !isLeft(a) && !isLeft(b) ? RIGHT : '#e8eaee'
      ctx.lineWidth = 2.5 * unit
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
    }
    ctx.setLineDash([])
    for (const i of [LM.lAnkle, LM.rAnkle, LM.lToe, LM.rToe, LM.lKnee, LM.rKnee, LM.lHip, LM.rHip]) {
      const p = lm[i]
      ctx.globalAlpha = p.v > 0.6 ? 1 : 0.4
      ctx.fillStyle = isLeft(i) ? LEFT : RIGHT
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.5 * unit, 0, Math.PI * 2)
      ctx.fill()
    }
    // Standing / kicking foot markers during a shot.
    if (highlight?.support) {
      const p = lm[highlight.support === 'left' ? LM.lAnkle : LM.rAnkle]
      ctx.globalAlpha = 1
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 2 * unit
      ctx.beginPath()
      ctx.arc(p.x, p.y, 10 * unit, 0, Math.PI * 2)
      ctx.stroke()
      label(ctx, 'standing foot', p.x, p.y + 22 * unit, unit)
    }
    ctx.globalAlpha = 1
  }

  // Ball trail and position; the ring shows tracking confidence, dashed when the ball is predicted.
  if (trail?.length > 1) {
    ctx.strokeStyle = 'rgba(198,255,61,0.5)'
    ctx.lineWidth = 2 * unit
    ctx.beginPath()
    trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.stroke()
  }
  if (ball) {
    const r = Math.max(ball.r, 6 * unit)
    ctx.setLineDash(ball.detected ? [] : [3 * unit, 3 * unit])
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 2.5 * unit
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, r + 4 * unit, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, r + 8 * unit, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, ball.conf))
    ctx.stroke()
    label(ctx, `ball ${Math.round(ball.conf * 100)}%`, ball.x, ball.y - r - 14 * unit, unit)
  }
}

function label(ctx, text, x, y, unit) {
  ctx.font = `${11 * unit}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(10,11,13,0.75)'
  const w = ctx.measureText(text).width + 10 * unit
  ctx.fillRect(x - w / 2, y - 10 * unit, w, 14 * unit)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, x, y + 1 * unit)
}
