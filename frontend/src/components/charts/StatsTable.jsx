// Key stats table: per-90 value (or rate), season total, and percentile bar vs the comparison pool.
import { COLORS } from '../../theme'

export function PercentileBar({ value }) {
  if (value == null) return <span className="text-xs text-muted">n/a</span>
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 sm:w-32 rounded-full bg-surface-2">
        <div className="h-1.5 rounded-full" style={{ width: `${value}%`, background: COLORS.accent }} />
      </div>
      <span className="tabular-nums text-xs w-8 text-right">{Math.round(value)}</span>
    </div>
  )
}

export function formatValue(s) {
  if (s.value == null) return 'n/a'
  if (s.kind === 'pct') return `${s.value.toFixed(1)}%`
  return s.value.toFixed(2)
}

export default function StatsTable({ stats }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="py-2 font-medium">Stat</th>
            <th className="py-2 font-medium text-right">Per 90 / rate</th>
            <th className="py-2 font-medium text-right hidden sm:table-cell">Total</th>
            <th className="py-2 font-medium pl-6">Percentile</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.key} className="border-b border-line/50">
              <td className="py-2">{s.label}</td>
              <td className="py-2 text-right tabular-nums">{formatValue(s)}</td>
              <td className="py-2 text-right tabular-nums text-muted hidden sm:table-cell">{s.total ?? 'n/a'}</td>
              <td className="py-2 pl-6"><PercentileBar value={s.percentile} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
