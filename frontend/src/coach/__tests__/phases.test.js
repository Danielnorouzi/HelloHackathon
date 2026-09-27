// Skill-phase detection on synthetic motion with known geometry.
import { describe, expect, it } from 'vitest'
import rules from '../../../../backend/config/coach_rules.json'
import { createShootingDetector } from '../skills/shooting'
import { createDribblingDetector } from '../skills/dribbling'
import { dribbleSequence, run, shotSequence } from './synthetic'

describe('shooting phases', () => {
  it('walks through approach → plant → follow-through → recovery and emits one attempt', () => {
    const { attempts, phases } = run(createShootingDetector({ rules }), shotSequence())
    expect(phases).toEqual(['setup', 'approach', 'plant', 'follow_through', 'recovery', 'setup'])
    expect(attempts).toHaveLength(1)
    const a = attempts[0]
    expect(a.kicking_foot).toBe('right')
    expect(a.contact_source).toBe('ball')
  })

  it('measures the standing foot behind the ball, forward lean, backswing and follow-through', () => {
    const [a] = run(createShootingDetector({ rules }), shotSequence({ plantBehind: 0.4, lean: 30, followHeight: 1.0 })).attempts
    const m = a.measurements
    expect(m.plant_offset.value).toBeCloseTo(-0.4, 1)          // 0.4 leg lengths behind the ball
    expect(m.trunk_lean.value).toBeGreaterThan(5)               // shoulders ahead of hips = over the ball
    expect(m.backswing_knee.value).toBeGreaterThan(60)
    expect(m.follow_through.value).toBeGreaterThan(0.8)
    for (const key of ['plant_offset', 'trunk_lean', 'backswing_knee', 'follow_through']) expect(m[key].conf).toBeGreaterThan(0.55)
  })

  it('detects leaning back', () => {
    const [a] = run(createShootingDetector({ rules }), shotSequence({ lean: -30 })).attempts
    expect(a.measurements.trunk_lean.value).toBeLessThan(-5)
  })

  it('without a ball track, estimates contact and withholds the plant-foot measurement', () => {
    const [a] = run(createShootingDetector({ rules }), shotSequence({ ballVisible: false })).attempts
    expect(a.contact_source).toBe('estimated')
    expect(a.measurements.plant_offset).toMatchObject({ value: null, reason: 'ball_not_at_contact' })
    expect(a.measurements.trunk_lean.value).not.toBeNull()      // body-only measures still usable
  })

  it('facing the camera: the standing-foot distance is unreliable, so it is withheld', () => {
    const [a] = run(createShootingDetector({ rules }), shotSequence({ sideView: false })).attempts
    expect(a.measurements.plant_offset).toMatchObject({ value: null, reason: 'facing_camera' })
  })

  it('hidden shoulders withhold lean with a reason instead of guessing (other measures still work)', () => {
    const [a] = run(createShootingDetector({ rules }), shotSequence({ shoulderVis: 0.3 })).attempts
    expect(a.measurements.trunk_lean).toMatchObject({ value: null, reason: 'low_pose' })
    expect(a.measurements.plant_offset.value).toBeCloseTo(-0.4, 1)
  })

  it('respects a chosen kicking foot (a left-footed filter ignores this right-footed shot)', () => {
    const { attempts } = run(createShootingDetector({ rules, kickingFoot: 'left' }), shotSequence())
    expect(attempts).toHaveLength(0)
  })

  it('no person in view: no attempts, no crash', () => {
    const frames = shotSequence().map((f) => ({ ...f, lm: null }))
    expect(run(createShootingDetector({ rules }), frames).attempts).toHaveLength(0)
  })
})

describe('dribbling phases', () => {
  it('detects a run, counts touches and close control', () => {
    const { attempts, phases } = run(createDribblingDetector({ rules }), dribbleSequence({ seconds: 5 }))
    expect(phases[0]).toBe('setup')
    expect(phases).toContain('dribbling')
    expect(attempts).toHaveLength(1)
    const m = attempts[0].measurements
    expect(attempts[0].touches).toBeGreaterThanOrEqual(8)       // one push every 0.5 s ≈ 10
    expect(attempts[0].touches).toBeLessThanOrEqual(11)          // the ball stopping is not a touch
    expect(m.touch_rate.value).toBeGreaterThan(1.5)
    expect(m.close_control_pct.value).toBeGreaterThan(90)
    expect(m.lost_control.value).toBe(0)
    expect(m.knee_bend.value).toBeGreaterThan(20)
  })

  it('flags the ball getting away', () => {
    const { attempts, phases } = run(createDribblingDetector({ rules }), dribbleSequence({ seconds: 6, getAway: 2 }))
    expect(phases).toContain('lost_control')
    expect(attempts[0].measurements.lost_control.value).toBeGreaterThanOrEqual(1)
    expect(attempts[0].measurements.close_control_pct.value).toBeLessThan(90)
  })

  it('splits long continuous dribbling into 8-second windows', () => {
    const { attempts } = run(createDribblingDetector({ rules }), dribbleSequence({ seconds: 17 }))
    expect(attempts.length).toBeGreaterThanOrEqual(2)            // two full 8 s windows (+ the tail if ≥ 2 s)
    expect(attempts[0].duration).toBeCloseTo(8, 0)
    expect(attempts[1].duration).toBeCloseTo(8, 0)
  })

  it('withholds ball measurements when the ball is tracked too rarely, keeps body measurements', () => {
    const [a] = run(createDribblingDetector({ rules }), dribbleSequence({ trackedEvery: 3 })).attempts
    expect(a.measurements.close_control_pct).toMatchObject({ value: null, reason: 'ball_not_tracked' })
    expect(a.measurements.touch_rate.value).toBeNull()
    expect(a.measurements.knee_bend.value).not.toBeNull()
  })

  it('upright stance is measured as low knee bend', () => {
    const [a] = run(createDribblingDetector({ rules }), dribbleSequence({ kneeBend: false })).attempts
    expect(a.measurements.knee_bend.value).toBeLessThan(20)
  })
})

describe('lower frame rates (slow devices)', () => {
  const every = (frames, n) => frames.filter((_, i) => i % n === 0)

  it('still detects a shot and its plant-foot position at 10 fps', () => {
    const { attempts } = run(createShootingDetector({ rules }), every(shotSequence({ plantBehind: 0.4 }), 3))
    expect(attempts).toHaveLength(1)
    expect(attempts[0].measurements.plant_offset.value).toBeCloseTo(-0.4, 1)
  })

  it('still counts dribbling touches at 10 fps', () => {
    const [a] = run(createDribblingDetector({ rules }), every(dribbleSequence({ seconds: 5 }), 3)).attempts
    expect(a.measurements.touch_rate.value).toBeGreaterThan(1.2)
    expect(a.measurements.close_control_pct.value).toBeGreaterThan(90)
  })
})
