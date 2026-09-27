// Shot map on the attacking half. Circle area = xG. Goal = filled aqua with a ring,
// saved = blue, off target / blocked = hollow orange (shape + colour, never colour alone).
import { useState } from 'react'
import Pitch from './Pitch'
import { Legend } from './PassMap'
import { COLORS } from '../../theme'

const radius = (xg) => 0.5 + Math.sqrt(xg ?? 0.02) * 2.8   // area grows with xG

function style(shot) {
  if (shot.is_goal) return { fill: COLORS.aqua, stroke: '#ffffff', strokeWidth: 0.35, fillOpacity: 0.85 }
  if (['Saved', 'Saved to Post'].includes(shot.shot_outcome)) return { fill: COLORS.blue, stroke: 'none', fillOpacity: 0.7 }
  return { fill: 'none', stroke: COLORS.orange, strokeWidth: 0.4 }
}

export default function ShotMap({ data }) {
  const [hover, setHover] = useState(null)
  // Goals on top.
  const shots = [...data.shots].sort((a, b) => Number(a.is_goal) - Number(b.is_goal))

  return (
    <div className="relative">
      <Pitch half>
        {shots.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={radius(s.shot_xg)} {...style(s)}
            onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)} className="cursor-pointer" />
        ))}
      </Pitch>
      {hover && (
        <div className="absolute top-2 left-2 rounded-lg bg-surface-2 border border-line p-3 text-xs pointer-events-none">
          <p className="font-semibold">{hover.shot_outcome} · xG {hover.shot_xg?.toFixed(2)}</p>
          <p className="text-muted">{hover.shot_type} · {hover.body_part}</p>
          <p className="text-muted">{hover.minute}' vs {hover.opponent} · {hover.match_date}</p>
        </div>
      )}
      <Legend items={[
        { color: COLORS.aqua, label: 'Goal', style: { borderRadius: 999, outline: '1px solid white' } },
        { color: COLORS.blue, label: 'Saved', style: { borderRadius: 999 } },
        { color: 'transparent', label: 'Off target / blocked', style: { borderRadius: 999, border: `1.5px solid ${COLORS.orange}` } },
      ]} />
      <p className="text-xs text-muted mt-1">Bigger circle = higher xG (chance quality). Penalties included.</p>
    </div>
  )
}
