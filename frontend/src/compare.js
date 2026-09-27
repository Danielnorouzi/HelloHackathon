// Colour rule for "Compare with a pro": which of two values is better, per statistic.
//
// Direction check (is a higher number better?), confirmed per statistic before colouring:
//   PAC, SHO, PAS, DRI, DEF, PHY are 40–99 card ratings. Pro ratings are built from percentiles
//   where a higher percentile means more of a desirable action per 90 (goals, xG, progressive
//   passes, successful dribbles, possession-adjusted tackles and so on). User ratings come from
//   skill tests scored so that faster times and more successful reps score higher. So for all six,
//   higher = better.
// A statistic without a confirmed direction is never coloured (neutral), and neither are missing
// values or ties (compared at the precision shown on screen, so "70 vs 70" is always a tie).

export const DIRECTIONS = { PAC: 'higher', SHO: 'higher', PAS: 'higher', DRI: 'higher', DEF: 'higher', PHY: 'higher' }

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Rank two values. Returns { a, b } where each is 'better' | 'worse' | 'tie' | 'neutral'.
 * direction: 'higher' (higher is better), 'lower' (lower is better), anything else: not comparable.
 */
export function rankPair(a, b, direction, decimals = 0) {
  if (!isNumber(a) || !isNumber(b) || (direction !== 'higher' && direction !== 'lower')) {
    return { a: 'neutral', b: 'neutral' }
  }
  const round = (v) => Number(v.toFixed(decimals))
  const ra = round(a), rb = round(b)
  if (ra === rb) return { a: 'tie', b: 'tie' }
  const aBetter = direction === 'higher' ? ra > rb : ra < rb
  return aBetter ? { a: 'better', b: 'worse' } : { a: 'worse', b: 'better' }
}

/** Visual style for a rank: colour plus a text cue, so colour is never the only signal. */
export const RANK_STYLE = {
  better: { text: 'text-good', bar: 'bg-good', label: 'higher', icon: '▲' },
  worse: { text: 'text-orange-400', bar: 'bg-orange-400', label: 'lower', icon: '▼' },
  tie: { text: 'text-gray-300', bar: 'bg-gray-400', label: 'tie', icon: '=' },
  neutral: { text: 'text-muted', bar: 'bg-surface-2', label: '', icon: '' },
}

/** Short label for where a value came from (shown next to it). */
export function sourceLabel(source) {
  if (source === 'imputed') return 'est'
  if (source === 'self_reported') return 'self'
  return null
}
