'use client'

import { useState } from 'react'
import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import type { Attribution } from '@/lib/attribution'
import type { EditorQueue } from '@/lib/editor'
import type { QualityCheck } from '@/lib/quality'
import type { Grade, Review, ReviewedPost } from '@/lib/review'
import { put, useLive } from '@/lib/live'
import VideoStrip, { useReelMedia, type StripItem } from '../../dashboard/VideoStrip'
import RepurposedReels, { type RepurposedPayload } from './RepurposedReels'
import { useRepurpose } from './useRepurpose'
import { SentWeeks } from './StandingTab'

type Payload = Review & { attribution: Attribution }

/** The week's reels in four rows, best first — the old Review tab's grades,
 *  shown as the videos themselves (Geno, 2026-09-27). */
const ROWS: { title: string; note: string; grades: Grade[]; tone: NonNullable<StripItem['badge']>['tone'] }[] = [
  { title: 'Winners', note: 'Repurpose these — refresh them and send them back to post.', grades: ['Viral', 'Winner'], tone: 'win' },
  { title: 'Good', note: 'Did well. Worth another go with one thing changed.', grades: ['Good'], tone: 'good' },
  { title: 'Average', note: 'Around their usual.', grades: ['Average'], tone: 'avg' },
  { title: 'Below average & flops', note: 'Under their usual. A flop is under half — drop that idea.', grades: ['Below avg', 'Flop'], tone: 'low' },
]

/**
 * Their reels, and the editor's work on them — the Review and Editor tabs in
 * one, as swipeable videos rather than lists (Geno: "all this text is
 * overwhelming"). The Sunday call, quality checks and ladder lessons are
 * still here, folded away at the bottom.
 */
export default function ReelsTab({ modelId, name, photo }: { modelId: string; name: string; photo: string | null }) {
  const thisWeek = currentWeekOf()
  const [week, setWeek] = useState(thisWeek)
  const [showDone, setShowDone] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const repurpose = useRepurpose(modelId)

  // Cached reads: the roster warms these on hover, so the rows are drawn, not
  // loaded. A week picked by hand reads on its own first visit, then is kept.
  const reviewLive = useLive<Payload>(`/api/models/${modelId}/review?week=${week}`)
  const queueLive = useLive<EditorQueue>(`/api/models/${modelId}/editor`)
  const checksLive = useLive<{ checks: QualityCheck[] }>(`/api/models/${modelId}/quality`)
  // The studio's own renders — the ♻ results, their own section (2026-10-18).
  const repurposedLive = useLive<RepurposedPayload>(`/api/models/${modelId}/repurpose`)
  const review = reviewLive.data
  const queue = queueLive.data
  const checks = checksLive.data?.checks ?? null
  const loadQueue = queueLive.reload

  const reels = (review?.posts ?? []).filter((post) => post.kind === 'reel')
  const tasks = (queue?.tasks ?? []).filter((task) => showDone || !task.done)
  const media = useReelMedia([...reels.map((p) => p.post_id), ...tasks.map((t) => t.source_post)])
  const who = { name, photo }

  /** One tap closes a whole trial batch — the five cuts render as one card
   *  (Geno, 2026-10-07: the same reel five times read as a bug). */
  async function doneAll(ids: string[], done: boolean) {
    await Promise.all(ids.map((task_id) =>
      fetch(`/api/models/${modelId}/editor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'done', task_id, done }),
      }).catch(() => null)))
    loadQueue()
  }

  async function editor(body: Record<string, unknown>) {
    await fetch(`/api/models/${modelId}/editor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    loadQueue()
  }

  async function scan() {
    setScanning(true)
    const response = await fetch(`/api/models/${modelId}/quality`, { method: 'POST' })
    const body = await response.json().catch(() => ({}))
    if (response.ok) put(`/api/models/${modelId}/quality`, { checks: body.checks ?? [] })
    setScanning(false)
  }

  function reelItem(post: ReviewedPost, tone: NonNullable<StripItem['badge']>['tone'], winner: boolean): StripItem {
    return {
      code: post.post_id,
      badge: { label: post.grade ?? '—', tone },
      sub: post.multiple !== null ? `${post.multiple}× their usual · ${formatDate(post.posted_at.slice(0, 10))}` : formatDate(post.posted_at.slice(0, 10)),
      actions: winner ? (
        <>
          <button type="button" className="dash-reel-action" data-flagged="true"
            onClick={async () => {
              setNotes((n) => ({ ...n, [post.post_id]: 'Adding…' }))
              const said = await repurpose({ post_id: post.post_id })
              setNotes((n) => ({ ...n, [post.post_id]: said }))
              // The queued row belongs in the Repurposed section below now,
              // not after some later refresh.
              repurposedLive.reload()
            }}>
            ♻ Repurpose
          </button>
          {notes[post.post_id] && <p className="dash-reel-status" role="status">{notes[post.post_id]}</p>}
        </>
      ) : undefined,
    }
  }

  return (
    <div className="reels-tab">
      <div className="reels-week">
        <button className="pill" onClick={() => setWeek(addDays(week, -7))}>← Earlier</button>
        <b>{formatDate(week)} – {formatDate(addDays(week, 6))}</b>
        <button className="pill" disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))}>Later →</button>
      </div>

      <SentWeeks modelId={modelId} />

      {!review ? <p className="hint">Loading their reels…</p> : reels.length === 0 ? (
        <p className="hint">Nothing of theirs was swept for this week. Try an earlier one.</p>
      ) : (
        <>
          <p className="reels-summary">
            {review.counts.reels} reels · <b>{review.mix.winners} winners</b> · {review.mix.good} good
          </p>
          {ROWS.map((row) => {
            const inRow = reels.filter((post) => post.grade && row.grades.includes(post.grade))
            if (!inRow.length) return null
            return (
              <section key={row.title} className="reels-row" data-tone={row.tone}>
                <header><h3>{row.title} <span>{inRow.length}</span></h3><p>{row.note}</p></header>
                <VideoStrip who={who} media={media} items={inRow.map((post) => reelItem(post, row.tone, row.tone === 'win'))} />
              </section>
            )
          })}
        </>
      )}

      <RepurposedReels modelId={modelId} data={repurposedLive.data} reload={repurposedLive.reload} />

      <section className="reels-row" data-tone="edit">
        <header>
          <h3>For the editor <span>{(queue?.tasks ?? []).filter((t) => !t.done).length} open</span></h3>
          <p>Re-cuts of their winners — they film nothing for these.</p>
          <button className="chip" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Hide done' : 'Show done'}</button>
        </header>
        {!queue ? <p className="hint">Building the queue…</p> : tasks.length === 0 ? (
          <p className="hint">{queue.tasks.length === 0 ? 'Nothing yet — re-cuts start the week they have a reel past 10× their usual.' : 'All done.'}</p>
        ) : (
          <VideoStrip who={who} media={media} items={groupTrials(tasks).map((task) => {
            const file = task.download ?? media[task.source_post]?.download ?? null
            const ids = task.group_ids ?? [task.id]
            return {
              code: task.source_post,
              badge: { label: task.kind === 'edit' ? 'Edit' : ids.length > 1 ? `Trial · ${ids.length} cuts` : 'Trial', tone: 'edit' },
              sub: ids.length > 1
                ? `Due ${formatDate(task.due_date)} · ${ids.length} different cuts of this winner — one card, ${ids.length} files back`
                : `Due ${formatDate(task.due_date)} · ${task.move}`,
              actions: (
                <div className="reels-actions">
                  {file
                    ? <a className="dash-reel-action" data-flagged="true" href={file}>Get the video</a>
                    : <span className="dash-reel-status" title="The clip lives on the Mac">No file — Mac offline</span>}
                  <button type="button" className="dash-reel-action" onClick={() => void doneAll(ids, !task.done)}>
                    {task.done ? 'Undo' : 'Done ✓'}
                  </button>
                </div>
              ),
            }
          })} />
        )}
        {queue && (
          <div className="reels-stage">
            <span>Trial reels a day</span>
            {[1, 2, 3].map((stage) => (
              <button key={stage} className="chip" data-on={queue.stage === stage} onClick={() => void editor({ action: 'stage', stage })}>
                {stage === 1 ? '5' : stage === 2 ? '10' : '15'}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* The Sunday call block is gone (Geno, 2026-10-07: unnecessary). */}

      <details className="reels-more">
        <summary>Quality check</summary>
        <button className="chip" disabled={scanning} onClick={scan}>{scanning ? 'Checking…' : 'Check their latest reels'}</button>
        {!checks || checks.length === 0 ? <p className="hint">Nothing checked yet.</p> : (
          <ul className="brand-list">
            {checks.map((check) => (
              <li key={check.post_id}>
                <b>{check.verdict}</b>{' '}
                <a href={`https://www.instagram.com/reel/${check.post_id}/`} target="_blank" rel="noreferrer">{check.composite}/10</a>
                <span className="hint"> — {check.notes || 'no fixes needed'}</span>
              </li>
            ))}
          </ul>
        )}
      </details>

      {review && review.attribution.axes.length > 0 && (
        <details className="reels-more">
          <summary>What their ladders have taught</summary>
          <ul className="brand-list">
            {review.attribution.axes.map((axis) => (
              <li key={axis.axis}>{axis.verdict}<span className="hint"> — {axis.batches} batch{axis.batches === 1 ? '' : 'es'}</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** The five trial cuts of one winner fold into a single card; edits stay
 *  individual (each is a different move). Done state is the group's: done
 *  only when every cut is. */
function groupTrials<T extends { id: string; kind: string; source_post: string; done: boolean }>(
  tasks: T[],
): (T & { group_ids?: string[] })[] {
  const out: (T & { group_ids?: string[] })[] = []
  const at = new Map<string, number>()
  for (const task of tasks) {
    if (task.kind !== 'trial') { out.push(task); continue }
    const index = at.get(task.source_post)
    if (index === undefined) {
      at.set(task.source_post, out.length)
      out.push({ ...task, group_ids: [task.id] })
    } else {
      const held = out[index]
      held.group_ids!.push(task.id)
      held.done = held.done && task.done
    }
  }
  return out
}
