// Shooting contact area: target before the shot, detected part after it, correct or not.
import { describe, expect, it } from 'vitest'
import rules from '../../../../backend/config/coach_rules.json'
import { LM } from '../geometry'
import { classifyContact, contactStats, createContactCoach, footYaw3D } from '../contact'
import { createShootingDetector } from '../skills/shooting'
import { createCueScheduler } from '../feedback'
import { run, shotSequence } from './synthetic'

const T = rules.skills.shooting.contact
const shoot = (opts) => run(createShootingDetector({ rules }), shotSequence(opts)).attempts[0]

/** World landmarks for one foot turned by `yaw` degrees (+ = toes out), side-on camera. */
function world(side, yaw, dir = 1) {
  const w = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 0.9 }))
  w[LM.lHip] = { x: 0, y: 0, z: 0.1, v: 0.9 }
  w[LM.rHip] = { x: 0, y: 0, z: -0.1, v: 0.9 }
  const k = side === 'left' ? 'l' : 'r'
  const out = side === 'left' ? 1 : -1                  // player's right is -z here
  const r = (yaw * Math.PI) / 180
  w[LM[`${k}Heel`]] = { x: 0, y: 0.9, z: 0, v: 0.9 }
  w[LM[`${k}Toe`]] = { x: 0.25 * Math.cos(r) * dir, y: 0.9, z: out * 0.25 * Math.sin(r), v: 0.9 }
  return w
}

describe('foot direction in 3D', () => {
  it('measures toes out (+) and toes in (−) for either foot and kick direction', () => {
    expect(footYaw3D(world('right', 0), 'right', 1)).toBeCloseTo(0)
    expect(footYaw3D(world('right', 80), 'right', 1)).toBeCloseTo(80)
    expect(footYaw3D(world('right', -60), 'right', 1)).toBeCloseTo(-60)
    expect(footYaw3D(world('left', 70), 'left', 1)).toBeCloseTo(70)
    expect(footYaw3D(world('right', 70, -1), 'right', -1)).toBeCloseTo(70)
    expect(footYaw3D(null, 'right', 1)).toBeNull()
  })
})

describe('classifying one frame', () => {
  it('maps foot direction and angle to a part of the boot', () => {
    expect(classifyContact({ yaw: 70, pitch: 5 }, T)).toBe('inside')
    expect(classifyContact({ yaw: -50, pitch: 5 }, T)).toBe('outside')
    expect(classifyContact({ yaw: 5, pitch: 40 }, T)).toBe('laces')
    expect(classifyContact({ yaw: 0, pitch: -5, along: 1.0 }, T)).toBe('toe')
    expect(classifyContact({ yaw: null, pitch: 30, foreshortened: true }, T)).toBe('side')   // 2D only: which side is unknown
    expect(classifyContact({ yaw: null, pitch: null }, T)).toBeNull()
  })
})

describe('contact area from a shot', () => {
  it('toes forward and down: laces', () => {
    const a = shoot({ kickPitch: 40, kickYaw: 0 })
    expect(a.contact.zone).toBe('laces')
    expect(a.contact.conf).toBeGreaterThanOrEqual(rules.confidence.measurement_min)
  })
  it('foot turned out: inside of the foot', () => expect(shoot({ kickPitch: 5, kickYaw: 80 }).contact.zone).toBe('inside'))
  it('foot turned in: outside of the foot', () => expect(shoot({ kickPitch: 5, kickYaw: -60 }).contact.zone).toBe('outside'))
  it('toes up, foot forward: toe', () => expect(shoot({ kickPitch: -12, kickYaw: 0 }).contact.zone).toBe('toe'))
  it('kicking foot hard to see: withheld, not guessed', () => {
    expect(shoot({ footVis: 0.3 }).contact).toMatchObject({ zone: null, reason: 'foot_unclear' })
  })
})

describe('fixes from real sessions', () => {
  it('side-on is judged from the run-up, so opening the shoulders at contact no longer withholds the plant foot', () => {
    const a = shoot({ contactSideView: false })
    expect(a.quality.side_view).toBe(true)
    expect(a.measurements.plant_offset.value).toBeCloseTo(-0.4, 1)
  })
  it('the backswing is measured even when the leg is drawn back before the standing foot lands', () => {
    const a = shoot({ backswingBeforePlant: true })
    expect(a).toBeDefined()
    expect(a.measurements.backswing_knee.value).toBeGreaterThan(60)
  })
  it('a camera that really is front-on still withholds it', () => {
    expect(shoot({ sideView: false }).measurements.plant_offset).toMatchObject({ value: null, reason: 'facing_camera' })
  })
})

describe('per-shot feedback', () => {
  it('announces the target for each shot type', () => {
    expect(createContactCoach(rules, 'driven')).toMatchObject({ target: 'laces' })
    expect(createContactCoach(rules, 'placed')).toMatchObject({ target: 'inside' })
    expect(createContactCoach(rules, 'outside').instruction).toContain('outside of your foot')
    expect(createContactCoach(rules, 'nonsense').target).toBe('laces')
  })

  it('says the wrong part and the right one, every time', () => {
    const coach = createContactCoach(rules, 'driven')
    const fb = coach.assess({ zone: 'toe', conf: 0.8 })
    expect(fb).toMatchObject({ status: 'incorrect', detected: 'toe', target: 'laces', speak: true })
    expect(fb.text).toBe('You struck it with your toe. Use your laces: toes down and ankle locked.')
    expect(coach.assess({ zone: 'inside', conf: 0.8 }).speak).toBe(true)
  })

  it('confirms a correct contact, then only every third one in a row', () => {
    const coach = createContactCoach(rules, 'placed')
    const spoken = [1, 2, 3, 4, 5, 6].map(() => coach.assess({ zone: 'inside', conf: 0.8 }))
    expect(spoken[0]).toMatchObject({ status: 'correct', text: 'Inside of the foot, correct.', speak: true })
    expect(spoken.map((f) => f.speak)).toEqual([true, false, true, false, false, true])
  })

  it('an unclear contact is shown, and a setup tip is spoken after three in a row', () => {
    const coach = createContactCoach(rules, 'driven')
    const fbs = [1, 2, 3].map(() => coach.assess({ zone: null, conf: 0.2, reason: 'foot_unclear' }))
    expect(fbs.map((f) => f.status)).toEqual(['unclear', 'unclear', 'unclear'])
    expect(fbs.map((f) => f.speak)).toEqual([false, false, true])
    expect(fbs[2].spokenText).toBe(rules.tracking.messages.foot_unclear)
  })

  it('"side of the foot" (2D only) is unclear for an inside/outside target but wrong for laces', () => {
    expect(createContactCoach(rules, 'placed').assess({ zone: 'side', conf: 0.6 }).status).toBe('unclear')
    expect(createContactCoach(rules, 'driven').assess({ zone: 'side', conf: 0.6 }).status).toBe('incorrect')
  })
})

describe('scheduler with contact feedback', () => {
  const plantBehind = { plant_offset: { value: -0.5, conf: 0.9 } }

  it('a wrong contact is said on its own, highlighting the target area', () => {
    const s = createCueScheduler(rules, 'shooting')
    const fb = createContactCoach(rules, 'driven').assess({ zone: 'inside', conf: 0.8 })
    const { cue } = s.onAttempt({ measurements: plantBehind }, 0, fb)
    expect(cue).toMatchObject({ kind: 'correction', zones: ['laces'] })
    expect(cue.text).toBe(fb.text)
  })

  it('a correct contact and a technique correction go in one sentence', () => {
    const s = createCueScheduler(rules, 'shooting')
    const fb = createContactCoach(rules, 'driven').assess({ zone: 'laces', conf: 0.8 })
    const { cue } = s.onAttempt({ measurements: plantBehind }, 0, fb)
    expect(cue.text).toBe(`Laces, correct. ${rules.skills.shooting.cues.find((c) => c.key === 'plant_behind').text}`)
    expect(s.onAttempt({ measurements: plantBehind }, 8000, null).cue).toBeNull()   // the correction's cooldown was recorded
  })

  it('without spoken contact feedback, normal cues work as before', () => {
    const s = createCueScheduler(rules, 'shooting')
    expect(s.onAttempt({ measurements: plantBehind }, 0, { status: 'correct', speak: false }).cue.key).toBe('plant_behind')
  })
})

describe('session contact stats (offline summary)', () => {
  it('counts judged shots against the target and leaves unclear ones out', () => {
    const at = (zone, status) => ({ contact: { zone, target: 'laces', status } })
    expect(contactStats([at('laces', 'correct'), at('toe', 'incorrect'), at(null, 'unclear'), at('laces', 'correct')]))
      .toEqual({ target: 'laces', shots: 4, judged: 3, correct: 2, zones: { laces: 2, toe: 1 } })
    expect(contactStats([{ measurements: {} }])).toBeNull()
  })
})
