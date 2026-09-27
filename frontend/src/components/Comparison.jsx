// User card vs target player card, with a gap bar per attribute on the shared 40–99 scale.
// Blue = you, accent = the pro (validated categorical pair on the dark surface).
import { useState } from 'react'
import useFetch from '../useFetch'
import PlayerCard, { Evidence } from './PlayerCard'
import { EmptyState, Section, Skeleton } from './ui'
import { DIRECTIONS, rankPair, RANK_STYLE, sourceLabel } from '../compare'

const MIN = 40
const MAX = 99
const pos = (v) => `${((v - MIN) / (MAX - MIN)) * 100}%`

export default function Comparison({ target, scope }) {
  const qs = new URLSearchParams({ target, ...(scope ? { scope } : {}) }).toString()
  const res = useFetch(`/compare?${qs}`)
  const [selected, setSelected] = useState(null)   // { side: 'user' | 'target', code }

  if (res.loading) return <Skeleton className="h-96" />
  if (res.error) return <EmptyState title="Can't compare yet">{res.error.message}</EmptyState>
  const { user, target: t, gaps, note } = res.data

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-yellow-300/30 bg-yellow-300/5 p-4 text-sm text-gray-200 flex gap-3">
        <span aria-hidden>⚠️</span><p>{note}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 justify-items-center">
        <div className="w-full max-w-sm">
          <p className="text-xs uppercase tracking-wide text-muted mb-2">You · skill tests</p>
          <PlayerCard card={user.card} name={user.name} subtitle={`Age group ${user.card.age_group}`} variant="user"
            onSelect={(code) => setSelected({ side: 'user', code })} selected={selected?.side === 'user' ? selected.code : null} />
        </div>
        <div className="w-full max-w-sm">
          <p className="text-xs uppercase tracking-wide text-muted mb-2">Target · match data</p>
          <PlayerCard card={t.card} name={t.name} subtitle={`${t.team} · ${t.scope_label}`}
            onSelect={(code) => setSelected({ side: 'target', code })} selected={selected?.side === 'target' ? selected.code : null} />
        </div>
      </div>

      {selected && (
        <Section title="Evidence" right={<button className="text-xs text-muted hover:text-white" onClick={() => setSelected(null)}>Close</button>}>
          <Evidence card={selected.side === 'user' ? user.card : t.card} code={selected.code} />
        </Section>
      )}

      <Section title="Attribute comparison" explain="Each rating side by side on the same 40 to 99 scale. The higher value is shown in green."
        info="Gap = target minus you. Only ratings both cards have are compared: pros have no PAC or PHY (that needs tracking data), and your DEF and PHY only exist if you answered the self-assessment.">
        <GapBars gaps={gaps} targetName={t.name} />
      </Section>
    </div>
  )
}

/** One row per statistic. The better value is green with ▲, the lower one orange with ▼;
 * ties and missing values stay neutral. Colour is never the only cue (icon + word). */
export function GapBars({ gaps, targetName }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="py-2 font-medium">Attribute</th>
            <th className="py-2 font-medium">You</th>
            <th className="py-2 font-medium">{targetName}</th>
            <th className="py-2 font-medium text-right">Gap</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((g) => {
            const rank = rankPair(g.user, g.target, DIRECTIONS[g.attribute])
            return (
              <tr key={g.attribute} className="border-b border-line/50 align-top">
                <td className="py-2.5 pr-3"><span className="font-bold">{g.attribute}</span> <span className="text-muted">{g.label}</span></td>
                <td className="py-2.5 pr-3"><ValueCell value={g.user} rank={rank.a} source={g.user_source} /></td>
                <td className="py-2.5 pr-3"><ValueCell value={g.target} rank={rank.b} source={g.target_source} basis={g.target_basis} /></td>
                <td className="py-2.5 text-right tabular-nums text-muted" title={g.note ?? ''}>
                  {g.gap == null ? 'n/a' : g.gap > 0 ? `${g.gap} to go` : g.gap < 0 ? `${-g.gap} ahead` : 'level'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-muted mt-3">
        <span className="text-good">▲ higher</span> · <span className="text-orange-400">▼ lower</span> · = tie · n/a = not available (neutral).
        Higher is better for all six ratings. <span className="text-sky-300">self</span> = your own answers, <span className="text-yellow-300">est</span> = imputed median, not measured.
      </p>
    </div>
  )
}

function ValueCell({ value, rank, source, basis }) {
  if (value == null) return <span className="text-muted">n/a</span>
  const style = RANK_STYLE[rank]
  const tag = sourceLabel(source)
  return (
    <div className="min-w-24">
      <span className={`tabular-nums font-semibold ${style.text}`}>{value}</span>
      {style.label && <span className={`ml-1.5 text-[11px] ${style.text}`}>{style.icon} {style.label}</span>}
      {tag && <sup className={`ml-1 text-[9px] ${tag === 'self' ? 'text-sky-300' : 'text-yellow-300'}`}
        title={tag === 'self' ? 'Self-reported, not measured' : basis ?? 'Imputed median, not measured'}>{tag}</sup>}
      <div className="h-1 mt-1 rounded-full bg-surface-2 w-full max-w-32">
        <div className={`h-1 rounded-full ${style.bar}`} style={{ width: pos(value) }} />
      </div>
    </div>
  )
}
