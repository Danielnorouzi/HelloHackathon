// The browser rule engine must agree with the server's (same shared cases as backend/tests).
import { describe, expect, it } from 'vitest'
import rules from '../../../../backend/config/coach_rules.json'
import fixture from '../../../../backend/tests/fixtures/coach_rule_cases.json'
import { evaluateAttempt, formatMeasure, mainTrackingIssue } from '../rules'

describe('rule evaluation (shared cases with the Python backend)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const r = evaluateAttempt(c.skill, c.measurements, rules)
      expect(r.corrections.map((x) => x.key)).toEqual(c.corrections)
      expect([...r.good].sort()).toEqual([...c.good].sort())
      expect(r.withheld).toEqual(c.withheld)
    })
  }
})

describe('helpers', () => {
  it('picks the most basic tracking problem first', () => {
    const r = { withheld: [{ measure: 'a', reason: 'low_pose' }, { measure: 'b', reason: 'ball_not_at_contact' }] }
    expect(mainTrackingIssue(r, rules)).toBe('ball_not_at_contact')
  })

  it('formats values in leg lengths and degrees, never speeds', () => {
    const d = rules.skills.shooting.measurements
    expect(formatMeasure(-0.4, d.plant_offset)).toBe('0.40 leg lengths behind the ball')
    expect(formatMeasure(-8, d.trunk_lean)).toBe('8° leaning back')
    expect(formatMeasure(72.4, rules.skills.dribbling.measurements.close_control_pct)).toBe('72%')
  })
})
