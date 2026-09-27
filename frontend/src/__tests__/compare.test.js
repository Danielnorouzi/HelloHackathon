// Comparison colours: higher/lower, ties, missing values, direction handling, source labels.
import { describe, expect, it } from 'vitest'
import { DIRECTIONS, rankPair, RANK_STYLE, sourceLabel } from '../compare'

describe('rankPair', () => {
  it('marks the higher value better when higher is better', () => {
    expect(rankPair(87, 65, 'higher')).toEqual({ a: 'better', b: 'worse' })
    expect(rankPair(65, 87, 'higher')).toEqual({ a: 'worse', b: 'better' })
  })

  it('flips for statistics where lower is better', () => {
    expect(rankPair(9.8, 11.2, 'lower', 1)).toEqual({ a: 'better', b: 'worse' })
  })

  it('treats equal values as a tie, at the precision shown', () => {
    expect(rankPair(70, 70, 'higher')).toEqual({ a: 'tie', b: 'tie' })
    expect(rankPair(70.2, 69.8, 'higher')).toEqual({ a: 'tie', b: 'tie' })        // both display as 70
    expect(rankPair(70.24, 70.21, 'higher', 1)).toEqual({ a: 'tie', b: 'tie' })        // both display as 70.2
    expect(rankPair(70.26, 70.24, 'higher', 1)).toEqual({ a: 'better', b: 'worse' })   // 70.3 vs 70.2
  })

  it('keeps missing values neutral on both sides', () => {
    for (const [a, b] of [[null, 70], [70, undefined], [null, null], [NaN, 70], [70, Infinity]]) {
      expect(rankPair(a, b, 'higher')).toEqual({ a: 'neutral', b: 'neutral' })
    }
  })

  it('does not colour a statistic whose direction is not confirmed', () => {
    expect(rankPair(80, 60, undefined)).toEqual({ a: 'neutral', b: 'neutral' })
    expect(rankPair(80, 60, 'unknown')).toEqual({ a: 'neutral', b: 'neutral' })
  })

  it('zero is a real value, not missing', () => {
    expect(rankPair(0, 5, 'higher')).toEqual({ a: 'worse', b: 'better' })
  })
})

describe('directions and styles', () => {
  it('has a confirmed direction for all six card attributes', () => {
    expect(Object.keys(DIRECTIONS).sort()).toEqual(['DEF', 'DRI', 'PAC', 'PAS', 'PHY', 'SHO'])
    expect(new Set(Object.values(DIRECTIONS))).toEqual(new Set(['higher']))
  })

  it('never relies on colour alone: better/worse/tie carry a text label and icon', () => {
    for (const rank of ['better', 'worse', 'tie']) {
      expect(RANK_STYLE[rank].label).not.toBe('')
      expect(RANK_STYLE[rank].icon).not.toBe('')
    }
    expect(RANK_STYLE.better.text).not.toBe(RANK_STYLE.worse.text)
  })

  it('labels imputed and self-reported values', () => {
    expect(sourceLabel('imputed')).toBe('est')
    expect(sourceLabel('self_reported')).toBe('self')
    expect(sourceLabel('measured')).toBeNull()
  })
})
