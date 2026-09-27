// Cue selection: priority, confirmation, debouncing, cooldowns, tracking withholds, praise.
import { describe, expect, it } from 'vitest'
import rules from '../../../../backend/config/coach_rules.json'
import { createCueScheduler } from '../feedback'

const S = 1000   // ms
const good = { plant_offset: { value: 0, conf: 0.9 }, trunk_lean: { value: 10, conf: 0.9 }, follow_through: { value: 1, conf: 0.9 } }
const shot = (overrides = {}) => ({ measurements: { ...good, ...overrides } })
const plantBehind = { plant_offset: { value: -0.5, conf: 0.9 } }      // priority 3 (urgent)
const shortFollow = { follow_through: { value: 0.2, conf: 0.9 } }     // priority 2 (needs confirmation)
const leanBack = { trunk_lean: { value: -12, conf: 0.9 } }            // priority 3

describe('cue scheduler', () => {
  it('speaks an urgent correction right after the attempt', () => {
    const s = createCueScheduler(rules, 'shooting')
    const { cue } = s.onAttempt(shot(plantBehind), 0)
    expect(cue).toMatchObject({ key: 'plant_behind', kind: 'correction' })
  })

  it('says only one cue per attempt, the highest priority', () => {
    const s = createCueScheduler(rules, 'shooting')
    const { cue, result } = s.onAttempt(shot({ ...shortFollow, ...leanBack }), 0)
    expect(result.corrections.map((c) => c.key)).toEqual(['leaning_back', 'short_follow_through'])
    expect(cue.key).toBe('leaning_back')
  })

  it('waits for a minor issue to repeat before mentioning it', () => {
    const s = createCueScheduler(rules, 'shooting')
    expect(s.onAttempt(shot(shortFollow), 0).cue).toBeNull()                 // once: could be noise
    expect(s.onAttempt(shot(shortFollow), 10 * S).cue.key).toBe('short_follow_through')   // 2 of last 3
  })

  it('never talks within the minimum gap; a deferred cue is released later by tick()', () => {
    const s = createCueScheduler(rules, 'shooting')
    s.onAttempt(shot(plantBehind), 0)
    const second = s.onAttempt(shot(leanBack), 3 * S)
    expect(second.cue).toBeNull()
    expect(second.deferred).toBe(true)
    expect(s.tick(4 * S)).toBeNull()                                          // still inside the 6 s gap
    expect(s.tick(6 * S)).toMatchObject({ key: 'leaning_back' })
  })

  it('drops a deferred cue that went stale', () => {
    const s = createCueScheduler(rules, 'shooting')
    s.onAttempt(shot(plantBehind), 0)
    s.onAttempt(shot(leanBack), 1 * S)
    expect(s.tick(6 * S)).toBeNull()                                          // queued at 1 s, stale after 4 s
  })

  it('does not repeat the same cue within its cooldown, then rephrases it', () => {
    const s = createCueScheduler(rules, 'shooting')
    const first = s.onAttempt(shot(plantBehind), 0).cue
    expect(s.onAttempt(shot(plantBehind), 8 * S).cue).toBeNull()             // gap passed, cooldown not
    const again = s.onAttempt(shot(plantBehind), 21 * S).cue
    expect(again.key).toBe('plant_behind')
    expect(again.text).not.toBe(first.text)                                   // alternative wording
  })

  it('backs off for longer once a cue has been said several times', () => {
    const s = createCueScheduler(rules, 'shooting')
    for (const t of [0, 21, 42]) expect(s.onAttempt(shot(plantBehind), t * S).cue).not.toBeNull()
    expect(s.onAttempt(shot(plantBehind), 63 * S).cue).toBeNull()            // 21 s later: extended 45 s cooldown
    expect(s.onAttempt(shot(plantBehind), 88 * S).cue).not.toBeNull()
  })

  it('withholds a correction from low-confidence data and gives a setup hint instead', () => {
    const s = createCueScheduler(rules, 'shooting')
    const blurred = { plant_offset: { value: -0.9, conf: 0.2, reason: null }, trunk_lean: { value: null, conf: 0, reason: 'low_pose' } }
    const { cue, result } = s.onAttempt({ measurements: blurred }, 0)
    expect(result.corrections).toEqual([])
    expect(cue).toMatchObject({ kind: 'tracking', key: 'tracking:low_pose' })
    expect(s.onAttempt({ measurements: blurred }, 10 * S).cue).toBeNull()    // tracking hints: 30 s cooldown
  })

  it('names the specific tracking problem (ball not seen at contact)', () => {
    const s = createCueScheduler(rules, 'shooting')
    const { cue } = s.onAttempt(shot({ plant_offset: { value: null, conf: 0, reason: 'ball_not_at_contact' } }), 0)
    expect(cue.text).toBe(rules.tracking.messages.ball_not_at_contact)
  })

  it('stays silent while the player or coach is talking, then catches up', () => {
    const s = createCueScheduler(rules, 'shooting')
    s.setBusy(true)
    expect(s.onAttempt(shot(plantBehind), 0).cue).toBeNull()
    expect(s.tick(1 * S)).toBeNull()
    s.setBusy(false)
    expect(s.tick(2 * S)).toMatchObject({ key: 'plant_behind' })
  })

  it('praises a fix once, but not unprompted', () => {
    const s = createCueScheduler(rules, 'shooting')
    expect(s.onAttempt(shot(), 0).cue).toBeNull()                            // good but never corrected: silence
    s.onAttempt(shot(plantBehind), 10 * S)
    const praise = s.onAttempt(shot(), 20 * S).cue
    expect(praise).toMatchObject({ kind: 'positive', measure: 'plant_offset' })
    expect(s.onAttempt(shot(), 30 * S).cue).toBeNull()                        // only once
  })

  it('live tracking hints share the gap and cooldown rules', () => {
    const s = createCueScheduler(rules, 'dribbling')
    expect(s.onTrackingProblem('no_ball', 0)).toMatchObject({ key: 'tracking:no_ball' })
    expect(s.onTrackingProblem('no_ball', 7 * S)).toBeNull()
    expect(s.onTrackingProblem('no_ball', 31 * S)).not.toBeNull()
  })
})
