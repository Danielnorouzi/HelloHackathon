// Pick any player in the dataset: type to search (accents optional), or use a demo shortcut.
import { useEffect, useRef, useState } from 'react'
import { get } from '../api'
import useFetch from '../useFetch'
import { TierBadge } from './ui'

export default function PlayerPicker({ value, valueName, onChange, label = 'Compare with' }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const featured = useFetch('/players/featured')
  const boxRef = useRef(null)

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) return undefined
    const t = setTimeout(() => {
      get(`/players/search?q=${encodeURIComponent(query)}`).then((d) => { setResults(d.results); setOpen(true) }).catch(() => setResults([]))
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const choose = (p) => { onChange(p.key, p.name); setQ(''); setResults([]); setOpen(false) }
  const selectedName = valueName ?? featured.data?.results.find((p) => p.key === value)?.name ?? value

  return (
    <div className="space-y-2 w-full sm:w-96">
      <p className="text-xs text-muted">{label}: <span className="text-white font-semibold">{selectedName}</span></p>
      <div ref={boxRef} className="relative">
        <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setOpen(false) }}
          placeholder="Search any player in the dataset…" aria-label="Search a player to compare with"
          className="w-full rounded-lg bg-surface-2 border border-line focus:border-accent outline-none px-3 py-2 text-sm placeholder:text-muted" />
        {open && (
          <ul role="listbox" className="absolute z-40 mt-1 w-full max-h-72 overflow-y-auto rounded-xl bg-surface-2 border border-line shadow-2xl">
            {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">No players found.</li>}
            {results.map((p) => (
              <li key={p.key} role="option" aria-selected={p.key === value} onMouseDown={() => choose(p)}
                className="px-3 py-2 cursor-pointer hover:bg-surface flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-sm truncate">{p.name}</span>
                  <span className="block text-xs text-muted truncate">{[p.team, p.position].filter(Boolean).join(' · ')}</span>
                </span>
                <TierBadge tier={p.tier} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {featured.data?.results.map((p) => (
          <button key={p.key} type="button" onClick={() => choose(p)}
            className={`text-xs rounded-full border px-2.5 py-1 ${p.key === value ? 'border-accent text-white' : 'border-line text-muted hover:text-white'}`}>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  )
}
