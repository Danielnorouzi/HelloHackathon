// Players tab: browse every player in the dataset (search, position filter, sort, pages).
// Other leagues (API-Football, Tier 1) are searched only on request, since the free plan has a daily limit.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { get } from '../api'
import useFetch from '../useFetch'
import { EmptyState, Segmented, Skeleton, TierBadge } from '../components/ui'

const GROUPS = [
  { value: '', label: 'All' }, { value: 'FWD', label: 'Forwards' }, { value: 'MID', label: 'Midfielders' },
  { value: 'DEF', label: 'Defenders' }, { value: 'GK', label: 'Goalkeepers' },
]
const PAGE_SIZE = 25

export default function PlayersPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const group = params.get('group') ?? ''
  const sort = params.get('sort') ?? 'minutes'
  const page = Number(params.get('page') ?? 1)
  const [text, setText] = useState(q)

  const update = (changes) => {
    const next = { q, group, sort, page: 1, ...changes }
    setParams(Object.fromEntries(Object.entries(next).filter(([k, v]) => v && !(k === 'page' && v === 1) && !(k === 'sort' && v === 'minutes'))))
  }

  // Debounce typing into the URL (which drives the query).
  useEffect(() => {
    const t = setTimeout(() => { if (text !== q) update({ q: text }) }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const query = new URLSearchParams({ q, sort, page, page_size: PAGE_SIZE, ...(group ? { group } : {}) })
  const list = useFetch(`/players?${query}`)
  const d = list.data

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Players</h1>
        <p className="text-muted">Every player in the dataset. Tier 2 players have full event data; Tier 1 players have basic stats.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name (accents optional)"
          aria-label="Search players" className="w-full lg:max-w-md rounded-xl bg-surface border border-line focus:border-accent outline-none px-4 py-2.5 placeholder:text-muted" />
        <Segmented size="md" value={group} onChange={(g) => update({ group: g })} options={GROUPS} />
        <label className="text-sm flex items-center gap-2 lg:ml-auto">
          <span className="text-muted">Sort</span>
          <select value={sort} onChange={(e) => update({ sort: e.target.value })} className="bg-surface-2 border border-line rounded-lg px-3 py-2">
            <option value="minutes">Most minutes</option>
            <option value="name">Name (A to Z)</option>
            <option value="seasons">Most seasons</option>
          </select>
        </label>
      </div>

      <div className="rounded-2xl border border-line bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="px-4 py-3 font-medium">Player</th>
              <th className="px-4 py-3 font-medium hidden sm:table-cell">Team</th>
              <th className="px-4 py-3 font-medium hidden md:table-cell">Position</th>
              <th className="px-4 py-3 font-medium text-right">Minutes</th>
              <th className="px-4 py-3 font-medium text-right hidden sm:table-cell">Seasons</th>
              <th className="px-4 py-3 font-medium hidden lg:table-cell">Data</th>
            </tr>
          </thead>
          <tbody>
            {list.loading && !d && [...Array(8)].map((_, i) => (
              <tr key={i}><td colSpan={6} className="px-4 py-2"><Skeleton className="h-6" /></td></tr>
            ))}
            {d?.results.map((p) => (
              <tr key={p.key} className="border-b border-line/50 hover:bg-surface-2">
                <td className="px-4 py-2.5">
                  <Link to={`/players/${p.key}`} className="font-medium hover:text-accent">{p.name}</Link>
                  {p.is_demo && <span className="ml-2 text-[10px] uppercase tracking-wide text-accent">Demo</span>}
                </td>
                <td className="px-4 py-2.5 text-muted hidden sm:table-cell">{p.team}</td>
                <td className="px-4 py-2.5 text-muted hidden md:table-cell">{p.position}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.minutes.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums hidden sm:table-cell">{p.seasons}</td>
                <td className="px-4 py-2.5 hidden lg:table-cell"><TierBadge tier={p.tier} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {d && d.total === 0 && <EmptyState title={`No players match "${q}"`}>Try another spelling, or search other leagues below.</EmptyState>}
      </div>

      {d && d.total > 0 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="text-muted">{d.total.toLocaleString()} players · page {d.page} of {d.pages}</p>
          <div className="flex gap-2">
            <button type="button" disabled={d.page <= 1} onClick={() => update({ page: d.page - 1 })}
              className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40 hover:border-muted">Previous</button>
            <button type="button" disabled={d.page >= d.pages} onClick={() => update({ page: d.page + 1 })}
              className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40 hover:border-muted">Next</button>
          </div>
        </div>
      )}

      <OtherLeagues q={q} />
    </div>
  )
}

/** Tier 1 search (API-Football): one request per new name, only when asked. */
function OtherLeagues({ q }) {
  const [state, setState] = useState({ loading: false, results: null, error: null, for: '' })
  const search = () => {
    setState({ loading: true, results: null, error: null, for: q })
    get(`/players/search/remote?q=${encodeURIComponent(q)}`)
      .then((d) => setState({ loading: false, results: d.results.filter((r) => r.tier === 1), error: null, for: q }))
      .catch((e) => setState({ loading: false, results: null, error: e.message, for: q }))
  }
  return (
    <div className="rounded-2xl border border-dashed border-line p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted">Not in the dataset? Search other leagues on API-Football (basic stats only, uses 1 of 100 daily requests).</p>
        <button type="button" onClick={search} disabled={q.trim().length < 3 || state.loading}
          className="rounded-lg border border-line px-3 py-1.5 hover:border-muted disabled:opacity-40">
          {state.loading ? 'Searching…' : q.trim().length < 3 ? 'Type 3+ letters above' : `Search other leagues for "${q}"`}
        </button>
      </div>
      {state.error && <p className="text-bad mt-2">{state.error}</p>}
      {state.results && (
        <ul className="mt-3 divide-y divide-line">
          {state.results.length === 0 && <li className="py-2 text-muted">No other-league results for "{state.for}".</li>}
          {state.results.map((p) => (
            <li key={p.key} className="py-2 flex items-center justify-between gap-3">
              <Link to={`/players/${p.key}`} className="hover:text-accent">{p.name} <span className="text-muted">· {[p.team, p.position].filter(Boolean).join(' · ')}</span></Link>
              <TierBadge tier={1} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
