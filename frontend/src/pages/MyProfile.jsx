// My Profile: skill-test form (with instructions), the user's card, and comparison with a pro.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { get, invalidate, patch, post } from '../api'
import useFetch from '../useFetch'
import PlayerCard, { Evidence } from '../components/PlayerCard'
import Comparison from '../components/Comparison'
import PlayerPicker from '../components/PlayerPicker'
import { ErrorState, InfoTip, Section, Segmented, Skeleton } from '../components/ui'

export default function MyProfile() {
  const cfg = useFetch('/skills/config')
  const questions = useFetch('/self-assessment/config')
  const [me, setMe] = useState({ loading: true, data: null })
  const [editing, setEditing] = useState(false)

  const loadMe = () => {
    invalidate('/me')
    get('/me').then((data) => setMe({ loading: false, data })).catch(() => setMe({ loading: false, data: null }))
  }
  useEffect(loadMe, [])

  if (cfg.error) return <ErrorState error={cfg.error} />
  if (questions.error) return <ErrorState error={questions.error} />
  if (cfg.loading || questions.loading || me.loading) return <Skeleton className="h-96" />

  const showForm = editing || !me.data
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">My Profile</h1>
        <p className="text-muted mt-1">Do the 8-test skill battery, get your own card, and see how you compare with a pro.</p>
      </div>
      {showForm ? (
        <SkillForm config={cfg.data} questions={questions.data} initial={me.data} onCancel={me.data ? () => setEditing(false) : null}
          onSaved={() => { invalidate('/compare'); loadMe(); setEditing(false) }} />
      ) : (
        <MyCard me={me.data} config={cfg.data} onRetake={() => setEditing(true)} onRenamed={loadMe} />
      )}
    </div>
  )
}

function SkillForm({ config, questions, initial, onSaved, onCancel }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [age, setAge] = useState(initial?.age ?? '')
  const [position, setPosition] = useState(initial?.position_group ?? 'MID')
  const [results, setResults] = useState(() => Object.fromEntries(config.tests.map((t) => [t.id, initial?.results?.[t.id] ?? ''])))
  const [answers, setAnswers] = useState(() => ({ ...(initial?.self_assessment ?? {}) }))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!age) { setError('Enter your age: benchmarks depend on it.'); return }
    setSaving(true)
    try {
      await post('/me', {
        name, age: Number(age), position_group: position,
        results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v === '' ? null : Number(v)])),
        self_assessment: answers,
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Section title="About you" explain="Your age picks the benchmark table; your position sets how the OVR is weighted.">
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Me" className={inputCls} /></Field>
          <Field label="Age"><input type="number" min="6" max="80" value={age} onChange={(e) => setAge(e.target.value)} className={inputCls} required /></Field>
          <Field label="Position">
            <Segmented size="md" value={position} onChange={setPosition}
              options={[{ value: 'FWD', label: 'Forward' }, { value: 'MID', label: 'Midfielder' }, { value: 'DEF', label: 'Defender' }]} />
          </Field>
        </div>
      </Section>

      <Section title="Skill-test battery" explain="Do each test, then enter your result. Skip any you can't do. Your card will show lower confidence."
        info="Benchmarks are rough coaching guides by age group, not scientific norms. Results are converted to a 40–99 score.">
        <div className="grid md:grid-cols-2 gap-4">
          {config.tests.map((t) => (
            <div key={t.id} className="rounded-xl bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-xs text-muted">{t.better === 'lower' ? 'Lower is better' : 'Higher is better'} · {t.attribute}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input type="number" step="any" min="0" max={t.max} value={results[t.id]}
                    onChange={(e) => setResults((r) => ({ ...r, [t.id]: e.target.value }))}
                    aria-label={`${t.name} result`} className={`${inputCls} w-24 text-right`} />
                  <span className="text-xs text-muted w-16">{t.unit}</span>
                </div>
              </div>
              <p className="text-xs text-gray-300 mt-3 leading-relaxed">{t.instructions}</p>
            </div>
          ))}
        </div>
      </Section>

      <SelfAssessment questions={questions} answers={answers} setAnswers={setAnswers} />

      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={saving}
          className="rounded-xl bg-accent text-black font-semibold px-6 py-3 disabled:opacity-60">
          {saving ? 'Saving…' : 'Create my card'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-xl border border-line px-6 py-3 text-muted hover:text-white">Cancel</button>}
      </div>
    </form>
  )
}

const inputCls = 'w-full rounded-lg bg-surface border border-line focus:border-accent outline-none px-3 py-2'

function Field({ label, children }) {
  return <label className="block text-sm"><span className="block text-xs text-muted mb-1">{label}</span>{children}</label>
}

/** Physical and defending questions. Answers are the player's own view, shown as self-reported. */
function SelfAssessment({ questions, answers, setAnswers }) {
  return (
    <Section title="Physical and defending self-assessment"
      explain={`Your own judgement of things the tests don't measure. Answer at least ${questions.min_answers} per area. These are shown as self-reported, never as measured results.`}
      info="Self-reported answers give a rough PHY and DEF on your card. They are labelled 'self', are not part of your OVR, and are only used to guide comparisons and training plans.">
      <div className="grid lg:grid-cols-2 gap-6">
        {Object.entries(questions.areas).map(([area, a]) => (
          <div key={area} className="space-y-4">
            <div><p className="font-semibold">{a.label} ({area})</p><p className="text-xs text-muted">{a.intro}</p></div>
            {questions.questions.filter((q) => q.area === area).map((q) => (
              <fieldset key={q.id} className="rounded-xl bg-surface-2 p-4">
                <legend className="text-sm mb-2">{q.text}</legend>
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt, i) => {
                    const on = answers[q.id] === i + 1
                    return (
                      <button key={opt} type="button" aria-pressed={on}
                        onClick={() => setAnswers((prev) => {
                          const next = { ...prev }
                          if (on) delete next[q.id]; else next[q.id] = i + 1
                          return next
                        })}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${on ? 'border-accent bg-accent/10 text-white' : 'border-line text-muted hover:text-white'}`}>
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        ))}
      </div>
    </Section>
  )
}

function NameEditor({ name, onRenamed }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [state, setState] = useState({ saving: false, error: null })
  const save = async (e) => {
    e.preventDefault()
    setState({ saving: true, error: null })
    try {
      await patch('/me', { name: value })
      invalidate('/me')
      invalidate('/compare')
      setEditing(false)
      setState({ saving: false, error: null })
      onRenamed()
    } catch (err) {
      setState({ saving: false, error: err.message })
    }
  }
  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold">{name}</h2>
        <button type="button" onClick={() => { setValue(name); setEditing(true) }} className="text-sm text-accent hover:underline">Edit name</button>
      </div>
    )
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={40} aria-label="Display name"
        className="rounded-lg bg-surface border border-line focus:border-accent outline-none px-3 py-2" />
      <button type="submit" disabled={state.saving || !value.trim()} className="rounded-lg bg-accent text-black font-semibold px-4 py-2 disabled:opacity-50">
        {state.saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-line px-4 py-2 text-muted hover:text-white">Cancel</button>
      {state.error && <p className="text-sm text-bad w-full">{state.error}</p>}
    </form>
  )
}

function MyCard({ me, config, onRetake, onRenamed }) {
  const [selected, setSelected] = useState('PAC')
  const [params, setParams] = useSearchParams()
  const target = params.get('target') || 'sb-5503'
  const card = me.card
  const tests = config.tests

  return (
    <div className="space-y-10">
      <NameEditor name={me.name} onRenamed={onRenamed} />
      <div className="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
        <PlayerCard card={card} name={me.name} subtitle={`Skill tests · age group ${card.age_group}`} variant="user"
          onSelect={setSelected} selected={selected} />
        <div className="space-y-6">
          <Section title="Evidence" explain="Your attributes come from your test results (and, where labelled, your own answers), not match data.">
            <Evidence card={card} code={selected} />
          </Section>
          <Section title="Your results" right={<button onClick={onRetake} className="text-sm text-accent hover:underline">Retake tests</button>}>
            <table className="w-full text-sm">
              <tbody>
                {tests.map((t) => {
                  const r = card.tests[t.id]
                  return (
                    <tr key={t.id} className="border-b border-line/50">
                      <td className="py-2">{t.name}</td>
                      <td className="py-2 text-right tabular-nums">{r ? `${r.value} ${t.unit}` : <span className="text-muted">not entered</span>}</td>
                      <td className="py-2 pl-4 text-muted">{r?.level ?? ''}</td>
                      <td className="py-2 text-right tabular-nums font-semibold">{r?.score ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Section>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">Compare with a pro
              <InfoTip text="Search any player in the dataset, or use a demo shortcut. You can also open a player's page and use Train Like Him." /></h2>
            <p className="text-muted text-sm">See which attributes are furthest from your target.</p>
          </div>
          <PlayerPicker value={target} valueName={params.get('name')}
            onChange={(key, name) => setParams({ target: key, name })} />
        </div>
        <Comparison target={target} />
      </div>
    </div>
  )
}
