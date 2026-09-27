// Touch heat map: on-ball actions counted in 5 x 5 yard cells. One hue (blue), brighter = more.
import { useState } from 'react'
import Pitch from './Pitch'
import { COLORS } from '../../theme'

export default function HeatMap({ data }) {
  const [hover, setHover] = useState(null)
  const { grid, bins_x: bx, bins_y: by, total } = data
  const max = Math.max(1, ...grid.flat())
  const cw = 120 / bx
  const ch = 80 / by

  return (
    <div className="relative">
      <Pitch>
        {grid.map((row, r) => row.map((count, c) => count > 0 && (
          <rect key={`${r}-${c}`} x={c * cw} y={r * ch} width={cw} height={ch}
            fill={COLORS.blue} fillOpacity={0.08 + 0.85 * Math.sqrt(count / max)}
            onMouseEnter={() => setHover({ count, pct: (count / total) * 100 })}
            onMouseLeave={() => setHover(null)} />
        )))}
      </Pitch>
      {hover && (
        <div className="absolute top-2 left-2 rounded-lg bg-surface-2 border border-line px-3 py-2 text-xs pointer-events-none">
          {hover.count} actions · {hover.pct.toFixed(1)}% of all touches
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 text-xs text-muted">
        <span>Fewer</span>
        <span className="h-2 w-32 rounded-full" style={{ background: `linear-gradient(90deg, ${COLORS.blue}22, ${COLORS.blue})` }} />
        <span>More touches</span>
      </div>
    </div>
  )
}
