// Pass network: the player's top 5 pass targets and top 5 suppliers, drawn at each teammate's
// average on-ball position. Line width = number of completed passes. A ranked list sits beside it
// so the numbers are readable without the diagram.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import Pitch, { ArrowDefs } from './Pitch'
import { Segmented } from '../ui'
import { COLORS } from '../../theme'

export default function PassNetwork({ data }) {
  const [mode, setMode] = useState('passes_to')
  const links = data[mode].filter((n) => n.x != null)
  const max = Math.max(1, ...data[mode].map((n) => n.passes))
  const me = data.player

  return (
    <div className="grid md:grid-cols-5 gap-6">
      <div className="md:col-span-3">
        <div className="mb-3">
          <Segmented value={mode} onChange={setMode} options={[
            { value: 'passes_to', label: 'Passes to' }, { value: 'receives_from', label: 'Receives from' }]} />
        </div>
        <Pitch>
          <ArrowDefs colors={{ net: COLORS.blue }} size={2.2} />
          {links.map((n) => {
            const [from, to] = mode === 'passes_to' ? [me, n] : [n, me]
            const end = stopShort(from, to, 3.8)   // end at the node's edge so the arrowhead stays visible
            return (
              <line key={n.key} x1={from.x} y1={from.y} x2={end.x} y2={end.y} stroke={COLORS.blue}
                strokeOpacity={0.75} strokeWidth={0.4 + (n.passes / max) * 2.2} markerEnd="url(#arrow-net)">
                <title>{`${n.name}: ${n.passes} completed passes`}</title>
              </line>
            )
          })}
          {links.map((n) => (
            <g key={`n-${n.key}`}>
              <circle cx={n.x} cy={n.y} r={2.4} fill={COLORS.pitch} stroke="#e8eaee" strokeWidth={0.4} />
              <text x={n.x} y={n.y - 3.4} fontSize="2.6" fill="#e8eaee" textAnchor="middle">{shortName(n.name)}</text>
            </g>
          ))}
          {me.x != null && (
            <g>
              <circle cx={me.x} cy={me.y} r={3} fill={COLORS.accent} />
              <text x={me.x} y={me.y + 6} fontSize="2.8" fill={COLORS.accent} textAnchor="middle" fontWeight="700">{shortName(me.name)}</text>
            </g>
          )}
        </Pitch>
      </div>
      <ol className="md:col-span-2 space-y-3 self-center">
        {data[mode].map((n, i) => (
          <li key={n.key} className="text-sm">
            <div className="flex justify-between gap-2">
              <Link to={`/players/${n.key}`} className="hover:text-accent truncate">{i + 1}. {n.name}</Link>
              <span className="tabular-nums text-muted">{n.passes}</span>
            </div>
            <div className="h-1.5 mt-1 rounded-full bg-surface-2">
              <div className="h-1.5 rounded-full" style={{ width: `${(n.passes / max) * 100}%`, background: COLORS.blue }} />
            </div>
          </li>
        ))}
        {!data[mode].length && <li className="text-sm text-muted">No completed passes in this scope.</li>}
      </ol>
    </div>
  )
}

function stopShort(from, to, gap) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const k = Math.max(0, (len - gap) / len)
  return { x: from.x + dx * k, y: from.y + dy * k }
}

function shortName(name) {
  const parts = name.split(' ')
  return parts.length > 1 ? parts[parts.length - 1] : name
}
