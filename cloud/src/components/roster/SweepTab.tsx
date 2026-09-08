'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatDate } from '@/lib/dates'
import type { Sweep, SweepRow } from '@/lib/sweep'

/**
 * The daily sweep. Six lists and a scoreboard, answering the one question the
 * roster never could: is anybody stuck, and is it us or her.
 *
 * The order is deliberate. Our own side is first, because a week nobody sent is
 * not her fault and every list under it is meaningless until that one is empty.
 */
const LISTS: { key: keyof Pick<Sweep,
  'ourSide' | 'questions' | 'slipped' | 'overdue' | 'neverOpened' | 'openedNoAnswer'>
  title: string
  blurb: string
  line: (row: SweepRow) => string
  tone?: 'ours' | 'bad'
}[] = [
  {
    key: 'ourSide',
    title: 'Our side',
    blurb: 'No brief has gone out for this week. Nothing below is her fault until this list is empty.',
    tone: 'ours',
    line: (row) =>
      row.plan_id === null
        ? 'No week open at all'
        : row.items === 0
          ? 'Week open, nothing on it'
          : `${row.items} on it, still a draft`,
  },
  {
    key: 'questions',
    title: 'Waiting on an answer',
    blurb: 'She asked something and nobody has read it.',
    tone: 'ours',
    line: (row) => `${row.unread} unread`,
  },
  {
    key: 'slipped',
    title: 'Filming slipped',
    blurb: 'A filming day has already gone by this week and nothing is ticked.',
    line: (row) => `${row.items} sent · 0 filmed`,
  },
  {
    key: 'overdue',
    title: 'Overdue',
    blurb: 'Past the due date where she is, with videos still outstanding.',
    tone: 'bad',
    line: (row) =>
      `${row.filmed}/${row.items} filmed · ${Math.abs(row.days_left ?? 0)} day` +
      `${Math.abs(row.days_left ?? 0) === 1 ? '' : 's'} over`,
  },
  // One list until the plan could tell whether the link had ever been opened.
  // "Sent" and "seen" were the same state, so this said "chase her" to two
  // situations that need opposite things: one is a link that never arrived,
  // the other is a conversation she is not having.
  {
    key: 'neverOpened',
    title: 'Never opened it',
    blurb: 'Sent, and the link has never been opened. Check it reached her before chasing the work.',
    tone: 'ours',
    line: (row) => `sent ${row.days_since_sent} days ago · never opened`,
  },
  {
    key: 'openedNoAnswer',
    title: 'Opened, no answer',
    blurb: 'She has seen the week and said nothing about it. This one is a conversation.',
    line: (row) => `sent ${row.days_since_sent} days ago · opened, nothing back`,
  },
]

/** `2 days left`, `due today`, `3 days over` — the same fact three ways round,
 *  because "due 6 September" makes you count and this does not. */
export function countdown(daysLeft: number | null): string | null {
  if (daysLeft === null) return null
  if (daysLeft === 0) return 'due today'
  if (daysLeft > 0) return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
  const over = Math.abs(daysLeft)
  return `${over} day${over === 1 ? '' : 's'} over`
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '—'
  return `${Math.round((part / whole) * 100)}%`
}

export default function SweepTab({ onOpenModel }: { onOpenModel: (id: string) => void }) {
  const [sweep, setSweep] = useState<Sweep | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const response = await fetch('/api/sweep')
    if (response.ok) setSweep(await response.json())
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className="empty"><p>Reading the week…</p></div>
  if (!sweep) return <div className="empty"><p>The sweep did not load. Reload the page.</p></div>

  const byId = new Map(sweep.rows.map((row) => [row.id, row]))
  const rowsFor = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((row): row is SweepRow => Boolean(row))
  const { score, library } = sweep

  return (
    <>
      <div className="section-head">
        <h2>Today</h2>
        <span className="tally" style={{ color: 'var(--sc-ink-300)' }}>
          Week of {formatDate(sweep.weekOf)}
        </span>
      </div>

      {/* Supply and delivery, always together. A board that showed only what
          she did would blame her for a brief that was never sent. */}
      <div className="score">
        <div className="score-cell" data-side="ours">
          <span className="axis-name">Sent on time · us</span>
          <b>{percent(score.sentOnTime, score.sent)}</b>
          <span className="score-of">{score.sentOnTime} of {score.sent} weeks</span>
        </div>
        <div className="score-cell">
          <span className="axis-name">Accepted · her</span>
          <b>{percent(score.accepted, score.items)}</b>
          <span className="score-of">
            {score.accepted} of {score.items}
            {score.declined > 0 && ` · ${score.declined} turned down`}
          </span>
        </div>
        <div className="score-cell">
          <span className="axis-name">Filmed · her</span>
          <b>{percent(score.filmed, score.items)}</b>
          <span className="score-of">{score.filmed} of {score.items}</span>
        </div>
        <div className="score-cell">
          <span className="axis-name">Posted · her</span>
          <b>{percent(score.posted, score.items)}</b>
          <span className="score-of">{score.posted} of {score.items}</span>
        </div>
        <p className="score-foot">
          Across the last {score.weeks} weeks of sent plans. A week counts as on
          time when the brief was in her hands before the week it is for started.
        </p>
      </div>

      {LISTS.map((list) => {
        const rows = rowsFor(sweep[list.key])
        return (
          <section className="sweeplist" key={list.key} data-tone={list.tone}>
            <div className="sweephead">
              <h3>{list.title}</h3>
              <span className="tally">{rows.length}</span>
            </div>
            <p className="hint">{list.blurb}</p>
            {rows.length === 0 ? (
              <p className="sweepclear">Clear.</p>
            ) : (
              <ul className="sweeprows">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button className="sweeprow" onClick={() => onOpenModel(row.id)}>
                      <span className="sweeprow-tier">{row.tier}</span>
                      <span className="sweeprow-name">{row.name}</span>
                      <span className="sweeprow-why">{list.line(row)}</span>
                      {countdown(row.days_left) && (
                        <span className="sweeprow-due">{countdown(row.days_left)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {/* Not about one model — about two of them holding the same reel. The
          exclusion in match.ts is per model, so nothing else in the console
          can see this at all. Named, not prevented: two creators on one trend
          is sometimes the point. */}
      <section className="sweeplist">
        <div className="sweephead">
          <h3>On more than one week</h3>
          <span className="tally">{sweep.collisions.length}</span>
        </div>
        <p className="hint">
          The same reel is on two active models&rsquo; weeks. Deliberate is fine —
          this is here so it is deliberate.
        </p>
        {sweep.collisions.length === 0 ? (
          <p className="sweepclear">Clear.</p>
        ) : (
          <ul className="sweeprows">
            {sweep.collisions.map((clash) => (
              <li key={clash.job_id}>
                <span className="sweeprow" role="note">
                  <span className="sweeprow-tier">{clash.models}</span>
                  <span className="sweeprow-name">{clash.author ?? clash.job_id}</span>
                  <span className="sweeprow-why">{clash.names}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Not about anybody. Whether there is still anything to build next week
          out of, which is the sixth way a week quietly fails. */}
      <section className="sweeplist">
        <div className="sweephead">
          <h3>Library health</h3>
          <span className="tally">{library.held}</span>
        </div>
        <ul className="healthrows">
          <li><b>{library.unused}</b> held and never put on a plan</li>
          <li><b>{library.untagged}</b> with no format tag — these match nobody</li>
          <li><b>{library.failed}</b> failed on the way in</li>
          <li>
            <b>{library.unprofiled}</b> active models with no formats ticked —
            their suggestions come back empty for that reason, not because the
            library is dry
          </li>
        </ul>
      </section>
    </>
  )
}
