'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import SendSurveys from './SendSurveys'
import ModelProfile, { type ProfileTab } from './ModelProfile'
import PlanEditor, { prefetchPlan } from './PlanEditor'
import { prefetchPicks } from './PickVideos'
import BatchWeek from './BatchWeek'
import TrendChip from './TrendChip'
import SweepFlags from './SweepFlags'
import { useStanding } from './useStanding'
import { warmProfile } from './profile/warm'
import { assignableWeeks } from './ModelWeekPicker'
import DropSelect from '../dashboard/DropSelect'
import { currentWeekOf, formatDate } from '@/lib/dates'
import { reasonLabel } from '@/lib/inactive'
import type { RosterModel } from './types'
import type { Standing } from '@/lib/standing'
import type { Sweep, SweepRow } from '@/lib/sweep'

/** Our own people — as opposed to the Creators tab, which is the Instagram
 *  accounts we research. Different entity, different table, different tab. */

/** The heat, worn on the photo: 🔥 on fire, 🧊 cold. The same reading the
 *  Today page's heat lists are built on, loud enough to scan a grid by. */
function HeatFlag({ standing }: { standing?: Standing }) {
  const heat = standing?.engagement.heat
  if (heat !== 'fire' && heat !== 'cold') return null
  return (
    <span className="roster-heat" data-heat={heat} title={standing?.engagement.why}>
      {heat === 'fire' ? '🔥 On fire' : '🧊 Cold'}
    </span>
  )
}

/** Priority is the heading: the roster's whole job is to answer "who needs me",
 *  and that is who gets attention first. Plan type (bespoke / mixed / library)
 *  used to be the heading and is now a word on the card — it says what her
 *  plan is made of, not where she ranks. */
type Group = 'S' | 'A' | 'B' | 'C' | 'D' | 'none' | 'inactive'
const GROUPS: { key: Group; label: string }[] = [
  { key: 'S', label: 'S · priority' },
  { key: 'A', label: 'A · priority' },
  { key: 'B', label: 'B · priority' },
  { key: 'C', label: 'C · priority' },
  // No platform yet — being built from zero on the 30-day sprint (2026-10-07).
  { key: 'D', label: 'D · construction — 30-day sprint' },
  { key: 'none', label: 'Not ranked yet' },
  // Last, greyed out, one tap from coming back (2026-09-30).
  { key: 'inactive', label: 'Inactive' },
]

/** How long the pointer rests on a card before its reads start. Long enough
 *  that a card merely crossed on the way somewhere else never fires; short
 *  enough that reaching for the click is the head start, not the wait. */
const WARM_AFTER_MS = 120

export default function RosterTab({
  openPlanFor,
  openProfileFor,
  onOpened,
}: {
  /** A model the sweep asked for. Opening her plan straight away is the point
   *  of tapping a row over there. */
  openPlanFor?: string | null
  /** A model the dashboard asked for: her profile, on its Analytics tab. */
  openProfileFor?: string | null
  onOpened?: () => void
} = {}) {
  const [models, setModels] = useState<RosterModel[]>([])
  const [sweep, setSweep] = useState<Sweep | null>(null)
  const [weekOf, setWeekOf] = useState(() => currentWeekOf())
  const [loading, setLoading] = useState(true)
  const modelsRequest = useRef(0)
  const [editing, setEditing] = useState<RosterModel | 'new' | null>(null)
  const [editingTab, setEditingTab] = useState<ProfileTab>('profile')
  const [planning, setPlanning] = useState<RosterModel | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const { standing, reload: loadStanding } = useStanding()
  const groupOf = (model: RosterModel): Group =>
    model.status === 'paused' ? 'inactive' : standing[model.id]?.priority ?? 'none'
  /** Name order, or most active first: score, then the size of the move up. */
  const [activeFirst, setActiveFirst] = useState(false)
  const inGroup = (key: Group) => {
    const members = models.filter((model) => groupOf(model) === key)
    if (!activeFirst) return members
    const score = (model: RosterModel) => standing[model.id]?.engagement.score ?? -1
    const delta = (model: RosterModel) => standing[model.id]?.trend?.delta ?? 0
    return [...members].sort((a, b) => score(b) - score(a) || delta(b) - delta(a))
  }

  /**
   * The card answers before the click.
   *
   * Every read her sheet makes — the figures strip, the priority chips, every
   * tab — starts while the pointer is still resting on the card, so the tap
   * opens onto data rather than onto placeholders. The timer is the filter: a
   * pointer that only crosses the grid never fires, and leaving cancels.
   * Touch has no hover to wait on, so the tap itself warms, and the sheet
   * warms again on mount either way — `begin` in lib/live.ts makes the
   * duplicates one request.
   */
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warmSoon = useCallback((id: string) => {
    if (warmTimer.current) clearTimeout(warmTimer.current)
    warmTimer.current = setTimeout(() => {
      warmTimer.current = null
      warmProfile(id)
      // Her weeks ride along, so Plan opens on the week already painted.
      prefetchPlan(id, weekOf)
    }, WARM_AFTER_MS)
  }, [weekOf])
  const cool = useCallback(() => {
    if (!warmTimer.current) return
    clearTimeout(warmTimer.current)
    warmTimer.current = null
  }, [])
  const warmNow = useCallback((id: string) => {
    cool()
    warmProfile(id)
  }, [cool])
  useEffect(() => cool, [cool])

  const load = useCallback(async () => {
    const request = ++modelsRequest.current
    const response = await fetch(`/api/models?week=${encodeURIComponent(weekOf)}`)
    if (!response.ok) { if (request === modelsRequest.current) setLoading(false); return }
    const body = await response.json()
    if (request !== modelsRequest.current) return
    setModels(body.models ?? [])
    setWeekOf(body.weekOf ?? weekOf)
    setLoading(false)
  }, [weekOf])

  // The same read the Today tab does. Fetched separately rather than widened
  // into /api/models, so nothing the roster already renders can change shape.
  const loadSweep = useCallback(async () => {
    const response = await fetch('/api/sweep')
    if (response.ok) setSweep(await response.json())
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadSweep() }, [loadSweep])

  // The plan dialog's video wall is warmed while the roster is being looked
  // at, so pressing Plan opens with videos already painted (Geno, 2026-10-09).
  useEffect(() => { prefetchPicks() }, [])

  useEffect(() => {
    if (!openPlanFor) return
    const wanted = models.find((model) => model.id === openPlanFor)
    if (!wanted) return
    prefetchPlan(wanted.id, weekOf)
    setPlanning(wanted)
    onOpened?.()
  }, [openPlanFor, models, onOpened, weekOf])

  useEffect(() => {
    if (!openProfileFor) return
    const wanted = models.find((model) => model.id === openProfileFor)
    if (!wanted) return
    setEditingTab('analytics')
    setEditing(wanted)
    onOpened?.()
  }, [openProfileFor, models, onOpened])

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
  const weekOptions = assignableWeeks().map((week, index) => ({
    value: week,
    label: `${index === 0 ? 'This week' : 'Next week'} · ${formatDate(week)}`,
  }))

  return (
    <>
      <div className="models-roster">
      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title">Models</h2>
          <p className="dash-sub">
            {loading
              ? 'Loading'
              : `${models.length} model${models.length === 1 ? '' : 's'}${weekOf ? ` · week of ${formatDate(weekOf)}` : ''}`}
          </p>
        </div>
        <div className="dash-head-tools">
          <div className="dash-head-controls">
            <DropSelect
              label="Plan week"
              value={weekOf}
              onChange={setWeekOf}
              options={weekOptions}
            />
            <button
              className="pill"
              aria-pressed={activeFirst}
              data-on={activeFirst}
              onClick={() => setActiveFirst((on) => !on)}
            >
              {activeFirst ? 'Most active first' : 'A–Z'}
            </button>
            <SendSurveys />
            {/* Week creation was per model, per click — twenty models is
                twenty clicks and eighty hand-authored cards every Monday. */}
            <button className="btn btn-quiet" onClick={() => setBatchOpen(true)}>
              Build a week for everyone
            </button>
            <button className="btn" onClick={() => setEditing('new')}>Add a model</button>
          </div>
        </div>
      </header>

      <BatchWeek open={batchOpen} onOpenChange={setBatchOpen}
        onBuilt={() => { void load(); void loadSweep() }} />

      {models.length === 0 && !loading ? (
        <div className="empty">
          <p>No models yet. Add one, then tag videos to them from the library.</p>
        </div>
      ) : (
        GROUPS.filter((group) => models.some((model) => groupOf(model) === group.key))
          .map((group) => (
        <section className="tiergroup" key={group.key}>
          <h3 className="tierhead">
            <span>{group.label}</span>
            <span className="tally">
              {models.filter((model) => groupOf(model) === group.key).length}
            </span>
          </h3>
        <div className="models">
          {inGroup(group.key).map((model) => (
            <div
              key={model.id}
              className="model roster-card"
              data-paused={model.status === 'paused'}
              onClick={() => setEditing(model)}
              onMouseEnter={() => warmSoon(model.id)}
              onMouseLeave={cool}
              onFocusCapture={() => warmSoon(model.id)}
              onBlurCapture={cool}
              onTouchStart={() => warmNow(model.id)}
            >
              <button
                className="model-frame roster-frame"
                onClick={() => setEditing(model)}
                aria-label={`Open ${model.name}`}
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
                <TrendChip trend={standing[model.id]?.trend} />
                <HeatFlag standing={standing[model.id]} />
              </button>

              {/* Two things on the face — who she is and where her week
                  stands. Everything else (persona, figures, links, standing)
                  lives in the sheet this card opens. */}
              <span className="model-handle">{model.name}</span>
              {model.status === 'paused' && (
                <span className="roster-inactive">
                  Inactive · {reasonLabel(model.inactive_reason)}{model.inactive_note ? ` — ${model.inactive_note}` : ''}
                </span>
              )}
              {model.handle && <span className="model-name">@{model.handle}</span>}
              {model.app_account ? (
                <span className="model-name" title={`App account: ${model.app_account.email}`}>
                  App · {model.app_account.status === 'active' ? 'active' : model.app_account.status === 'disabled' ? 'disabled' : 'invited'}
                </span>
              ) : null}

              <SweepFlags row={sweepFor(model.id)} />

              <span className="roster-actions">
                <button className="btn btn-small"
                  title={`Open plan for week of ${formatDate(weekOf)}`}
                  aria-label={`Open ${model.name}'s plan for week of ${formatDate(weekOf)}`}
                  onClick={(event) => { event.stopPropagation(); prefetchPlan(model.id, weekOf); setPlanning(model) }}>
                  {model.plan_status === 'sent' ? 'Plan · sent' : 'Plan'}
                </button>
                <button className="btn btn-quiet btn-small"
                  onClick={(event) => { event.stopPropagation(); setEditing(model) }}>
                  Edit
                </button>
              </span>
            </div>
          ))}
        </div>
        </section>
      )))}
      </div>

      {editing && (
        <ModelProfile
          model={editing === 'new' ? null : editing}
          initialTab={editingTab}
          onClose={() => { setEditing(null); setEditingTab('profile') }}
          onSaved={() => { setEditing(null); setEditingTab('profile'); void load(); void loadStanding() }}
          onStanding={() => void loadStanding()}
          onActive={() => void load()}
          standing={editing === 'new' ? undefined : standing[editing.id]}
        />
      )}

      {planning && (
        <PlanEditor
          modelId={planning.id}
          modelName={planning.name}
          initialWeekOf={weekOf}
          onClose={() => { setPlanning(null); void load(); void loadStanding() }}
        />
      )}
    </>
  )
}
