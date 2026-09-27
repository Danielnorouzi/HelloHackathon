// Player page: header + season selector + tabs (Overview, Passing, Shooting, Card, Report, Train Like Him).
// The selected season ("scope") lives in the URL (?scope=...) so views are shareable.
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import useFetch from '../useFetch'
import { withScope } from '../api'
import { EmptyState, ErrorState, InfoTip, Section, Segmented, Skeleton, TierBadge } from '../components/ui'
import PercentileRadar from '../components/charts/Radar'
import StatsTable from '../components/charts/StatsTable'
import PassMap from '../components/pitch/PassMap'
import ShotMap from '../components/pitch/ShotMap'
import HeatMap from '../components/pitch/HeatMap'
import PassNetwork from '../components/pitch/PassNetwork'
import PlayerCard, { Evidence } from '../components/PlayerCard'
import ReportView from '../components/ReportView'
import TrainPlanner from '../components/TrainPlanner'
import { useState } from 'react'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'passing', label: 'Passing', needsEvents: true },
  { id: 'shooting', label: 'Shooting', needsEvents: true },
  { id: 'card', label: 'Card' },
  { id: 'report', label: 'Report' },
  { id: 'train', label: 'Train Like Him' },
]

export default function PlayerPage() {
  const { key, tab = 'overview' } = useParams()
  const [params, setParams] = useSearchParams()
  const scope = params.get('scope')
  const profile = useFetch(withScope(`/players/${key}/profile`, scope))
  const defs = useFetch('/metrics/definitions')

  if (profile.error) return <ErrorState error={profile.error} />
  const p = profile.data
  const setScope = (s) => setParams(s ? { scope: s } : {})

  return (
    <div className="space-y-6">
      <Header p={p} loading={profile.loading} scope={scope} setScope={setScope} />
      <nav className="no-scrollbar flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => p?.tier === 1 && t.needsEvents ? (
          <span key={t.id} title="Needs event data (Tier 2). This player only has season totals."
            className="px-4 py-3 text-sm font-medium whitespace-nowrap text-muted/40 cursor-not-allowed">
            {t.label}
          </span>
        ) : (
          <Link key={t.id} to={`/players/${key}/${t.id}${scope ? `?scope=${scope}` : ''}`}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition ${tab === t.id
              ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white'}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      {p ? <TabBody tab={tab} p={p} defs={defs.data} /> : <Skeleton className="h-96" />}
    </div>
  )
}

function Header({ p, loading, scope, setScope }) {
  if (loading && !p) return <Skeleton className="h-32" />
  if (!p) return null
  const foot = p.preferred_foot
  return (
    <div className="rounded-2xl bg-surface border border-line p-6 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <TierBadge tier={p.tier} />
          {p.is_demo && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent">Demo player</span>}
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{p.name}</h1>
        <p className="text-muted text-sm mt-1">{p.full_name}</p>
        <dl className="flex flex-wrap gap-x-8 gap-y-3 mt-5 text-sm">
          <Fact label="Position" value={`${p.position}`} sub={p.position_group_name} />
          <Fact label="Team" value={p.team} />
          {p.tier === 2 ? (
            <Fact label="Preferred foot" value={foot.foot ?? 'n/a'}
              sub={foot.foot ? `${foot.share}% of ${foot.sample} foot passes` : null}
              info="Measured from the data: the share of passes played with each foot. Not taken from a profile page." />
          ) : (
            <Fact label="Nationality" value={p.nationality ?? 'n/a'} sub={p.age ? `Age ${p.age}` : null} />
          )}
          <Fact label="Minutes analysed" value={p.minutes.toLocaleString()} sub={`${p.matches} matches`} />
        </dl>
      </div>
      {p.tier === 1 ? (
        <div className="text-sm">
          <span className="block text-xs text-muted mb-1">Season</span>
          <span className="font-semibold">{p.scope_label}</span>
        </div>
      ) : (
      <label className="text-sm w-full lg:w-auto">
        <span className="block text-xs text-muted mb-1">Season</span>
        <select value={scope ?? p.scope} onChange={(e) => setScope(e.target.value)}
          className="w-full lg:w-auto lg:min-w-64 bg-surface-2 border border-line rounded-lg px-3 py-2">
          <option value="all">All seasons combined</option>
          {p.seasons.map((s) => (
            <option key={s.scope} value={s.scope}>{s.label} · {s.minutes} min</option>
          ))}
        </select>
      </label>
      )}
    </div>
  )
}

function Fact({ label, value, sub, info }) {
  return (
    <div>
      <dt className="text-xs text-muted flex items-center gap-1">{label}{info && <InfoTip text={info} />}</dt>
      <dd className="font-semibold">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  )
}

function TabBody({ tab, p, defs }) {
  if (p.tier === 1 && TABS.find((t) => t.id === tab)?.needsEvents) {
    return <EmptyState title="Needs event data (Tier 2)">This player only has season totals from API-Football, so there are no pitch maps.</EmptyState>
  }
  switch (tab) {
    case 'overview': return <Overview p={p} defs={defs} />
    case 'passing': return <Passing p={p} defs={defs} />
    case 'shooting': return <Shooting p={p} />
    case 'card': return <CardTab p={p} />
    case 'report': return <ReportView path={withScope(`/players/${p.key}/report`, p.scope)} />
    case 'train': return <TrainPlanner fixedTarget={p.key} scope={p.scope} />
    default: return <EmptyState title="Unknown tab" />
  }
}

function poolText(p, defs) {
  return `${defs?.percentile ?? ''} Pool: ${p.pool.size} ${p.position_group_name.toLowerCase()} player-seasons. ${defs?.pool_note ?? ''}`
}

function Overview({ p, defs }) {
  if (p.tier === 1) return <Tier1Overview p={p} defs={defs} />
  return <Tier2Overview p={p} defs={defs} />
}

function Tier1Overview({ p, defs }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-surface-2/50 p-5 text-sm text-gray-300">
        <p className="font-semibold text-white mb-1">Basic stats only (Tier 1)</p>
        <p>{p.source_note} Pitch maps, zones and possession-adjusted defending need event data, which is only
          available for StatsBomb (Tier 2) players.</p>
      </div>
      <Section title="Season stats" explain={`${p.scope_label} · per 90 minutes unless marked %, with a rough percentile vs ${p.position_group_name.toLowerCase()}.`}
        info={`${defs?.per_90 ?? ''} ${poolText(p, defs)}`}>
        <StatsTable stats={p.stats} />
      </Section>
    </div>
  )
}

function Tier2Overview({ p, defs }) {
  const heat = useFetch(withScope(`/players/${p.key}/heatmap`, p.scope))
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Section title="Percentile radar" explain={`How ${p.name} ranks against other ${p.position_group_name.toLowerCase()}, per 90 minutes.`}
        info={poolText(p, defs)}>
        <PercentileRadar stats={p.stats} />
        <p className="text-xs text-muted">Dashed ring = 50th percentile (a typical player in the pool).
          * Possession-adjusted: defensive actions scaled by how much of the ball the opponent had.</p>
      </Section>
      <Section title="Touch heat map" explain="Where they get on the ball: passes, carries, receptions, dribbles and shots."
        info="Every on-ball action counted in 5 × 5 yard cells. Brighter = more actions.">
        {heat.loading && <Skeleton className="aspect-[3/2]" />}
        {heat.data && <HeatMap data={heat.data} />}
        {heat.data && <ZoneSummary heat={heat.data} />}
      </Section>
      <Section className="lg:col-span-2" title="Key stats" explain="Per 90 minutes unless marked %, with percentile vs the position pool."
        info={`${defs?.per_90 ?? ''} ${poolText(p, defs)}`}>
        <StatsTable stats={p.stats} />
      </Section>
    </div>
  )
}

function ZoneSummary({ heat }) {
  const t = heat.thirds_pct
  const l = heat.lanes_pct
  return (
    <div className="grid grid-cols-2 gap-4 mt-4 text-xs">
      <div><p className="text-muted mb-1">By third</p>
        <p>Def {t.defensive ?? 0}% · Mid {t.middle ?? 0}% · Att {t.attacking ?? 0}%</p></div>
      <div><p className="text-muted mb-1">By lane</p>
        <p>Left {l.left ?? 0}% · Central {l.central ?? 0}% · Right {l.right ?? 0}%</p></div>
    </div>
  )
}

function Passing({ p, defs }) {
  // Default to progressive passes: the most telling view, and readable (the full set can be 1,500+ arrows).
  const [filter, setFilter] = useState('progressive')
  const passes = useFetch(withScope(`/players/${p.key}/passes`, p.scope, { filter }))
  const network = useFetch(withScope(`/players/${p.key}/pass-network`, p.scope))
  const d = passes.data
  return (
    <div className="space-y-6">
      <Section title="Pass map" explain="Every pass from start to end point. Filter to progressive passes or passes under pressure."
        info={`Progressive pass: ${defs?.progressive_pass ?? ''} Under pressure: an opponent was pressing the passer (StatsBomb flag). Throw-ins excluded.`}
        right={<Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: `All${d ? ` (${d.counts.all})` : ''}` },
          { value: 'progressive', label: `Progressive${d ? ` (${d.counts.progressive})` : ''}` },
          { value: 'under_pressure', label: `Under pressure${d ? ` (${d.counts.under_pressure})` : ''}` },
        ]} />}>
        {passes.loading && <Skeleton className="aspect-[3/2]" />}
        {d && d.total === 0 && <EmptyState title="No passes match this filter" />}
        {d && d.total > 0 && (
          <>
            <PassMap data={d} />
            <p className="text-xs text-muted mt-2">
              {d.sampled ? `Showing a random ${d.shown} of ${d.total} passes to keep the map readable. ` : ''}
              Completion in view: {d.completion_pct}%.
            </p>
          </>
        )}
      </Section>
      <Section title="Pass network" explain="Who they combine with most: top 5 teammates they pass to and receive from."
        info="Completed passes only. Dots sit at each teammate's average on-ball position in this scope.">
        {network.loading && <Skeleton className="h-72" />}
        {network.data && <PassNetwork data={network.data} />}
      </Section>
    </div>
  )
}

function Shooting({ p }) {
  const shots = useFetch(withScope(`/players/${p.key}/shots`, p.scope))
  const s = shots.data?.summary
  return (
    <Section title="Shot map" explain="Every shot, sized by expected goals (xG) and coloured by outcome."
      info="xG (StatsBomb) = the probability an average player scores that chance, based on location, angle, body part and situation.">
      {shots.loading && <Skeleton className="aspect-[3/4] max-w-lg" />}
      {s && s.shots === 0 && <EmptyState title="No shots in this scope" />}
      {s && s.shots > 0 && (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2"><ShotMap data={shots.data} /></div>
          <dl className="grid grid-cols-2 gap-4 content-start">
            <Tile label="Shots" value={s.shots} />
            <Tile label="Goals" value={s.goals} />
            <Tile label="xG" value={s.xg} />
            <Tile label="Goals − xG" value={(s.goals - s.xg).toFixed(1)} info="Positive = scored more than an average finisher would from the same chances. Small samples swing a lot." />
            <Tile label="Non-penalty goals" value={s.np_goals} />
            <Tile label="Non-penalty xG" value={s.npxg} />
          </dl>
        </div>
      )}
    </Section>
  )
}

function Tile({ label, value, info }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <dt className="text-xs text-muted flex items-center gap-1">{label}{info && <InfoTip text={info} />}</dt>
      <dd className="text-2xl font-bold tabular-nums mt-1">{value}</dd>
    </div>
  )
}

function CardTab({ p }) {
  const card = useFetch(withScope(`/players/${p.key}/card`, p.scope))
  const [selected, setSelected] = useState('SHO')
  if (card.loading) return <Skeleton className="h-96 max-w-sm" />
  if (card.error) return <ErrorState error={card.error} />
  const c = card.data.card
  return (
    <div className="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
      <PlayerCard card={c} name={p.name} subtitle={`${p.team} · ${p.scope_label}`} onSelect={setSelected} selected={selected} />
      <Section title="Evidence" explain="Every attribute is built from percentile stats against the position pool. Nothing is guessed."
        info="Attribute = average percentile of its stats, mapped to a 40–99 scale. OVR = position-weighted average of SHO, PAS, DRI and DEF (weights in config/rating.json).">
        <Evidence card={c} code={selected} />
      </Section>
    </div>
  )
}
