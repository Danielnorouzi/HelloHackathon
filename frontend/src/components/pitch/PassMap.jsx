// Pass map: one arrow per pass, start -> end. Blue = completed, orange = incomplete.
import Pitch, { ArrowDefs } from './Pitch'
import { COLORS } from '../../theme'

export default function PassMap({ data }) {
  const passes = data.passes
  // Draw incomplete passes first so completed ones sit on top.
  const ordered = [...passes].sort((a, b) => Number(a.completed) - Number(b.completed))
  const opacity = passes.length > 600 ? 0.35 : passes.length > 200 ? 0.55 : 0.8

  return (
    <div>
      <Pitch>
        <ArrowDefs colors={{ done: COLORS.blue, miss: COLORS.orange }} size={passes.length > 300 ? 2.5 : 4} />
        {ordered.map((p, i) => (
          <line key={i} x1={p.x} y1={p.y} x2={p.end_x} y2={p.end_y}
            stroke={p.completed ? COLORS.blue : COLORS.orange} strokeWidth={0.35} strokeOpacity={opacity}
            markerEnd={`url(#arrow-${p.completed ? 'done' : 'miss'})`}>
            <title>{`${p.completed ? 'Completed' : 'Incomplete'}${p.progressive ? ' · progressive' : ''}${p.under_pressure ? ' · under pressure' : ''}${p.pass_height ? ` · ${p.pass_height}` : ''}${p.body_part ? ` · ${p.body_part}` : ''}`}</title>
          </line>
        ))}
      </Pitch>
      <Legend items={[
        { color: COLORS.blue, label: `Completed (${passes.filter((p) => p.completed).length})` },
        { color: COLORS.orange, label: `Incomplete (${passes.filter((p) => !p.completed).length})` },
      ]} />
    </div>
  )
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-300">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: it.color, ...(it.style || {}) }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}
