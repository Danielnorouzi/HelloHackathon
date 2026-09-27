// Live Coach ball-missing alert: debounced chime, respects mute, re-arms only when the ball is back.
import { describe, expect, it } from 'vitest'
import { createBallAlert, isBallAlert } from '../alerts'

const S = 1000

function simulate(alert, events) {
  // events: [{ t (s), missing, muted? }] → list of times (s) a chime played
  return events.filter(({ t, missing, muted = false }) => alert.update({ now: t * S, ballMissing: missing, muted })).map((e) => e.t)
}

const missingEvery = (from, to, step = 0.5, muted = false) => {
  const out = []
  for (let t = from; t <= to; t += step) out.push({ t, missing: true, muted })
  return out
}

describe('ball-missing alert', () => {
  it('chimes straight away, then at most once per 8 seconds', () => {
    const played = simulate(createBallAlert(), missingEvery(0, 20))
    expect(played).toEqual([0, 8, 16])
  })

  it('stops after 3 chimes while the ball stays missing', () => {
    expect(simulate(createBallAlert(), missingEvery(0, 60))).toHaveLength(3)
  })

  it('re-arms only after the ball has been visible for a while', () => {
    const alert = createBallAlert()
    simulate(alert, missingEvery(0, 40))                                   // 3 chimes used
    expect(simulate(alert, [{ t: 41, missing: false }, { t: 41.2, missing: true }])).toEqual([])   // brief sighting: no reset
    const again = simulate(alert, [{ t: 42, missing: false }, { t: 43.6, missing: false }, { t: 44, missing: true }])
    expect(again).toEqual([44])                                            // visible 1.6 s, then missing: chimes again
  })

  it('never plays while muted, and muted time does not use up the repeats', () => {
    const alert = createBallAlert()
    expect(simulate(alert, missingEvery(0, 30, 0.5, true))).toEqual([])
    expect(alert.repeats).toBe(0)
    expect(simulate(alert, [{ t: 31, missing: true }])).toEqual([31])     // unmuted: chimes
  })

  it('does not chime while the ball is visible', () => {
    expect(simulate(createBallAlert(), [{ t: 0, missing: false }, { t: 5, missing: false }])).toEqual([])
  })

  it('routes only ball-visibility tracking cues to the chime', () => {
    expect(isBallAlert({ key: 'tracking:no_ball' })).toBe(true)
    expect(isBallAlert({ key: 'tracking:ball_not_at_contact' })).toBe(true)
    expect(isBallAlert({ key: 'tracking:feet_out' })).toBe(false)          // other setup problems are still spoken
    expect(isBallAlert({ key: 'plant_behind' })).toBe(false)
    expect(isBallAlert(null)).toBe(false)
  })
})
