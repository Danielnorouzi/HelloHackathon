// Game-style player card. Click any attribute to see the stats and percentiles behind it.
// Attributes that event data can't measure (PAC, PHY for pros) show "N/A" instead of an invented number.
import { ConfidenceBadge, InfoTip } from './ui'
import { PercentileBar, formatValue } from './charts/StatsTable'

const ORDER = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY']

export default function PlayerCard({ card, name, subtitle, variant = 'pro', compact = false, onSelect, selected }) {
  const attrs = card.attributes
  const accent = variant === 'pro' ? 'from-accent/25' : 'from-sky-400/25'
  return (
    <div className={`relative rounded-3xl border border-line bg-gradient-to-b ${accent} via-surface to-surface p-6 ${compact ? 'w-full' : 'w-full max-w-sm'} shadow-2xl`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-6xl font-black leading-none tabular-nums">{card.ovr ?? 'n/a'}</div>
          <div className="text-xs font-semibold tracking-widest text-muted mt-1 flex items-center gap-1">
            OVR
            {card.ovr_weights && (
              <InfoTip text={`Position-weighted average (${card.position_group}): ${Object.entries(card.ovr_weights)
                .map(([k, w]) => `${k} ${Math.round(w * 100)}%`).join(', ')}. PAC and PHY are excluded because they can't be measured from event data.`} />
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold">{card.position_group}</div>
          <div className="mt-2"><ConfidenceBadge confidence={card.confidence} /></div>
        </div>
      </div>

      <div className="mt-6">
        <div className="text-xl font-extrabold tracking-tight truncate">{name}</div>
        {subtitle && <div className="text-xs text-muted truncate">{subtitle}</div>}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-5 border-t border-line pt-4">
        {ORDER.map((code) => {
          const a = attrs[code]
          const na = a.value == null
          return (
            <button key={code} type="button" onClick={() => onSelect?.(code)}
              className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-left transition ${selected === code
                ? 'bg-accent/15 ring-1 ring-accent/60' : 'hover:bg-surface-2'}`}>
              <span className="text-sm font-bold text-muted">{code}</span>
              <span className={`tabular-nums ${na ? 'text-xs text-muted' : 'text-xl font-extrabold'}`}>
                {na ? 'N/A' : a.value}{a.source === 'imputed' && <sup className="text-[9px] text-yellow-300 ml-0.5" title={a.basis}>est</sup>}{a.source === 'self_reported' && <sup className="text-[9px] text-sky-300 ml-0.5" title="Self-reported from your answers, not measured">self</sup>}
              </span>
            </button>
          )
        })}
      </div>
      {card.imputed?.length > 0 && <p className="text-[11px] text-yellow-300 mt-3">est = imputed from a median of measured players, not measured for this player.</p>}
      {card.self_reported?.length > 0 && <p className="text-[11px] text-sky-300 mt-3">self = from your own answers, not measured. Not included in OVR.</p>}
      {onSelect && <p className="text-[11px] text-muted mt-3">Click an attribute to see the evidence.</p>}
    </div>
  )
}

/** The stats and percentiles behind one attribute. */
export function Evidence({ card, code }) {
  const a = card.attributes[code]
  if (!a) return null
  if (a.value == null) {
    return (
      <div>
        <h3 className="font-semibold">{a.label} ({code})</h3>
        <p className="text-sm text-muted mt-2">{a.note}</p>
        {card.source !== 'skill_tests' && (code === 'PAC' || code === 'PHY') ? (
          <p className="text-sm text-muted mt-2">Event data records what a player does with the ball, not how fast they run
            or how strong they are. Measuring these needs tracking data (positions of every player, many times per second),
            which isn't freely available.</p>
        ) : null}
      </div>
    )
  }
  const fromTests = card.source === 'skill_tests'
  return (
    <div>
      <h3 className="font-semibold">{a.label} ({code}) = {a.value}</h3>
      {a.source === 'imputed' && (
        <p className="text-xs text-yellow-300 mt-1">Imputed, not measured. {a.basis}</p>
      )}
      {a.source === 'self_reported' && (
        <p className="text-xs text-sky-300 mt-1">Self-reported from your answers below. This is your own view, not a measured result, and it isn't part of your OVR.</p>
      )}
      {a.source !== 'imputed' && (
        <p className="text-sm text-muted mt-1">
          {a.source === 'self_reported'
            ? 'Average of the scores for your answers below (each answer scores 45 to 85).'
            : fromTests
              ? 'Average score of the tests below, each placed on the benchmark table for your age group.'
              : `Average percentile ${a.percentile} of the stats below, mapped to the 40 to 99 card scale.`}
        </p>
      )}
      {!fromTests && card.tier === 1 && code === 'DEF' && (
        <p className="text-xs text-muted mt-1">Not possession-adjusted: Tier 1 players have no match-by-match possession data.</p>
      )}
      {a.evidence?.length > 0 && (
        <table className="w-full text-sm mt-4">
          <tbody>
            {a.evidence.map((s) => (
              <tr key={s.key} className="border-b border-line/50">
                <td className="py-2">{s.label}</td>
                <td className="py-2 text-right tabular-nums">{s.display ?? formatValue(s)}</td>
                <td className="py-2 pl-6"><PercentileBar value={s.percentile ?? s.score} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
