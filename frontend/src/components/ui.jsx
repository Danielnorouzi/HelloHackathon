// Small shared UI pieces: tooltips, badges, skeletons, empty states, section cards, attribution.
import { useState } from 'react'

/** "i" icon that shows an explanation on hover or tap. */
export function InfoTip({ text, className = '' }) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="More info"
        onClick={() => setOpen((o) => !o)}
        className="w-4 h-4 rounded-full border border-line text-[10px] leading-none text-muted hover:text-white hover:border-muted flex items-center justify-center"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-30 left-1/2 -translate-x-1/2 top-6 w-64 rounded-lg bg-surface-2 border border-line p-3 text-xs text-gray-200 font-normal normal-case tracking-normal shadow-xl"
        >
          {text}
        </span>
      )}
    </span>
  )
}

/** Hover tooltip wrapping arbitrary content (used by badges). */
export function HoverTip({ tip, children }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}>
      {children}
      {open && (
        <span role="tooltip"
          className="absolute z-30 left-0 top-full mt-2 w-72 rounded-lg bg-surface-2 border border-line p-3 text-xs text-gray-200 font-normal shadow-xl">
          {tip}
        </span>
      )}
    </span>
  )
}

export function TierBadge({ tier }) {
  const tip = tier === 2
    ? 'Tier 2: full StatsBomb event data, with every pass, carry and shot and its pitch coordinates. Full analysis available.'
    : 'Tier 1: season totals only (API-Football). Card and basic report only, no pitch maps.'
  return (
    <HoverTip tip={tip}>
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border cursor-help ${tier === 2
        ? 'border-accent/60 text-accent' : 'border-line text-muted'}`}>
        Tier {tier} · {tier === 2 ? 'Event data' : 'Basic stats'}
      </span>
    </HoverTip>
  )
}

export function ConfidenceBadge({ confidence }) {
  if (!confidence) return null
  const { score, reasons } = confidence
  const tone = score >= 75 ? 'text-good border-good/50' : score >= 45 ? 'text-yellow-300 border-yellow-300/50' : 'text-bad border-bad/50'
  return (
    <HoverTip tip={<><p className="font-semibold mb-1">Why {score}% confidence?</p>
      <ul className="list-disc pl-4 space-y-1">{reasons.map((r) => <li key={r}>{r}</li>)}</ul></>}>
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border cursor-help ${tone}`}>
        {score}% confidence
      </span>
    </HoverTip>
  )
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />
}

export function EmptyState({ title, children, icon = '⚽' }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-2">
      <div className="text-3xl opacity-60">{icon}</div>
      <p className="font-semibold">{title}</p>
      {children && <div className="text-sm text-muted max-w-md">{children}</div>}
    </div>
  )
}

export function ErrorState({ error }) {
  return <EmptyState icon="⚠️" title="Something went wrong">{String(error?.message || error)}</EmptyState>
}

/** A titled panel. `explain` is the one-line explanation under the title; `info` feeds the tooltip. */
export function Section({ title, explain, info, children, right, className = '' }) {
  return (
    <section className={`rounded-2xl bg-surface border border-line p-5 ${className}`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">{title}{info && <InfoTip text={info} />}</h3>
          {explain && <p className="text-sm text-muted mt-0.5">{explain}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

/** Segmented control used for filters and tabs. */
export function Segmented({ options, value, onChange, size = 'sm' }) {
  return (
    <div className="inline-flex rounded-lg bg-surface-2 p-1 gap-1 flex-wrap">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`rounded-md px-3 ${size === 'sm' ? 'py-1 text-xs' : 'py-1.5 text-sm'} font-medium transition ${value === o.value
            ? 'bg-accent text-black' : 'text-muted hover:text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Required credit wherever StatsBomb data is displayed. */
export function StatsBombAttribution() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      {/* Official "colour positive" logo is made for light backgrounds, so it sits on a white chip. */}
      <span className="inline-flex items-center rounded-md bg-white px-2 py-1">
        <img src="/statsbomb-logo.png" alt="StatsBomb" className="h-3.5 w-auto" />
      </span>
      <span>
        Data: <a className="underline hover:text-white" href="https://github.com/statsbomb/open-data" target="_blank"
          rel="noreferrer">StatsBomb Open Data</a>. Free for non-commercial use.
      </span>
    </div>
  )
}
