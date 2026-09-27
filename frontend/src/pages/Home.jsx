import { Link } from 'react-router-dom'
import SearchBar from '../components/SearchBar'
import { EmptyState, Skeleton, TierBadge } from '../components/ui'
import PlayerCard from '../components/PlayerCard'
import useFetch from '../useFetch'

export default function Home() {
  const featured = useFetch('/players/featured')
  const me = useFetch('/me')   // 404 until the user has entered skill tests

  return (
    <div className="space-y-14">
      <div className="grid lg:grid-cols-[1fr_auto] gap-10 items-center">
      <section className="pt-8 sm:pt-16 max-w-3xl">
        <p className="text-accent text-sm font-semibold tracking-wide uppercase mb-3">Data-driven player analysis</p>
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.05]">
          See how the pros play.<br />Train to play like them.
        </h1>
        <p className="text-muted mt-5 text-lg max-w-2xl">
          Pass maps, shot maps and percentile ratings built from real event data, with every number linked
          to the evidence behind it. No guesses presented as facts.
        </p>
        <div className="mt-8"><SearchBar large /></div>
      </section>
      <aside className="w-full lg:w-80">
        {me.loading && <Skeleton className="h-80" />}
        {me.data && (
          <Link to="/me" className="block hover:opacity-90 transition">
            <p className="text-xs uppercase tracking-wide text-muted mb-2">Your card</p>
            <PlayerCard card={me.data.card} name={me.data.name} subtitle={`Skill tests · age group ${me.data.card.age_group}`} variant="user" compact />
          </Link>
        )}
        {me.error && (
          <Link to="/me" className="block rounded-3xl border border-dashed border-line p-8 text-center hover:border-accent/60 transition">
            <p className="text-4xl mb-3">🪪</p>
            <p className="font-semibold">Get your own player card</p>
            <p className="text-sm text-muted mt-1">Do 8 quick skill tests and compare yourself with the pros.</p>
          </Link>
        )}
      </aside>
      </div>

      <section>
        <h2 className="text-xl font-bold mb-4">Featured players</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {featured.loading && [...Array(6)].map((_, i) => <Skeleton key={i} className="h-28" />)}
          {featured.data?.results.length === 0 && (
            <div className="sm:col-span-2 lg:col-span-3 rounded-2xl border border-line">
              <EmptyState title="No demo players yet">Run the preload script, or search for any player above.</EmptyState>
            </div>
          )}
          {featured.data?.results.map((p) => (
            <Link key={p.key} to={`/players/${p.key}`}
              className="group rounded-2xl bg-surface border border-line hover:border-accent/60 p-5 transition">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-lg group-hover:text-accent transition">{p.name}</p>
                  <p className="text-sm text-muted">{p.team}</p>
                </div>
                <TierBadge tier={p.tier} />
              </div>
              <p className="text-xs text-muted mt-4">View analysis →</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
