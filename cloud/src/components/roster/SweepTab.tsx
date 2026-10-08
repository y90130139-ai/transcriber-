'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatDate } from '@/lib/dates'
import { thumbUrl } from '@/lib/format'
import type { Sweep, SweepCollision, SweepRow } from '@/lib/sweep'
import type { Standing } from '@/lib/standing'
import { useStanding } from './useStanding'
import Avatar from '../dashboard/Avatar'

/**
 * The daily sweep. A scoreboard, two zones, and the housekeeping nobody sees
 * anywhere else — answering the one question the roster never could: is
 * anybody stuck, and is it us or her.
 *
 * The order is deliberate. Our own side comes first, because a week nobody
 * sent is not her fault and every list under it is meaningless until that one
 * is empty. And a list with nothing on it does not get a panel: six "Clear."
 * cards in a row bury the one line that matters, so the clear lists fold into
 * a single quiet strip under the work.
 */

type SweepKey = keyof Pick<Sweep,
  'ourSide' | 'questions' | 'slipped' | 'overdue' | 'neverOpened' | 'openedNoAnswer'>

type SweepList = {
  key: SweepKey
  title: string
  blurb: string
  /** The word the clear strip wears when this list has nothing on it. */
  clear: string
  line: (row: SweepRow) => string
  tone?: 'ours' | 'bad'
}

const LISTS: Record<SweepKey, SweepList> = {
  ourSide: {
    key: 'ourSide',
    title: 'Our side',
    blurb: 'No brief out for this week. Nothing below is their fault yet.',
    clear: 'every week is out',
    tone: 'ours',
    line: (row) =>
      row.plan_id === null
        ? 'No week open at all'
        : row.items === 0
          ? 'Week open, nothing on it'
          : `${row.items} on it, still a draft`,
  },
  questions: {
    key: 'questions',
    title: 'Waiting on an answer',
    blurb: 'They asked something and nobody has read it.',
    clear: 'no unread questions',
    tone: 'ours',
    line: (row) => `${row.unread} unread`,
  },
  slipped: {
    key: 'slipped',
    title: 'Filming slipped',
    blurb: 'A filming day has already gone by this week and nothing is ticked.',
    clear: 'no filming day missed',
    line: (row) => `${row.items} sent · 0 filmed`,
  },
  overdue: {
    key: 'overdue',
    title: 'Overdue',
    blurb: 'Past the due date where they are, with videos still outstanding.',
    clear: 'nothing past due',
    tone: 'bad',
    line: (row) =>
      `${row.filmed}/${row.items} filmed · ${Math.abs(row.days_left ?? 0)} day` +
      `${Math.abs(row.days_left ?? 0) === 1 ? '' : 's'} over`,
  },
  // One list until the plan could tell whether the link had ever been opened.
  // "Sent" and "seen" were the same state, so this said "chase her" to two
  // situations that need opposite things: one is a link that never arrived,
  // the other is a conversation she is not having.
  neverOpened: {
    key: 'neverOpened',
    title: 'Never opened it',
    blurb: 'Sent, never opened. Check it reached them before chasing.',
    clear: 'every link was opened',
    tone: 'ours',
    line: (row) => `sent ${row.days_since_sent} days ago · never opened`,
  },
  openedNoAnswer: {
    key: 'openedNoAnswer',
    title: 'Opened, no answer',
    blurb: 'Seen, nothing said. This one is a conversation.',
    clear: 'everyone who opened it answered',
    line: (row) => `sent ${row.days_since_sent} days ago · opened, nothing back`,
  },
}

/** The page splits the way the scoreboard does: what is ours to move, and
 *  what is theirs. Never interleaved — one of our lists under one of theirs
 *  is how a brief that was never sent starts to read as her fault. */
const ZONES: Record<'ours' | 'theirs', { label: string; blurb: string; keys: SweepKey[] }> = {
  ours: {
    label: 'On us',
    blurb: 'Weeks to send, questions nobody has read, links to check.',
    keys: ['ourSide', 'questions', 'neverOpened'],
  },
  theirs: {
    label: 'On them',
    blurb: 'Sent and waiting on them — an answer, a film, a look.',
    keys: ['slipped', 'overdue', 'openedNoAnswer'],
  },
}

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

function share(part: number, whole: number): number {
  if (whole === 0) return 0
  return Math.round((part / whole) * 100)
}

/** The heat lists: who is on fire, who has gone cold, and the two situations
 *  that only exist once revenue is known. Each row carries its reason. */
type HeatList = {
  key: string
  title: string
  blurb: string
  clear: string
  pick: (standing: Standing) => boolean
  tone?: 'ours'
}

const HEAT_LISTS: HeatList[] = [
  {
    key: 'fire',
    title: '🔥 On fire',
    blurb: 'Cleared their newest week, or scoring high across several. Keep them supplied first.',
    clear: 'nobody yet',
    pick: (standing) => standing.engagement.heat === 'fire',
  },
  {
    key: 'at_risk',
    title: 'At risk — talk to them',
    blurb: 'High revenue, low engagement. More plans will not fix this one; a conversation might.',
    clear: 'nobody yet',
    pick: (standing) => standing.suggestion.situation === 'at_risk',
    tone: 'ours',
  },
  {
    key: 'rising',
    title: 'Rising — invest',
    blurb: 'Proactive but not yet top revenue. The best place to put extra effort to grow.',
    clear: 'nobody yet',
    pick: (standing) => standing.suggestion.situation === 'rising',
  },
  {
    key: 'up',
    title: '▲ Trending up',
    blurb: 'Their score rose 8 or more since their previous sent week. More active than they were.',
    clear: 'nobody yet',
    pick: (standing) => standing.trend?.direction === 'up',
  },
  {
    key: 'down',
    title: '▼ Trending down',
    blurb: 'Their score fell 8 or more since their previous sent week. Worth a look before it turns cold.',
    clear: 'nobody yet',
    pick: (standing) => standing.trend?.direction === 'down',
  },
  {
    key: 'cold',
    title: '🧊 Cold',
    blurb: 'A sent week unopened for 3+ days, or a low score across several. Drafts never count.',
    clear: 'nobody yet',
    pick: (standing) => standing.engagement.heat === 'cold',
  },
]

/** A tick, not an emoji. The clear strip is quiet by design. */
function Tick() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
      <path d="M3 8.5 6.2 11.5 13 4.5" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type ClearItem = { key: string; label: string; note: string }

/** The lists that came back with nothing, as one strip instead of six panels.
 *  Each still names what it checked — a sweep that skips a check silently is
 *  a sweep you stop trusting. */
function Clears({ items }: { items: ClearItem[] }) {
  if (items.length === 0) return null
  return (
    <ul className="sweepchecks">
      {items.map((item) => (
        <li key={item.key} title={item.note}>
          <Tick />
          <b>{item.label}</b>
          <em>{item.note}</em>
        </li>
      ))}
    </ul>
  )
}

/** One list that has something on it. */
function ListCard({
  list, rows, onOpenModel,
}: {
  list: SweepList
  rows: SweepRow[]
  onOpenModel: (id: string) => void
}) {
  return (
    <section className="sweeplist" data-tone={list.tone}>
      <div className="sweephead">
        <h3>{list.title}</h3>
        <span className="tally">{rows.length}</span>
      </div>
      <p className="hint">{list.blurb}</p>
      <ul className="sweeprows">
        {rows.map((row) => (
          <li key={row.id}>
            <button className="sweeprow" onClick={() => onOpenModel(row.id)}>
              <Avatar name={row.name} src={row.photo_url} size={38} />
              <span className="sweeprow-top">
                <span className="sweeprow-name">{row.name}</span>
                <span className="sweeprow-why">{list.line(row)}</span>
              </span>
              <span className="sweeprow-tier">{row.tier}</span>
              {countdown(row.days_left) && (
                <span className="sweeprow-due">{countdown(row.days_left)}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function SweepTab({ onOpenModel }: { onOpenModel: (id: string) => void }) {
  const [sweep, setSweep] = useState<Sweep | null>(null)
  const [loading, setLoading] = useState(true)
  const [showClashes, setShowClashes] = useState(false)
  const { standing } = useStanding()
  // The burner's heartbeat. A dead session does not announce itself — it just
  // stops producing rows — so this reads the newest snapshot instead.
  const [scout, setScout] = useState<{ alive: boolean; hours: number | null; fix: string } | null>(null)
  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/scout/health')
      if (response.ok) setScout(await response.json())
    })()
  }, [])

  const load = useCallback(async () => {
    const response = await fetch('/api/sweep')
    if (response.ok) setSweep(await response.json())
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className="empty"><p>Reading the week…</p></div>
  if (!sweep) return <div className="empty"><p>The sweep did not load. Reload the page.</p></div>

  const byId = new Map(sweep.rows.map((row) => [row.id, row]))
  const rowsFor = (keys: SweepKey[]) =>
    keys.flatMap((key) =>
      sweep[key].map((id) => byId.get(id)).filter((row): row is SweepRow => Boolean(row)))
  const { score, library } = sweep
  const standingReady = Object.keys(standing).length > 0

  // Each heat list with its rows, computed once. The empty ones fall to the
  // clear strip — and only the empty ones, or the strip would claim "nobody
  // yet" about a list that has two people on it right above.
  const heat = HEAT_LISTS.map((list) => ({
    list,
    rows: sweep.rows.filter(
      (row) => row.status === 'active' && standing[row.id] && list.pick(standing[row.id])),
  }))
  const heatLive = heat.filter(({ rows }) => rows.length > 0)
  const heatClear = heat.filter(({ rows }) => rows.length === 0)

  /** One zone: the header, every list with something on it, and one clear
   *  strip for the ones without. */
  function renderZone(zone: { label: string; blurb: string; keys: SweepKey[] }) {
    const active = zone.keys
      .map((key) => ({ list: LISTS[key], rows: rowsFor([key]) }))
      .filter(({ rows }) => rows.length > 0)
    const clears = zone.keys
      .filter((key) => rowsFor([key]).length === 0)
      .map((key) => ({ key, label: LISTS[key].title, note: LISTS[key].clear }))
    const count = active.reduce((total, { rows }) => total + rows.length, 0)
    return (
      <>
        <header className="sweep-zone-head">
          <h2>{zone.label}</h2>
          <span className="tally">{count}</span>
          <p className="hint">{zone.blurb}</p>
        </header>
        {active.map(({ list, rows }) => (
          <ListCard key={list.key} list={list} rows={rows} onOpenModel={onOpenModel} />
        ))}
        <Clears items={clears} />
      </>
    )
  }

  return (
    <>
      {scout && !scout.alive && (
        <p className="hint" data-tone="bad" role="alert">
          The scout session looks dead — nothing read for{' '}
          {scout.hours === null ? 'as long as there is a record' : `${Math.round(scout.hours)} hours`}.
          {' '}{scout.fix}
        </p>
      )}
      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title">Today</h2>
          <p className="dash-sub">Week of {formatDate(sweep.weekOf)}</p>
        </div>
      </header>

      {/* Supply and delivery, always together. A board that showed only what
          she did would blame her for a brief that was never sent. */}
      <div className="score">
        <div className="score-cell" data-side="ours">
          <span className="axis-name">Sent on time · us</span>
          <b>{percent(score.sentOnTime, score.sent)}</b>
          <div className="score-meter" aria-hidden><i style={{ width: `${share(score.sentOnTime, score.sent)}%` }} /></div>
          <span className="score-of">{score.sentOnTime} of {score.sent} weeks</span>
        </div>
        <div className="score-cell">
          <span className="axis-name">Accepted · them</span>
          <b>{percent(score.accepted, score.items)}</b>
          <div className="score-meter" aria-hidden><i style={{ width: `${share(score.accepted, score.items)}%` }} /></div>
          <span className="score-of">
            {score.accepted} of {score.items}
            {score.declined > 0 && ` · ${score.declined} turned down`}
          </span>
        </div>
        <div className="score-cell">
          <span className="axis-name">Filmed · them</span>
          <b>{percent(score.filmed, score.items)}</b>
          <div className="score-meter" aria-hidden><i style={{ width: `${share(score.filmed, score.items)}%` }} /></div>
          <span className="score-of">{score.filmed} of {score.items}</span>
        </div>
        <div className="score-cell">
          <span className="axis-name">Posted · them</span>
          <b>{percent(score.posted, score.items)}</b>
          <div className="score-meter" aria-hidden><i style={{ width: `${share(score.posted, score.items)}%` }} /></div>
          <span className="score-of">{score.posted} of {score.items}</span>
        </div>
        <p className="score-foot">
          Across the last {score.weeks} sent weeks. On time = in their hands
          before the week starts.
        </p>
      </div>

      {/* The work, split the way the scoreboard splits it. Ours first, and it
          is the main column because on a bad day it is the long one; theirs,
          standing and housekeeping stack in the rail beside it. */}
      <div className="sweep-board">
        <section className="sweep-zone" data-zone="ours">
          {renderZone(ZONES.ours)}
        </section>

        <div className="sweep-rail">
          <section className="sweep-zone" data-zone="theirs">
            {renderZone(ZONES.theirs)}
          </section>

          {/* Heat comes after every list above, not before: our own side is
              first, and a board that led with who is cold would blame her for
              weeks we never sent. */}
          <section className="sweep-stand" aria-label="Standing">
            <header className="sweep-zone-head">
              <h2>Standing</h2>
              <p className="hint">Who is on fire, who has gone cold — and where extra effort pays.</p>
            </header>
            {!standingReady ? (
              <p className="hint">Reading standings…</p>
            ) : (
              <>
                <div className="sweep-heat">
                  {heatLive.map(({ list, rows }) => (
                    <section className="sweeplist" data-tone={list.tone} key={list.key}>
                      <div className="sweephead">
                        <h3>{list.title}</h3>
                        <span className="tally">{rows.length}</span>
                      </div>
                      <p className="hint">{list.blurb}</p>
                      <ul className="sweeprows">
                        {rows.map((row) => (
                          <li key={row.id}>
                            <button className="sweeprow" onClick={() => onOpenModel(row.id)}>
                              <Avatar name={row.name} src={row.photo_url} size={38} />
                              <span className="sweeprow-top">
                                <span className="sweeprow-name">{row.name}</span>
                                <span className="sweeprow-why">{standing[row.id]?.engagement.why}</span>
                              </span>
                              <span className="sweeprow-tier">{standing[row.id]?.priority ?? '–'}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
                <Clears items={heatClear.map(({ list }) => ({
                  key: list.key,
                  label: list.title,
                  note: list.clear,
                }))} />
              </>
            )}
          </section>

          <div className="sweep-house">
            {/* Not about one model — about two of them holding the same reel. The
                exclusion in match.ts is per model, so nothing else in the console
                can see this at all. Named, not prevented: two creators on one trend
                is sometimes the point. Folded, because it is a record rather than
                a task, and forty reels of it buried everything under it. */}
            <section className="sweeplist sweep-fold" data-open={showClashes}>
              <button type="button" className="sweephead sweep-fold-head"
                onClick={() => setShowClashes((open) => !open)} aria-expanded={showClashes}>
                <h3>On more than one week</h3>
                <span className="tally">{sweep.collisions.length}</span>
                <span className="sweep-fold-cue" aria-hidden>{showClashes ? 'Hide' : 'Show'}</span>
              </button>
              <p className="hint">One reel, two active weeks. Kept so it stays deliberate.</p>
              {sweep.collisions.length === 0 ? (
                <p className="sweepclear">Clear.</p>
              ) : showClashes && (
                <ul className="clashes">
                  {sweep.collisions.map((clash: SweepCollision) => (
                    <li className="clash" key={clash.job_id}>
                      <Avatar name={clash.author ?? 'Reel'} src={thumbUrl(clash.job_id)} size={36} />
                      <span className="clash-top">
                        <span className="clash-name">{clash.author ?? clash.job_id}</span>
                        <span className="clash-why">{clash.names}</span>
                      </span>
                      <span className="sweeprow-tier" title={`On ${clash.models} active weeks`}>
                        {clash.models}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Not about anybody. Whether there is still anything to build next
                week out of, which is the sixth way a week quietly fails. */}
            <section className="sweeplist">
              <div className="sweephead">
                <h3>Library health</h3>
                <span className="tally">{library.held}</span>
              </div>
              <p className="hint">What is held, what never reaches a week, and why a suggestion can come back empty.</p>
              <ul className="healthstats">
                <li><b>{library.unused}</b><span>held and never put on a plan</span></li>
                <li><b>{library.untagged}</b><span>no format tag — these match nobody</span></li>
                <li><b>{library.failed}</b><span>failed on the way in</span></li>
                <li><b>{library.unprofiled}</b><span>active models with no formats ticked</span></li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
