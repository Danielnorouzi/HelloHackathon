// Search bar with autocomplete. Debounced; keyboard navigable (up/down/enter/escape).
// Typing only searches local data + cached API-Football results (free). "Search more leagues" makes one
// API-Football request for the query (cached forever), because the free tier allows 100 per day.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { get } from '../api'
import { TierBadge } from './ui'

export default function SearchBar({ autoFocus = false, large = false }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [remote, setRemote] = useState({ q: '', state: 'idle', error: null })
  const navigate = useNavigate()
  const boxRef = useRef(null)

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(() => {
      get(`/players/search?q=${encodeURIComponent(q.trim())}`)
        .then((d) => { setResults(d.results); setActive(0); setOpen(true) })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  // Close the dropdown when clicking elsewhere.
  useEffect(() => {
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const go = (r) => { setOpen(false); setQ(''); navigate(`/players/${r.key}`) }

  const searchRemote = () => {
    const query = q.trim()
    setRemote({ q: query, state: 'loading', error: null })
    get(`/players/search/remote?q=${encodeURIComponent(query)}`)
      .then((d) => { setResults(d.results); setRemote({ q: query, state: 'done', error: null }) })
      .catch((e) => setRemote({ q: query, state: 'error', error: e.message }))
  }
  const canRemote = q.trim().length >= 3 && !(remote.q === q.trim() && remote.state === 'done')

  const onKey = (e) => {
    if (!open || !results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter') go(results[active])
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative w-full">
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKey}
        placeholder='Search a player, for example "Messi"'
        aria-label="Search players"
        className={`w-full rounded-xl bg-surface border border-line focus:border-accent outline-none px-4 ${large ? 'py-4 text-lg' : 'py-2.5'} placeholder:text-muted`}
      />
      {loading && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted">searching…</span>}
      {open && q.trim().length >= 2 && (
        <ul role="listbox" className="absolute z-40 mt-2 w-full rounded-xl bg-surface-2 border border-line shadow-2xl overflow-hidden">
          {results.length === 0 && !loading && (
            <li className="px-4 py-3 text-sm text-muted">No players found for “{q}”.</li>
          )}
          {results.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)} onMouseDown={() => go(r)}
              className={`px-4 py-3 cursor-pointer flex items-center justify-between gap-3 ${i === active ? 'bg-surface' : ''}`}>
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {r.name}{r.is_demo && <span className="ml-2 text-[10px] uppercase tracking-wide text-accent">Demo</span>}
                </div>
                <div className="text-xs text-muted truncate">{[r.team, r.position].filter(Boolean).join(' · ')}</div>
              </div>
              <TierBadge tier={r.tier} />
            </li>
          ))}
          {canRemote && (
            <li className="border-t border-line">
              <button type="button" onMouseDown={(e) => { e.preventDefault(); searchRemote() }}
                disabled={remote.state === 'loading'}
                className="w-full text-left px-4 py-3 text-sm text-accent hover:bg-surface disabled:text-muted">
                {remote.state === 'loading' ? 'Searching other leagues…' : `Search more leagues for “${q.trim()}” (API-Football)`}
                <span className="block text-[11px] text-muted">Basic stats only (Tier 1). Uses 1 of 100 daily requests; cached after.</span>
              </button>
            </li>
          )}
          {remote.state === 'error' && <li className="px-4 py-3 text-xs text-bad">{remote.error}</li>}
        </ul>
      )}
    </div>
  )
}
