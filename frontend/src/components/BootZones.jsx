// Boot contact areas shown beside the live camera. A coach cue about WHERE to strike the ball
// highlights its areas (from coach_rules.json "zones"); otherwise the boot is shown neutral.
// Top view (inside, laces, outside, toe, heel) plus a small sole view. Mirrored for a left foot so
// "inside" is always the big-toe side. Highlighted areas also get a text label (not colour alone).
import { RULES } from '../coach/config'

const BOOT = 'M100,14 C136,14 158,40 161,82 C164,122 150,152 146,190 C143,226 146,256 128,276 C114,291 86,291 72,276 C54,256 57,226 54,190 C50,152 34,124 37,84 C40,42 62,14 100,14 Z'
const ZONES = [
  { id: 'toe', x: 0, y: 0, w: 200, h: 70, lx: 100, ly: 48 },
  { id: 'inside', x: 0, y: 70, w: 72, h: 135, lx: 58, ly: 140, rotate: -90 },
  { id: 'laces', x: 72, y: 70, w: 56, h: 135, lx: 100, ly: 192 },
  { id: 'outside', x: 128, y: 70, w: 72, h: 135, lx: 143, ly: 140, rotate: 90 },
  { id: 'heel', x: 0, y: 205, w: 200, h: 95, lx: 100, ly: 250 },
]
const SHORT = { toe: 'Toe', inside: 'Inside', laces: 'Laces', outside: 'Outside', heel: 'Heel', sole: 'Sole' }

const GOOD = '#4ade80'
const WRONG = '#fb923c'

/**
 * zones: areas a coach cue is about (accent). target: the area to strike with (dashed outline).
 * last: the latest shot's contact { detected, status: 'correct' | 'incorrect' | 'unclear' } (green / orange).
 */
export default function BootZones({ zones = [], foot = 'right', cueText = null, target = null, last = null }) {
  const lit = new Set(zones)
  const hit = new Set(last?.detected === 'side' ? ['inside', 'outside'] : last?.detected ? [last.detected] : [])
  const hitColor = last?.status === 'correct' ? GOOD : WRONG
  const mirror = foot === 'left'
  const fill = (id) => (hit.has(id) ? hitColor : lit.has(id) ? '#c6ff3d' : '#1b1e25')
  const labelColor = (id) => (hit.has(id) || lit.has(id) ? '#0a0b0d' : '#8b93a3')
  return (
    <div>
      <svg viewBox="0 0 320 300" className="w-full h-auto" role="img"
        aria-label={`Boot contact areas${lit.size ? `, highlighted: ${[...lit].map((z) => SHORT[z]).join(', ')}` : ''}`}>
        <defs>
          <clipPath id="boot-clip"><path d={BOOT} /></clipPath>
        </defs>
        {/* Top view */}
        <g transform={mirror ? 'translate(200,0) scale(-1,1)' : undefined}>
          <g clipPath="url(#boot-clip)">
            {ZONES.map((z) => (
              <rect key={z.id} x={z.x} y={z.y} width={z.w} height={z.h} fill={fill(z.id)}
                stroke="#343a46" strokeWidth="1.5" className={lit.has(z.id) && !hit.has(z.id) ? 'animate-pulse' : ''} />
            ))}
            {ZONES.filter((z) => z.id === target).map((z) => (
              <rect key="target" x={z.x + 3} y={z.y + 3} width={z.w - 6} height={z.h - 6} fill="none"
                stroke="#ffffff" strokeWidth="3" strokeDasharray="8 6" />
            ))}
            {/* laces */}
            {[84, 101, 118, 135, 152].map((y) => (
              <line key={y} x1="86" y1={y} x2="114" y2={y + 6} stroke={lit.has('laces') ? '#0a0b0d' : '#343a46'} strokeWidth="2" />
            ))}
          </g>
          <path d={BOOT} fill="none" stroke="#e8eaee" strokeWidth="2.5" />
        </g>
        {ZONES.map((z) => {
          const lx = mirror ? 200 - z.lx : z.lx
          const rot = z.rotate ? (mirror ? -z.rotate : z.rotate) : 0
          return (
            <text key={z.id} x={lx} y={z.ly} fontSize="13" fontWeight="600" textAnchor="middle" fill={labelColor(z.id)}
              transform={rot ? `rotate(${rot} ${lx} ${z.ly})` : undefined}>{SHORT[z.id]}</text>
          )
        })}
        {/* Sole view */}
        <g transform="translate(212,60) scale(0.52)">
          <path d={BOOT} fill={fill('sole')} stroke={target === 'sole' ? '#ffffff' : '#e8eaee'} strokeWidth={target === 'sole' ? 8 : 4}
            strokeDasharray={target === 'sole' ? '14 10' : undefined} className={lit.has('sole') && !hit.has('sole') ? 'animate-pulse' : ''} />
          {[[80, 60], [120, 60], [70, 110], [130, 110], [100, 150], [80, 245], [120, 245]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="9" fill={lit.has('sole') ? '#0a0b0d' : '#343a46'} />
          ))}
        </g>
        <text x="264" y="236" fontSize="13" fontWeight="600" textAnchor="middle" fill={labelColor('sole') === '#0a0b0d' ? '#c6ff3d' : '#8b93a3'}>Sole</text>
        <text x="100" y="298" fontSize="11" textAnchor="middle" fill="#8b93a3">{foot === 'left' ? 'Left' : 'Right'} boot, from above</text>
      </svg>
      <div className="text-xs mt-2 min-h-8 space-y-1">
        {target && <p><span className="text-muted">Target (dashed): </span><span className="text-white font-semibold">{RULES.zones[target] ?? SHORT[target]}</span></p>}
        {last && (
          <p>
            <span className="text-muted">Last shot: </span>
            {last.status === 'unclear'
              ? <span className="text-yellow-300">couldn't tell which part of the foot (not judged)</span>
              : <span style={{ color: hitColor }} className="font-semibold">
                  {last.status === 'correct' ? '✓ ' : '✗ '}{RULES.zones[last.detected] ?? 'Side of the foot'}
                  {last.status === 'correct' ? ' (correct)' : ' (not the target)'}
                </span>}
            {last.status !== 'unclear' && <span className="text-muted"> · {Math.round((last.conf ?? 0) * 100)}% confidence, estimated</span>}
          </p>
        )}
        {!target && !last && (lit.size
          ? <p className="text-accent font-semibold">Strike with: {[...lit].map((z) => RULES.zones[z] ?? SHORT[z]).join(' or ')}.{cueText ? ` ${cueText}` : ''}</p>
          : <p className="text-muted">When a hint is about where to contact the ball, that part of the boot lights up.</p>)}
      </div>
    </div>
  )
}
