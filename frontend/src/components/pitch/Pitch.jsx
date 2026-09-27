// SVG football pitch in StatsBomb coordinates: 120 x 80, attacking left -> right, y grows downward.
// Children are drawn in the same coordinate system, so a pass from (x, y) to (end_x, end_y) is just a <line>.
import { COLORS } from '../../theme'

const STROKE = { stroke: COLORS.pitchLine, strokeWidth: 0.4, fill: 'none' }

function Markings() {
  return (
    <g {...STROKE}>
      <rect x="0" y="0" width="120" height="80" />
      <line x1="60" y1="0" x2="60" y2="80" />
      <circle cx="60" cy="40" r="10" />
      <circle cx="60" cy="40" r="0.5" fill={COLORS.pitchLine} />
      {/* Left end */}
      <rect x="0" y="18" width="18" height="44" />
      <rect x="0" y="30" width="6" height="20" />
      <circle cx="12" cy="40" r="0.5" fill={COLORS.pitchLine} />
      <path d="M 18 32.5 A 10 10 0 0 1 18 47.5" />
      <rect x="-2" y="36" width="2" height="8" />
      {/* Right end (attacking goal) */}
      <rect x="102" y="18" width="18" height="44" />
      <rect x="114" y="30" width="6" height="20" />
      <circle cx="108" cy="40" r="0.5" fill={COLORS.pitchLine} />
      <path d="M 102 32.5 A 10 10 0 0 0 102 47.5" />
      <rect x="120" y="36" width="2" height="8" />
    </g>
  )
}

/**
 * half: show only the attacking half (x 60-120), used by the shot map.
 * The direction-of-play hint makes the orientation explicit.
 */
export default function Pitch({ children, half = false, showDirection = true, className = '' }) {
  const viewBox = half ? '58 -3 65 87' : '-3 -3 126 89'
  return (
    <svg viewBox={viewBox} className={`w-full h-auto select-none ${className}`} role="img">
      <rect x="-3" y="-3" width="126" height="89" fill={COLORS.pitch} />
      <Markings />
      {children}
      {showDirection && !half && (
        <g fill={COLORS.muted} fontSize="2.4">
          <text x="60" y="84.5" textAnchor="middle">Attacking direction →</text>
        </g>
      )}
    </svg>
  )
}

/** Arrowhead markers, one per colour. Use as markerEnd={`url(#arrow-${name})`}. */
export function ArrowDefs({ colors, size = 4 }) {
  return (
    <defs>
      {Object.entries(colors).map(([name, color]) => (
        <marker key={name} id={`arrow-${name}`} viewBox="0 0 10 10" refX="8" refY="5"
          markerWidth={size} markerHeight={size} orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      ))}
    </defs>
  )
}
