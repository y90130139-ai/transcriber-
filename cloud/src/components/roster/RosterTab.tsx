'use client'

import { useCallback, useEffect, useState } from 'react'
import ModelProfile from './ModelProfile'
import PlanEditor from './PlanEditor'
import BatchWeek from './BatchWeek'
import SweepFlags from './SweepFlags'
import { formatDate } from '@/lib/dates'
import { displayHandle, shortOfPlatform, withImpliedInstagram } from '@/lib/socials'
import { labelOf } from '@/lib/taxonomy'
import type { RosterModel } from './types'
import type { Sweep, SweepRow } from '@/lib/sweep'

/** Our own people — as opposed to the Creators tab, which is the Instagram
 *  accounts we research. Different entity, different table, different tab. */
/** Every account of hers, as tap targets on the card.
 *
 *  Capped: a card is a card, and a model on nine platforms would push her
 *  figures off the bottom of it. The rest are one tap away in the sheet. */
function CardLinks({ model }: { model: RosterModel }) {
  const links = withImpliedInstagram(model.socials ?? [], model.handle)
  if (links.length === 0) return null
  return (
    <span className="card-links">
      {links.slice(0, CARD_LINKS).map((link) => (
        <a
          key={link.url}
          className="card-link"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={displayHandle(link)}
          onClick={(event) => event.stopPropagation()}
        >
          {shortOfPlatform(link.platform)}
        </a>
      ))}
      {links.length > CARD_LINKS && (
        <span className="card-link" aria-hidden="true">+{links.length - CARD_LINKS}</span>
      )}
    </span>
  )
}

const CARD_LINKS = 5

/** A tier is a heading here, not a badge. The roster's whole job is to answer
 *  "who needs me" and bespoke people need answering first. */
const TIERS: { key: 'A' | 'B' | 'C'; label: string }[] = [
  { key: 'A', label: 'A · bespoke' },
  { key: 'B', label: 'B · mixed' },
  { key: 'C', label: 'C · library only' },
]

export default function RosterTab({
  openPlanFor,
  onOpened,
}: {
  /** A model the sweep asked for. Opening her plan straight away is the point
   *  of tapping a row over there. */
  openPlanFor?: string | null
  onOpened?: () => void
} = {}) {
  const [models, setModels] = useState<RosterModel[]>([])
  const [sweep, setSweep] = useState<Sweep | null>(null)
  const [weekOf, setWeekOf] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<RosterModel | 'new' | null>(null)
  const [planning, setPlanning] = useState<RosterModel | null>(null)

  const load = useCallback(async () => {
    const response = await fetch('/api/models')
    if (response.ok) {
      const body = await response.json()
      setModels(body.models ?? [])
      setWeekOf(body.weekOf ?? '')
    }
    setLoading(false)
  }, [])

  // The same read the Today tab does. Fetched separately rather than widened
  // into /api/models, so nothing the roster already renders can change shape.
  const loadSweep = useCallback(async () => {
    const response = await fetch('/api/sweep')
    if (response.ok) setSweep(await response.json())
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadSweep() }, [loadSweep])

  useEffect(() => {
    if (!openPlanFor) return
    const wanted = models.find((model) => model.id === openPlanFor)
    if (!wanted) return
    setPlanning(wanted)
    onOpened?.()
  }, [openPlanFor, models, onOpened])

  const sweepRows = new Map<string, SweepRow>(
    (sweep?.rows ?? []).map((row) => [row.id, row]),
  )
  const flagged = (ids: string[] | undefined, id: string) => Boolean(ids?.includes(id))
  const sweepFor = (id: string) => {
    const row = sweepRows.get(id)
    if (!row || !sweep) return null
    return {
      row,
      ours: flagged(sweep.ourSide, id),
      slipped: flagged(sweep.slipped, id),
      silent: flagged(sweep.silent, id),
      overdue: flagged(sweep.overdue, id),
      questions: flagged(sweep.questions, id),
    }
  }

  return (
    <>
      {/* Week creation was per model, per click — twenty models is twenty
          clicks and eighty hand-authored cards every Monday. */}
      <BatchWeek onBuilt={() => { void load(); void loadSweep() }} />

      <div className="section-head">
        <h2>Models</h2>
        <div className="roster-head-actions">
          <span className="tally" style={{ color: 'var(--sc-ink-300)' }}>
            {loading ? 'Loading' : weekOf ? `Week of ${formatDate(weekOf)}` : ''}
          </span>
          <button className="btn" onClick={() => setEditing('new')}>Add a model</button>
        </div>
      </div>

      {models.length === 0 && !loading ? (
        <div className="empty">
          <p>No models yet. Add one, then tag videos to her from the library.</p>
        </div>
      ) : (
        TIERS.filter((tier) => models.some((model) => (model.tier ?? 'B') === tier.key))
          .map((tier) => (
        <section className="tiergroup" key={tier.key}>
          <h3 className="tierhead">
            <span>{tier.label}</span>
            <span className="tally">
              {models.filter((model) => (model.tier ?? 'B') === tier.key).length}
            </span>
          </h3>
        <div className="models">
          {models.filter((model) => (model.tier ?? 'B') === tier.key).map((model) => (
            <div key={model.id} className="model roster-card" data-paused={model.status === 'paused'}>
              <button
                className="model-frame roster-frame"
                onClick={() => setEditing(model)}
                aria-label={`Edit ${model.name}`}
              >
                {model.photo_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={model.photo_url} alt="" width={420} height={420} loading="lazy" />
                ) : (
                  <span className="card-frame-empty">{model.name}</span>
                )}
                {model.unread_notes > 0 && (
                  <span className="roster-unread">{model.unread_notes} unread</span>
                )}
              </button>

              <span className="model-handle">{model.name}</span>
              {model.handle && <span className="model-name">@{model.handle}</span>}

              <span className="model-persona">
                {model.persona.length > 0 ? (
                  model.persona.map((tag) => <span key={tag}>{labelOf('persona', tag)}</span>)
                ) : (
                  <span data-empty="true">No persona set</span>
                )}
              </span>

              <span className="model-figures">
                <b>{model.week_items}</b> this week · <b>{model.week_filmed}</b> filmed
                {model.week_waiting > 0 && <> · <b>{model.week_waiting}</b> uploading</>}
                {model.week_declined > 0 && (
                  <> · <b className="roster-declined">{model.week_declined}</b> turned down</>
                )}
                {/* Sent and seen used to be the same state. Only said once
                    the plan is actually out — "not opened" on a draft nobody
                    sent is noise, and the sweep's own side already carries
                    that. */}
                {model.plan_status === 'sent' && (
                  model.week_opened
                    ? <> · opened</>
                    : <> · <b className="roster-declined">not opened</b></>
                )}
                {model.status === 'paused' && ' · paused'}
              </span>

              {/* Her accounts, on the grid. The common case — open her
                  Instagram and look at what she posted — should not need the
                  profile opened at all, which is the whole point of the ask.
                  `stopPropagation` because the card behind opens the sheet. */}
              <CardLinks model={model} />

              {/* Why she is red, not just that she is. A count alone reads the
                  same whether the week was never sent or she is filming it. */}
              <SweepFlags row={sweepFor(model.id)} />

              <span className="roster-actions">
                <button className="btn btn-small" onClick={() => setPlanning(model)}>
                  {model.plan_status === 'sent' ? 'Plan · sent' : 'Plan'}
                </button>
                <button className="btn btn-quiet btn-small" onClick={() => setEditing(model)}>
                  Edit
                </button>
              </span>
            </div>
          ))}
        </div>
        </section>
      )))}

      {editing && (
        <ModelProfile
          model={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}

      {planning && (
        <PlanEditor
          modelId={planning.id}
          modelName={planning.name}
          onClose={() => { setPlanning(null); void load() }}
        />
      )}
    </>
  )
}
