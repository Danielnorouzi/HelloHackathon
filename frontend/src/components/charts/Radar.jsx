// Percentile radar (Recharts). One series: the player, in the brand accent.
// The dashed ring marks the 50th percentile (a typical player in the comparison pool).
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts'
import { COLORS } from '../../theme'

export const RADAR_STATS = [
  'non_penalty_goals', 'npxg', 'key_passes', 'progressive_passes', 'passes_into_box',
  'pass_completion_pct', 'successful_dribbles', 'progressive_carries', 'pressures_padj', 'tackles_won_padj',
]

const SHORT = {
  non_penalty_goals: 'NP goals', npxg: 'NP xG', key_passes: 'Key passes', progressive_passes: 'Prog. passes',
  passes_into_box: 'Into box', pass_completion_pct: 'Pass %', successful_dribbles: 'Dribbles',
  progressive_carries: 'Prog. carries', pressures_padj: 'Pressures*', tackles_won_padj: 'Tackles*',
}

export default function PercentileRadar({ stats }) {
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640   // leave room for labels on phones
  const byKey = Object.fromEntries(stats.map((s) => [s.key, s]))
  const data = RADAR_STATS.map((k) => ({
    stat: SHORT[k], label: byKey[k].label, percentile: byKey[k].percentile ?? 0,
    value: byKey[k].value, missing: byKey[k].percentile == null, median: 50,
  }))

  return (
    <div className="h-80">
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius={narrow ? '58%' : '72%'}>
          <PolarGrid stroke={COLORS.line} />
          <PolarAngleAxis dataKey="stat" tick={{ fill: COLORS.muted, fontSize: narrow ? 10 : 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar dataKey="median" stroke={COLORS.muted} strokeDasharray="3 3" fill="none" isAnimationActive={false} />
          <Radar dataKey="percentile" stroke={COLORS.accent} strokeWidth={2} fill={COLORS.accent} fillOpacity={0.18}
            isAnimationActive={false}
            dot={{ r: 3, fill: COLORS.accent }} />
          <Tooltip content={<RadarTip />} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

function RadarTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg bg-surface-2 border border-line px-3 py-2 text-xs">
      <p className="font-semibold">{d.label}</p>
      {d.missing ? <p className="text-muted">Not enough attempts to rate</p>
        : <p className="text-gray-300">{d.value} · {Math.round(d.percentile)}th percentile</p>}
    </div>
  )
}
