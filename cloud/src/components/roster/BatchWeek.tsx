'use client'

import { useCallback, useEffect, useState } from 'react'
import CollisionFlag from './CollisionFlag'
import { assignableWeeks } from './ModelWeekPicker'
import { formatDate } from '@/lib/dates'
import { labelOf } from '@/lib/taxonomy'
import type { Batch, BatchRow } from '@/lib/batch'

/**
 * Draft every active model's week in one pass.
 *
 * Week creation was per model, per click — twenty models is twenty clicks and
 * eighty hand-authored cards every Monday. This is that Monday, once.
 *
 * Previewed before it is written, and every week it opens is a draft: a draft
 * is invisible to her until somebody marks it sent, and there is no control
 * here — or parameter in the route behind it — that can send anything.
 */
export default function BatchWeek({ onBuilt, open: openProp, onOpenChange }: {
  onBuilt: () => void
  /** Controlled by the page when the trigger lives in its header; the button
   *  used to sit on a row of its own. */
  open?: boolean
  onOpenChange?: (next: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [weekOf, setWeekOf] = useState(() => assignableWeeks()[1])
  const [batch, setBatch] = useState<Batch | null>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [showing, setShowing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const load = useCallback(async () => {
    setBatch(null)
    setNote(null)
    const response = await fetch(`/api/plans/batch?week=${encodeURIComponent(weekOf)}`)
    if (!response.ok) { setNote({ text: 'Could not work that week out.', bad: true }); return }
    setBatch(await response.json())
  }, [weekOf])

  useEffect(() => { if (open) void load() }, [open, load])

  const taking = (row: BatchRow) => !skipped.has(row.model_id) && row.picks.length > 0
  const rows = batch?.rows ?? []
  const totalCards = rows.filter(taking).reduce((count, row) => count + row.picks.length, 0)
  const totalWeeks = rows.filter(taking).length

  async function build() {
    if (!batch || totalCards === 0) return
    setBusy(true)
    setNote(null)
    const response = await fetch('/api/plans/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        week_of: batch.weekOf,
        picks: rows.filter(taking).map((row) => ({
          model_id: row.model_id,
          job_ids: row.picks.map((pick) => pick.job_id),
        })),
      }),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(false)
    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not build those.', bad: true })
      return
    }
    setNote({
      text: `${body.added} cards across ${body.built?.length ?? 0} weeks — all drafts. Nothing has been sent.`,
    })
    onBuilt()
    void load()
  }

  if (!open) {
    // Controlled: the header owns the trigger, so there is nothing to render.
    if (openProp !== undefined) return null
    return (
      <div className="backfill-open">
        <button className="btn btn-quiet" onClick={() => setOpen(true)}>
          Build a week for everyone
        </button>
      </div>
    )
  }

  return (
    <section className="backfill" aria-label="Batch week builder">
      <div className="section-head">
        <h2 style={{ fontSize: 'var(--sc-text-lg)' }}>Build a week for everyone</h2>
        <button className="btn btn-quiet btn-small" onClick={() => setOpen(false)}>Close</button>
      </div>

      <div className="weekrail" role="group" aria-label="Which week">
        {assignableWeeks().map((week, index) => (
          <button
            key={week}
            className="pill"
            data-on={week === weekOf}
            onClick={() => setWeekOf(week)}
          >
            {index === 0 ? 'This week' : 'Next week'} · {formatDate(week)}
          </button>
        ))}
      </div>

      <p className="hint">
        Each model&rsquo;s own fit-ranked suggestions, up to their weekly target and
        on top of whatever their week already holds. Taken in tier order, so when
        two of them want the same reel the bespoke tier gets first refusal and
        the rest are staggered onto their next best fit. Everything lands as a
        draft — nothing here can send anything.
      </p>

      {batch === null ? (
        <p className="hint">Working the week out…</p>
      ) : rows.length === 0 ? (
        <p className="hint">No active models.</p>
      ) : (
        <ul className="backfill-rows">
          {rows.map((row) => {
            const clashes = row.picks.filter((pick) => pick.also_on.length > 0)
            const doubled = row.picks.filter((pick) => pick.claimed_by)
            return (
              <li key={row.model_id} className="backfill-row" data-done={!taking(row) || undefined}>
                <div className="backfill-who">
                  <b>{row.name}</b>
                  <span className="planrow-meta">
                    {row.picks.length} to draft · their target is {row.weekly_target}
                    {row.already > 0 && ` · ${row.already} already on it`}
                    {row.short > 0 && ` · ${row.short} short`}
                  </span>
                </div>

                {row.wanted === 0 ? (
                  <p className="hint">Their week is already at target. Nothing to add.</p>
                ) : row.picks.length === 0 ? (
                  <p className="hint">
                    Nothing in the library scores for them. Tick the formats they
                    do in their profile — an untagged model matches nothing
                    rather than everything.
                  </p>
                ) : null}

                {/* Item 6, across the whole batch. Without this the builder
                    hands the same reel to every creator in one click. */}
                {clashes.length > 0 && (
                  <span className="bulkassign-clash">
                    <span className="hint">
                      {clashes.length} already on another week
                    </span>
                    <CollisionFlag
                      on={[...new Map(
                        clashes.flatMap((pick) => pick.also_on)
                          .map((other) => [`${other.model_id}|${other.week_of}`, {
                            ...other, status: 'draft' as const,
                          }]),
                      ).values()]}
                    />
                  </span>
                )}

                {doubled.length > 0 && (
                  <span className="rosterflags">
                    <span className="rosterflag" data-tone="warn">
                      {doubled.length} also going to{' '}
                      {[...new Set(doubled.map((pick) => pick.claimed_by))].join(', ')} in this pass
                    </span>
                  </span>
                )}

                {showing === row.model_id && row.picks.length > 0 && (
                  <ul className="batchpicks">
                    {row.picks.map((pick) => (
                      <li key={pick.job_id}>
                        <b>{pick.author ?? pick.job_id}</b>
                        <span>fit {Math.round(pick.fit)}</span>
                        <span>
                          {pick.matched.map((tag) => labelOf('format', tag)).join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="backfill-actions">
                  <button
                    className="btn btn-quiet btn-small"
                    disabled={row.picks.length === 0}
                    onClick={() =>
                      setSkipped((current) => {
                        const next = new Set(current)
                        if (next.has(row.model_id)) next.delete(row.model_id)
                        else next.add(row.model_id)
                        return next
                      })
                    }
                  >
                    {skipped.has(row.model_id) ? 'Put them back in' : 'Leave them out'}
                  </button>
                  {row.picks.length > 0 && (
                    <button
                      className="btn btn-quiet btn-small"
                      onClick={() => setShowing(showing === row.model_id ? null : row.model_id)}
                    >
                      {showing === row.model_id ? 'Hide the picks' : 'See the picks'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="copybar" style={{ position: 'static' }}>
        <button className="btn" disabled={busy || totalCards === 0} onClick={() => void build()}>
          {busy
            ? 'Building'
            : `Draft ${totalCards} card${totalCards === 1 ? '' : 's'} across ${totalWeeks} week${totalWeeks === 1 ? '' : 's'}`}
        </button>
        {note && <span className="hint" data-tone={note.bad ? 'bad' : undefined}>{note.text}</span>}
      </div>
    </section>
  )
}
