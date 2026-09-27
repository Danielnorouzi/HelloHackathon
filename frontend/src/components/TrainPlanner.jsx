// "Train Like Him": plan settings -> 7-day calendar -> session detail.
// The last plan's settings are remembered in this browser, so returning to the page reloads it
// from the server cache instantly.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { post } from '../api'
import useFetch from '../useFetch'
import { EmptyState, InfoTip, Section, Segmented, Skeleton } from './ui'
import PlayerPicker from './PlayerPicker'

const EQUIPMENT = [
  { id: 'ball', label: 'Ball', icon: '⚽' },
  { id: 'cones', label: 'Cones', icon: '🔺' },
  { id: 'wall', label: 'Wall', icon: '🧱' },
  { id: 'goal', label: 'Goal', icon: '🥅' },
  { id: 'partner', label: 'Partner', icon: '🧍' },
]
const STORAGE_KEY = 'soccerscout.lastPlan'

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch { return null }
}
function save(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* private mode: fine */ }
}

export default function TrainPlanner({ fixedTarget, scope }) {
  const me = useFetch('/me')
  const saved = loadSaved()
  const [target, setTarget] = useState(fixedTarget ?? saved?.target ?? 'sb-5503')
  const [targetName, setTargetName] = useState(saved?.targetName)
  const [sessions, setSessions] = useState(saved?.sessions_per_week ?? 3)
  const [minutes, setMinutes] = useState(saved?.minutes_per_session ?? 45)
  const [equipment, setEquipment] = useState(saved?.equipment ?? ['ball', 'cones'])
  const [state, setState] = useState({ loading: false, plan: null, error: null })
  const [openDay, setOpenDay] = useState(null)

  const settings = { target, scope: fixedTarget ? scope : undefined, sessions_per_week: sessions,
    minutes_per_session: minutes, equipment }

  const generate = async (s = settings) => {
    setState({ loading: true, plan: null, error: null })
    setOpenDay(null)
    try {
      const plan = await post('/plan', s)
      save({ ...s, targetName })
      setState({ loading: false, plan, error: null })
      setOpenDay(plan.days.find((d) => d.type === 'session')?.day ?? null)
    } catch (e) {
      setState({ loading: false, plan: null, error: e.message })
    }
  }

  // Coming back to the page: if the saved plan matches this target, reload it (a cache hit).
  useEffect(() => {
    if (me.data && saved && (!fixedTarget || saved.target === fixedTarget)) generate(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data])

  if (me.loading) return <Skeleton className="h-64" />
  if (me.error) {
    return (
      <EmptyState icon="🪪" title="First, create your player card">
        The plan targets the gaps between you and the pro, so it needs your skill-test results.
        <div className="mt-4"><Link to="/me" className="inline-block rounded-xl bg-accent text-black font-semibold px-5 py-2.5">Do the skill tests</Link></div>
      </EmptyState>
    )
  }

  const toggle = (id) => setEquipment((eq) => (eq.includes(id) ? eq.filter((e) => e !== id) : [...eq, id]))
  const plan = state.plan
  const day = plan?.days.find((d) => d.day === openDay)

  return (
    <div className="space-y-6">
      <Section title="Plan settings" explain="A 7-day plan built around your 2–3 biggest gaps to the target. Day 7 is always a re-test."
        info="Gaps come from comparing your skill-test card with the target's match-data card. The AI writes the sessions; the app checks they only use your equipment and fit your time.">
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            {!fixedTarget && (
              <PlayerPicker label="Target player" value={target} valueName={targetName} onChange={(key, name) => { setTarget(key); setTargetName(name) }} />
            )}
            <div className="text-sm">
              <span className="block text-xs text-muted mb-1">Sessions this week</span>
              <Segmented size="md" value={sessions} onChange={setSessions}
                options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))} />
            </div>
            <div className="text-sm">
              <span className="block text-xs text-muted mb-1">Minutes per session</span>
              <Segmented size="md" value={minutes} onChange={setMinutes}
                options={[30, 45, 60, 75, 90].map((n) => ({ value: n, label: `${n}` }))} />
            </div>
          </div>
          <div className="space-y-4">
            <div className="text-sm">
              <span className="block text-xs text-muted mb-1 flex items-center gap-1">Equipment you have
                <InfoTip text="Drills will only use what you select. Without a partner, defender progressions become solo versions (cones, time pressure)." /></span>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT.map((e) => {
                  const on = equipment.includes(e.id)
                  return (
                    <button key={e.id} type="button" onClick={() => toggle(e.id)} aria-pressed={on}
                      className={`rounded-xl border px-3 py-2 text-sm transition ${on ? 'border-accent bg-accent/10 text-white' : 'border-line text-muted hover:text-white'}`}>
                      <span className="mr-1">{e.icon}</span>{e.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <p className="text-xs text-muted">Plan length: 7 days (MVP).</p>
            <button type="button" onClick={() => generate()} disabled={state.loading || equipment.length === 0}
              className="rounded-xl bg-accent text-black font-semibold px-6 py-3 disabled:opacity-60">
              {state.loading ? 'Building your plan…' : 'Generate 7-day plan'}
            </button>
            {equipment.length === 0 && <p className="text-xs text-bad">Select at least one piece of equipment.</p>}
          </div>
        </div>
      </Section>

      {state.loading && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Writing sessions for your gaps… about 30 seconds the first time, instant after that.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">{[...Array(7)].map((_, i) => <Skeleton key={i} className="h-36" />)}</div>
        </div>
      )}
      {state.error && <EmptyState icon="⚠️" title="Couldn't build the plan">{state.error}</EmptyState>}

      {plan && (
        <>
          <div>
            <h2 className="text-2xl font-bold">{plan.title}</h2>
            <p className="text-gray-300 mt-1 max-w-3xl">{plan.summary}</p>
          </div>
          <Focuses focuses={plan.focuses} target={plan.inputs.target} />
          <Calendar days={plan.days} openDay={openDay} setOpenDay={setOpenDay} />
          {day && <DayDetail day={day} />}
        </>
      )}
    </div>
  )
}

function Focuses({ focuses, target }) {
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {focuses.map((f) => (
        <div key={f.attribute} className="rounded-2xl bg-surface border border-line p-4">
          <div className="flex items-baseline justify-between">
            <p className="font-bold">{f.label} <span className="text-muted font-normal">({f.attribute})</span></p>
            <p className="text-sm tabular-nums"><span className="text-sky-300">{f.user}</span> → <span className="text-accent">{f.target}</span></p>
          </div>
          <p className="text-xs text-muted mt-1">Gap {f.gap} to {target}</p>
          <ul className="text-xs text-gray-300 mt-3 space-y-1">
            {f.user_tests.map((t) => <li key={t}>You · {t}</li>)}
            {f.target_stats.slice(0, 2).map((t) => <li key={t} className="text-muted">Pro · {t}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}

const DAY_STYLE = {
  session: 'border-accent/40 bg-accent/5 hover:border-accent',
  rest: 'border-line bg-surface hover:border-muted',
  retest: 'border-sky-400/40 bg-sky-400/5 hover:border-sky-400',
}

function Calendar({ days, openDay, setOpenDay }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {days.map((d) => (
        <button key={d.day} type="button" onClick={() => setOpenDay(d.day)}
          className={`text-left rounded-2xl border p-4 min-h-36 transition ${DAY_STYLE[d.type]} ${openDay === d.day ? 'ring-2 ring-white/60' : ''}`}>
          <p className="text-xs text-muted">Day {d.day}</p>
          {d.type === 'session' && (
            <>
              <p className="text-xs font-bold text-accent mt-2">{d.focus}</p>
              <p className="text-sm font-semibold leading-snug mt-1 line-clamp-3">{d.main_drill.name}</p>
              <p className="text-xs text-muted mt-2">{d.duration_min} min</p>
            </>
          )}
          {d.type === 'rest' && <p className="text-sm text-muted mt-2">Rest / recovery</p>}
          {d.type === 'retest' && (
            <>
              <p className="text-xs font-bold text-sky-300 mt-2">RE-TEST</p>
              <p className="text-sm font-semibold mt-1">Skill battery</p>
            </>
          )}
        </button>
      ))}
    </div>
  )
}

function DayDetail({ day }) {
  if (day.type === 'rest') {
    return <Section title={`Day ${day.day} · Rest`}><p className="text-gray-300">{day.note}</p></Section>
  }
  if (day.type === 'retest') {
    return (
      <Section title={`Day ${day.day} · Re-test`} explain={day.note}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted border-b border-line">
            <th className="py-2 font-medium">Test</th><th className="py-2 font-medium">Beat this</th><th className="py-2 font-medium hidden md:table-cell">How</th>
          </tr></thead>
          <tbody>
            {day.tests.map((t) => (
              <tr key={t.id} className="border-b border-line/50 align-top">
                <td className="py-2 pr-4">{t.name}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {t.skip_reason ? <span className="text-muted">Skip ({t.skip_reason})</span>
                    : t.previous != null ? `${t.better === 'lower' ? '<' : '>'} ${t.previous} ${t.unit}` : 'New test'}
                </td>
                <td className="py-2 text-xs text-gray-300 hidden md:table-cell">{t.instructions}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link to="/me" className="inline-block mt-4 text-sm text-accent hover:underline">Enter new results in My Profile →</Link>
      </Section>
    )
  }
  const m = day.main_drill
  return (
    <Section title={`Day ${day.day} · ${m.name}`} explain={day.objective}
      right={<span className="text-sm text-muted whitespace-nowrap">{day.duration_min} min</span>}>
      <div className="flex flex-wrap gap-2 mb-6">
        {day.equipment.map((e) => <span key={e} className="text-xs rounded-full border border-line px-2.5 py-1">{EQUIPMENT.find((x) => x.id === e)?.icon} {e}</span>)}
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <Block title="Warm-up" minutes={day.warm_up.minutes}><List items={day.warm_up.activities} /></Block>
        <div className="lg:col-span-2 space-y-4">
          <Block title="Main drill" minutes={m.minutes}>
            <p className="text-sm text-gray-300"><span className="text-muted">Setup: </span>{m.setup}</p>
            <p className="text-sm text-gray-300 mt-2">{m.instructions}</p>
            <p className="text-sm mt-3"><span className="text-muted">Reps:</span> {m.reps} · <span className="text-muted">Rest:</span> {m.rest}</p>
          </Block>
          <ol className="grid sm:grid-cols-3 gap-3">
            {m.progressions.map((p, i) => (
              <li key={p.level} className="rounded-xl bg-surface-2 p-3">
                <p className="text-xs font-bold text-accent">Level {i + 1}</p>
                <p className="text-sm font-semibold">{p.level}</p>
                <p className="text-xs text-gray-300 mt-1">{p.description}</p>
              </li>
            ))}
          </ol>
        </div>
        <Block title={`Game-like: ${day.game_like.name}`} minutes={day.game_like.minutes}>
          <p className="text-sm text-gray-300">{day.game_like.description}</p>
        </Block>
        <Block title="Cool-down" minutes={day.cool_down.minutes}><List items={day.cool_down.activities} /></Block>
        <Block title="Success criteria">
          <ul className="space-y-1.5">{day.success_criteria.map((c) => <li key={c} className="text-sm text-gray-300 flex gap-2"><span className="text-good">✓</span>{c}</li>)}</ul>
        </Block>
      </div>
    </Section>
  )
}

function Block({ title, minutes, children }) {
  return (
    <div>
      <p className="text-sm font-semibold mb-2">{title}{minutes != null && <span className="text-muted font-normal"> · {minutes} min</span>}</p>
      {children}
    </div>
  )
}

function List({ items }) {
  return <ul className="list-disc pl-5 space-y-1 text-sm text-gray-300">{items.map((i) => <li key={i}>{i}</li>)}</ul>
}
