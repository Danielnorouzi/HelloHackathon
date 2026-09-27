// AI scouting report. Every claim shows the numbers it rests on (evidence chips), and the exact
// data summary sent to the AI is one click away. Used for Tier 1 and Tier 2 players.
import { useState } from 'react'
import useFetch from '../useFetch'
import { EmptyState, InfoTip, Section, Skeleton } from './ui'

export default function ReportView({ path }) {
  const res = useFetch(path)

  if (res.loading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">Writing the scouting report from the data… this takes 20–40 seconds the
          first time, then it's cached and instant.</p>
        <Skeleton className="h-16" />
        <div className="grid md:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        <Skeleton className="h-48" />
      </div>
    )
  }
  if (res.error) {
    return <EmptyState icon="📝" title="The report isn't available right now">{String(res.error.message)}</EmptyState>
  }

  const { report: r, evidence, summary, model, cached } = res.data
  const Chips = ({ keys }) => <EvidenceChips keys={keys} evidence={evidence} />

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-surface border border-line p-6">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted mb-3">
          <span className="px-2 py-0.5 rounded-full border border-line">AI-written · {model}</span>
          <span className="px-2 py-0.5 rounded-full border border-line">{cached ? 'Cached' : 'Just generated'}</span>
          {summary.data_tier === 1 && <span className="px-2 py-0.5 rounded-full border border-line">Limited data (Tier 1)</span>}
          <InfoTip text="The AI only sees a JSON summary of this player's stats, percentiles and zones (never raw events), and must cite a number for every claim. It can still word things imperfectly, so check the evidence chips." />
        </div>
        <p className="text-xl sm:text-2xl font-semibold leading-snug">{r.identity}</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {r.archetypes.map((a) => (
          <div key={a.name} className="rounded-2xl bg-surface border border-line p-5">
            <p className="text-xs uppercase tracking-wide text-accent font-semibold mb-1">Archetype</p>
            <p className="font-bold text-lg">{a.name}</p>
            <p className="text-sm text-gray-300 mt-2">{a.explanation}</p>
            <Chips keys={a.evidence} />
          </div>
        ))}
      </div>

      <Section title="How they play">
        <p className="text-gray-200 leading-relaxed">{r.how_they_play}</p>
      </Section>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Strengths" explain="Each one cites the stats behind it.">
          <Items items={r.strengths} Chips={Chips} marker="+" tone="text-good" />
        </Section>
        <Section title="Development areas" explain="Relatively low numbers for the position. Some reflect the role, not a weakness.">
          <Items items={r.development_areas} Chips={Chips} marker="–" tone="text-yellow-300" />
        </Section>
      </div>

      <Section title="Best tactical environment">
        <p className="text-gray-200 leading-relaxed">{r.best_tactical_environment}</p>
      </Section>

      <Section title="Training translation" explain="What an amateur can practise to build these patterns.">
        <ol className="space-y-4">
          {r.training_translation.map((t, i) => (
            <li key={t.focus} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent text-black text-xs font-bold flex items-center justify-center">{i + 1}</span>
              <div>
                <p className="font-semibold">{t.focus}</p>
                <p className="text-sm text-gray-300 mt-1">{t.why}</p>
                <Chips keys={t.evidence} />
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <DataSent summary={summary} />
    </div>
  )
}

function Items({ items, Chips, marker, tone }) {
  return (
    <ul className="space-y-5">
      {items.map((s) => (
        <li key={s.title} className="flex gap-3">
          <span className={`font-bold ${tone}`}>{marker}</span>
          <div>
            <p className="font-semibold">{s.title}</p>
            <p className="text-sm text-gray-300 mt-1">{s.detail}</p>
            <Chips keys={s.evidence} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function EvidenceChips({ keys = [], evidence }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {keys.filter((k) => evidence[k]).map((k) => (
        <span key={k} className="text-[11px] rounded-md bg-surface-2 border border-line px-2 py-1 text-gray-300">
          <span className="text-muted">{evidence[k].label}:</span> {evidence[k].display}
        </span>
      ))}
    </div>
  )
}

function DataSent({ summary }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-line">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-sm text-muted hover:text-white">
        <span>Data sent to the AI (no raw events, only this summary)</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <pre className="px-5 pb-5 text-[11px] text-gray-300 overflow-x-auto max-h-96">{JSON.stringify(summary, null, 2)}</pre>
      )}
    </div>
  )
}
