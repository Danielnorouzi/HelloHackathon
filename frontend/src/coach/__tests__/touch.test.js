// Touch-quality coaching: only when tracking supports it; cues carry the boot zones to highlight.
import { describe, expect, it } from 'vitest'
import rules from '../../../../backend/config/coach_rules.json'
import { createShootingDetector } from '../skills/shooting'
import { createDribblingDetector } from '../skills/dribbling'
import { evaluateAttempt } from '../rules'
import { alongFoot, footPitch } from '../geometry'
import { dribbleSequence, run, shotSequence } from './synthetic'

describe('foot geometry', () => {
  it('locates a point along the foot (0 = heel, 1 = toe)', () => {
    const heel = { x: 0, y: 0 }, toe = { x: 100, y: 0 }
    expect(alongFoot(heel, toe, { x: 50, y: 10 }).t).toBeCloseTo(0.5)
    expect(alongFoot(heel, toe, { x: 110, y: 0 }).t).toBeCloseTo(1.1)
    expect(alongFoot(heel, heel, { x: 5, y: 5 }).t).toBeNull()
  })
  it('measures toes-down as a positive angle', () => {
    expect(footPitch({ x: 0, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(45)
    expect(footPitch({ x: 0, y: 0 }, { x: 10, y: -5 })).toBeLessThan(0)
  })
})

describe('shooting: kicking-foot angle', () => {
  it('measures a toes-down strike and raises no cue', () => {
    const [a] = run(createShootingDetector({ rules }), shotSequence({ kickPitch: 40 })).attempts
    expect(a.measurements.foot_pitch.value).toBeCloseTo(40, 0)
    expect(evaluateAttempt('shooting', a.measurements, rules).corrections.map((c) => c.key)).not.toContain('toes_up')
  })

  it('facing the camera: the foot angle is withheld, not guessed', () => {
    const [a] = run(createShootingDetector({ rules }), shotSequence({ sideView: false, kickPitch: -10 })).attempts
    expect(a.measurements.foot_pitch).toMatchObject({ value: null, reason: 'facing_camera' })
  })
})

describe('dribbling: touch quality', () => {
  it('soft touches: judged, 0% heavy, toe-touch share measured', () => {
    const [a] = run(createDribblingDetector({ rules }), dribbleSequence({ seconds: 5 })).attempts
    expect(a.measurements.heavy_touch_pct.value).toBe(0)
    expect(a.measurements.toe_touch_pct.value).not.toBeNull()
    expect(a.measurements.toe_touch_pct.conf).toBeGreaterThan(0.55)
  })

  it('a touch that sends the ball away counts as heavy', () => {
    const [a] = run(createDribblingDetector({ rules }), dribbleSequence({ seconds: 6, getAway: 2 })).attempts
    expect(a.measurements.heavy_touch_pct.value).toBeGreaterThan(0)
  })

  it('without a reliable ball track, touch quality is withheld with the reason', () => {
    const [a] = run(createDribblingDetector({ rules }), dribbleSequence({ trackedEvery: 3 })).attempts
    expect(a.measurements.heavy_touch_pct).toMatchObject({ value: null, reason: 'ball_not_tracked' })
    expect(a.measurements.toe_touch_pct).toMatchObject({ value: null, reason: 'ball_not_tracked' })
  })

  it('heavy-touch cue highlights the inside of the foot; toe pokes highlight inside and outside', () => {
    const r = evaluateAttempt('dribbling', {
      heavy_touch_pct: { value: 60, conf: 0.8 }, toe_touch_pct: { value: 70, conf: 0.8 } }, rules)
    expect(Object.fromEntries(r.corrections.map((c) => [c.key, c.zones]))).toEqual({
      heavy_touches: ['inside'], toe_pokes: ['inside', 'outside'] })
  })
})
