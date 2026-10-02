'use client'

import Choice, { Why } from './Choice'
import { BATCH, BUSY, MAX_PERSONAS, ON_CAMERA, TIMES, TOP_CREATOR_WEEKLY, paceBand, splitFor, type Busy, type Lang, type TimeSlot } from '@/lib/survey/core'
import {
  BUSY_OPTIONS, DAY_LABELS, DAY_ORDER, ES_LABELS, GROUPS, IG_LINE, PACE, Q, RESULT, SPLIT, TIME_LABELS, TOP_LINE,
  daysWhy, fill, formatsVerdict, perDayWhy,
} from '@/lib/survey/copy'
import { taxonomy } from '@/lib/taxonomy'

export type Draft = {
  per_day: number | null
  days: number[]
  times: TimeSlot[]
  weekly: number | null
  formats: string[]
  wont: string[]
  personas: string[]
  busy: Busy | null
}

type StepProps = { lang: Lang; draft: Draft; set: (patch: Partial<Draft>) => void }

const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value])
const tagLabel = (axis: 'format' | 'persona', id: string, lang: Lang) =>
  (lang === 'es' && ES_LABELS[id]) || taxonomy[axis].tags.find((t) => t.id === id)?.label || id

const PER_DAY_OPTIONS = [1, 2, 3, 4, 5]
const OTHER_FORMATS = taxonomy.format.tags.map((t) => t.id).filter((id) => !ON_CAMERA.includes(id) && !BATCH.includes(id))

function Head({ title, hint }: { title: string; hint?: string }) {
  return (
    <>
      <h2 className="sv-q">{title}</h2>
      {hint && <p className="sv-hint">{hint}</p>}
    </>
  )
}

export function PerDay({ lang, draft, set }: StepProps) {
  return (
    <>
      <Head title={Q.perDay.title[lang]} />
      <div className="sv-row">
        {PER_DAY_OPTIONS.map((n) => (
          <Choice key={n} on={draft.per_day === n} onTap={() => set({ per_day: n })}>{n === 5 ? '5+' : n}</Choice>
        ))}
      </div>
      {draft.per_day !== null && <Why text={perDayWhy(draft.per_day)[lang]} tone={draft.per_day >= 3 ? 'good' : 'note'} />}
    </>
  )
}

export function Days({ lang, draft, set }: StepProps) {
  return (
    <>
      <Head title={Q.days.title[lang]} hint={Q.days.hint[lang]} />
      <div className="sv-row sv-row-days">
        {DAY_ORDER.map((d) => (
          <Choice key={d} on={draft.days.includes(d)} onTap={() => set({ days: toggle(draft.days, d) })}>{DAY_LABELS[lang][d]}</Choice>
        ))}
      </div>
      {draft.days.length > 0 && <Why text={daysWhy(draft.days.length)[lang]} tone={draft.days.length >= 5 ? 'good' : draft.days.length <= 2 ? 'warn' : 'note'} />}
    </>
  )
}

export function Times({ lang, draft, set }: StepProps) {
  return (
    <>
      <Head title={Q.times.title[lang]} />
      <div className="sv-stack">
        {TIMES.map((t) => (
          <Choice key={t} wide on={draft.times.includes(t)} onTap={() => set({ times: toggle(draft.times, t) })} sub={TIME_LABELS[t].span[lang]}>
            {TIME_LABELS[t].label[lang]}
          </Choice>
        ))}
      </div>
      <Why text={Q.times.why[lang]} />
    </>
  )
}

export function Weekly({ lang, draft, set }: StepProps) {
  const weekly = draft.weekly ?? 1
  const pace = PACE[paceBand(weekly)]
  return (
    <>
      <Head title={Q.weekly.title[lang]} hint={Q.weekly.hint[lang]} />
      <div className="sv-stepper">
        <button type="button" className="sv-step-btn" aria-label="−1" onClick={() => set({ weekly: Math.max(1, weekly - 1) })}>−</button>
        <output className="sv-step-value" aria-live="polite">{weekly}</output>
        <button type="button" className="sv-step-btn" aria-label="+1" onClick={() => set({ weekly: Math.min(100, weekly + 1) })}>+</button>
      </div>
      <Why text={pace.text[lang]} tone={pace.tone} />
      <Why text={TOP_LINE[lang]} />
      <SplitView lang={lang} weekly={weekly} />
    </>
  )
}

/** Her week under the 70/20/10 rule, with her own numbers, so she can see
 *  that at low volume there is no room left to test anything new. */
export function SplitView({ lang, weekly }: { lang: Lang; weekly: number }) {
  const split = splitFor(weekly)
  const rows = [
    { n: split.winners, label: SPLIT.winners[lang], share: 70 },
    { n: split.takes, label: SPLIT.takes[lang], share: 20 },
    { n: split.tests, label: SPLIT.tests[lang], share: 10 },
  ]
  return (
    <section className="sv-split" aria-label={SPLIT.title[lang]}>
      <h3 className="sv-group-title">{SPLIT.title[lang]}</h3>
      <ul>
        {rows.map((r) => (
          <li key={r.share} data-empty={r.n === 0}>
            <span className="sv-split-n">{r.n}</span>
            <span className="sv-split-label">{r.label}</span>
            <span className="sv-split-share">{r.share}%</span>
          </li>
        ))}
      </ul>
      <p className="sv-group-why">{SPLIT.why[lang]}</p>
    </section>
  )
}

/** The benchmark line on the result screen: how far from top-creator pace. */
export function toTopLine(weekly: number, lang: Lang): string {
  return weekly >= TOP_CREATOR_WEEKLY ? RESULT.atTop[lang] : fill(RESULT.toTop[lang], { n: TOP_CREATOR_WEEKLY - weekly })
}

export { IG_LINE }

function FormatGroup({ ids, title, why, lang, picked, onTap }: { ids: string[]; title: string; why?: string; lang: Lang; picked: string[]; onTap: (id: string) => void }) {
  return (
    <section className="sv-group">
      <h3 className="sv-group-title">{title}</h3>
      {why && <p className="sv-group-why">{why}</p>}
      <div className="sv-wrap">
        {ids.map((id) => <Choice key={id} on={picked.includes(id)} onTap={() => onTap(id)}>{tagLabel('format', id, lang)}</Choice>)}
      </div>
    </section>
  )
}

export function Formats({ lang, draft, set }: StepProps) {
  const tap = (id: string) => set({ formats: toggle(draft.formats, id), wont: draft.wont.filter((w) => w !== id) })
  const verdict = formatsVerdict(
    draft.formats.filter((f) => ON_CAMERA.includes(f)).length,
    draft.formats.filter((f) => BATCH.includes(f)).length,
  )
  return (
    <>
      <Head title={Q.formats.title[lang]} hint={Q.formats.hint[lang]} />
      <FormatGroup ids={ON_CAMERA} title={GROUPS.onCamera.title[lang]} why={GROUPS.onCamera.why[lang]} lang={lang} picked={draft.formats} onTap={tap} />
      <FormatGroup ids={BATCH} title={GROUPS.batch.title[lang]} why={GROUPS.batch.why[lang]} lang={lang} picked={draft.formats} onTap={tap} />
      <FormatGroup ids={OTHER_FORMATS} title={GROUPS.other.title[lang]} lang={lang} picked={draft.formats} onTap={tap} />
      {verdict && <Why text={verdict.text[lang]} tone={verdict.tone} />}
    </>
  )
}

export function Wont({ lang, draft, set }: StepProps) {
  const options = taxonomy.format.tags.map((t) => t.id).filter((id) => !draft.formats.includes(id))
  return (
    <>
      <Head title={Q.wont.title[lang]} hint={Q.wont.hint[lang]} />
      <div className="sv-wrap">
        {options.map((id) => (
          <Choice key={id} on={draft.wont.includes(id)} onTap={() => set({ wont: toggle(draft.wont, id) })}>{tagLabel('format', id, lang)}</Choice>
        ))}
      </div>
    </>
  )
}

export function Personas({ lang, draft, set }: StepProps) {
  const full = draft.personas.length >= MAX_PERSONAS
  return (
    <>
      <Head title={Q.personas.title[lang]} hint={Q.personas.hint[lang]} />
      <div className="sv-wrap">
        {taxonomy.persona.tags.map((t) => {
          const on = draft.personas.includes(t.id)
          return (
            <Choice key={t.id} on={on} onTap={() => { if (on || !full) set({ personas: toggle(draft.personas, t.id) }) }}>
              {tagLabel('persona', t.id, lang)}
            </Choice>
          )
        })}
      </div>
      <Why text={Q.personas.why[lang]} />
    </>
  )
}

export function BusyWeek({ lang, draft, set }: StepProps) {
  return (
    <>
      <Head title={Q.busy.title[lang]} />
      <div className="sv-stack">
        {BUSY.map((b) => (
          <Choice key={b} wide on={draft.busy === b} onTap={() => set({ busy: b })}>{BUSY_OPTIONS[b].label[lang]}</Choice>
        ))}
      </div>
      {draft.busy && <Why text={BUSY_OPTIONS[draft.busy].why[lang]} tone={BUSY_OPTIONS[draft.busy].tone} />}
    </>
  )
}

/** Whether a step has what it needs to move on. Wont and personas are optional. */
export function stepReady(step: string, d: Draft): boolean {
  switch (step) {
    case 'perDay': return d.per_day !== null
    case 'days': return d.days.length > 0
    case 'times': return d.times.length > 0
    case 'weekly': return (d.weekly ?? 0) >= 1
    case 'formats': return d.formats.length > 0
    case 'busy': return d.busy !== null
    default: return true
  }
}
