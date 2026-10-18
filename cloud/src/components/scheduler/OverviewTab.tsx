'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import type { ApAccount, ApPost } from '@/lib/autoposter'
import BarChart from '../dashboard/BarChart'
import MicroBars from '../dashboard/MicroBars'
import Sparkline from '../dashboard/Sparkline'
import { compact, percent } from '../dashboard/format'
import DropSelect from '../dashboard/DropSelect'
import { addDaysIso, todayIsoLocal } from './schedule-dates'
import { Mark, statusLabel, workspaceLabel } from './marks'

/**
 * The Scheduler's overview (Geno, 2026-10-14): the workspace at a glance,
 * laid out the way the marketing Overview is — headline stats on top, the
 * volume graph beside what's up next, then the platform split and what
 * needs a yes. Everything reads from the same posts the calendar shows;
 * Autoposter exposes no analytics endpoint, so every number here is queue
 * truth: scheduled, published, drafted, failed.
 */

const BACK = 30
const FWD = 30

function isScheduled(post: ApPost): boolean {
  return post.status === 'scheduled' || post.status === 'queued'
}

function isPublished(post: ApPost): boolean {
  return post.status === 'published' || post.status === 'posted'
}

export default function OverviewTab({ configured, workspace, workspaces, initial }: {
  configured: boolean
  workspace: string | null
  workspaces: { id: string; accounts: number }[]
  initial: { posts: ApPost[]; accounts: ApAccount[]; mediaCount: number }
}) {
  const router = useRouter()
  const { posts, accounts, mediaCount } = initial
  const today = useMemo(() => todayIsoLocal(), [])

  const past = useMemo(() => {
    const days: string[] = []
    for (let n = BACK - 1; n >= 0; n -= 1) days.push(addDaysIso(today, -n))
    return days
  }, [today])
  const future = useMemo(() => {
    const days: string[] = []
    for (let n = 0; n < FWD; n += 1) days.push(addDaysIso(today, n))
    return days
  }, [today])

  const publishedByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const post of posts) {
      if (!post.date || post.date > today || !isPublished(post)) continue
      map.set(post.date, (map.get(post.date) ?? 0) + 1)
    }
    return map
  }, [posts, today])

  const scheduledByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const post of posts) {
      if (!post.date || post.date < today || !isScheduled(post)) continue
      map.set(post.date, (map.get(post.date) ?? 0) + 1)
    }
    return map
  }, [posts, today])

  const publishedPast = past.reduce((sum, day) => sum + (publishedByDay.get(day) ?? 0), 0)
  const publishedPrev = posts.filter(
    (post) => post.date && post.date < addDaysIso(today, -(BACK - 1)) && isPublished(post),
  ).length
  const scheduledNext = future.reduce((sum, day) => sum + (scheduledByDay.get(day) ?? 0), 0)

  const drafts = posts.filter((post) => post.status === 'draft')
  const awaiting = posts.filter((post) => post.status.includes('approv'))
  const failed = posts.filter((post) => post.status === 'failed' || post.status === 'error')

  const series = useMemo(
    () =>
      [...past.slice(1), ...future].map((day) => ({
        day,
        value: day <= today ? (publishedByDay.get(day) ?? 0) : (scheduledByDay.get(day) ?? 0),
      })),
    [past, future, today, publishedByDay, scheduledByDay],
  )

  const perPlatform = useMemo(() => {
    const byPlatform = new Map<string, { scheduled: number; published: number; days: Map<string, number> }>()
    const accountPlatform = new Map<number, string>()
    for (const account of accounts) accountPlatform.set(account.id, account.platform)
    for (const post of posts) {
      if (!post.date) continue
      const inPast = post.date <= today && isPublished(post)
      const inFuture = post.date >= today && isScheduled(post)
      if (!inPast && !inFuture) continue
      const platforms = new Set(
        post.accountIds.map((id) => accountPlatform.get(id)).filter((platform): platform is string => Boolean(platform)),
      )
      if (platforms.size === 0) platforms.add('other')
      for (const platform of platforms) {
        const entry = byPlatform.get(platform) ?? { scheduled: 0, published: 0, days: new Map<string, number>() }
        if (inPast) entry.published += 1
        if (inFuture) entry.scheduled += 1
        entry.days.set(post.date, (entry.days.get(post.date) ?? 0) + 1)
        byPlatform.set(platform, entry)
      }
    }
    return [...byPlatform.entries()]
      .map(([platform, entry]) => ({ platform, ...entry }))
      .sort((a, b) => b.scheduled + b.published - (a.scheduled + a.published))
  }, [posts, accounts, today])

  const upNext = useMemo(
    () =>
      posts
        .filter((post) => post.date && post.date >= today && isScheduled(post))
        .sort((a, b) => `${a.date} ${a.time ?? '99:99'}`.localeCompare(`${b.date} ${b.time ?? '99:99'}`))
        .slice(0, 5),
    [posts, today],
  )

  const attention = useMemo(
    () =>
      [...failed, ...awaiting, ...drafts]
        .sort((a, b) => `${a.date ?? '9999'} ${a.time ?? ''}`.localeCompare(`${b.date ?? '9999'} ${b.time ?? ''}`))
        .slice(0, 8),
    [failed, awaiting, drafts],
  )

  const accountById = useMemo(() => {
    const map = new Map<number, ApAccount>()
    for (const account of accounts) map.set(account.id, account)
    return map
  }, [accounts])

  const platformsCovered = useMemo(() => {
    const seen = new Set(accounts.map((account) => account.platform))
    return [...seen].slice(0, 3).join(' · ') || '—'
  }, [accounts])

  const calendarHref = `/scheduler${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`

  return (
    <div className="dash sc-tab">
      <header className="dash-head">
        <div>
          <p className="dash-kicker">Scheduler</p>
          <h2 className="dash-title">Overview</h2>
          <p className="dash-sub">
            The queue at a glance{workspace ? ` · ${workspaceLabel(workspace)}` : ''} — published behind, scheduled ahead.
          </p>
        </div>
        <div className="dash-head-tools">
          {workspaces.length > 1 ? (
            <DropSelect
              label="Workspace"
              value={workspace ?? ''}
              onChange={(next) => router.push(`/scheduler/overview?workspace=${encodeURIComponent(next)}`)}
              options={workspaces.map((one) => ({ value: one.id, label: `${workspaceLabel(one.id)} · ${one.accounts}` }))}
            />
          ) : null}
          <Link className="btn btn-small" href={calendarHref}>Calendar</Link>
        </div>
      </header>

      {!configured ? (
        <section className="dash-panel">
          <p className="hint" data-tone="bad" role="alert">
            The scheduler is not connected yet — add <code>AUTOPOSTER_TOKEN</code> and{' '}
            <code>AUTOPOSTER_WORKSPACE</code> to the environment, then reload.
          </p>
        </section>
      ) : (
        <>
          <section className="dash-stats" aria-label="Totals">
            <article className="dash-stat dash-stat-lead">
              <h3>Scheduled · next {FWD}d</h3>
              <p className="dash-stat-value">{compact(scheduledNext)}</p>
              <p className="dash-stat-note">{drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'} waiting</p>
              <Sparkline
                values={future.map((day) => scheduledByDay.get(day) ?? 0)}
                width={520}
                height={90}
                area
                format={(v, i) => `${future[i] ?? ''} · ${v} scheduled`}
              />
            </article>
            <article className="dash-stat">
              <h3>Published · {BACK}d</h3>
              <p className="dash-stat-value">{compact(publishedPast)}</p>
              <MicroBars values={past.map((day) => publishedByDay.get(day) ?? 0)} tone="amber" />
              {publishedPrev > 0 && (
                <p className="dash-pill" data-tone={publishedPast >= publishedPrev ? 'up' : 'down'}>
                  {percent((publishedPast - publishedPrev) / publishedPrev)}
                </p>
              )}
            </article>
            <article className="dash-stat">
              <h3>Accounts</h3>
              <p className="dash-stat-value">{accounts.length}</p>
              <p className="dash-stat-note">{platformsCovered}</p>
            </article>
            <article className="dash-stat">
              <h3>Drafts</h3>
              <p className="dash-stat-value">{drafts.length}</p>
              <p className="dash-stat-note">
                {awaiting.length === 0 ? 'nothing awaiting approval' : `${awaiting.length} awaiting approval`}
              </p>
              {drafts.length > 0 && (
                <Link className="dash-stat-link" href={calendarHref}>Review →</Link>
              )}
            </article>
            <article className="dash-stat">
              <h3>Media</h3>
              <p className="dash-stat-value">{compact(mediaCount)}</p>
              <p className="dash-stat-note">in the library</p>
            </article>
          </section>

          <div className="dash-grid-main">
            <section className="dash-panel" aria-labelledby="sc-volume-h">
              <header className="dash-panel-head">
                <h2 id="sc-volume-h">Posts per day</h2>
                <p>Published behind, scheduled ahead</p>
              </header>
              <BarChart
                series={series}
                label="Posts per day"
                emptyNote="Nothing published behind and nothing scheduled ahead — the queue is empty."
              />
            </section>

            <section className="dash-panel" aria-labelledby="sc-next-h">
              <header className="dash-panel-head">
                <h2 id="sc-next-h">Up next</h2>
                <p>The next five out the door</p>
              </header>
              {upNext.length === 0 ? (
                <p className="dash-empty">Nothing scheduled — the calendar is clear.</p>
              ) : (
                <div className="sc-ov-list">
                  {upNext.map((post) => (
                    <div className="sc-ov-row" key={post.id}>
                      <span className="sc-time">{post.time ?? post.date}</span>
                      <span className="sc-ov-body">{post.body || post.title || '(no caption)'}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="dash-foot"><Link className="dash-link" href={calendarHref}>Open the calendar →</Link></p>
            </section>
          </div>

          <section className="dash-panel" aria-labelledby="sc-platforms-h">
            <header className="dash-panel-head dash-panel-head-flush">
              <h2 id="sc-platforms-h">By platform</h2>
              <p>Scheduled ahead and published behind, per network</p>
            </header>
            {perPlatform.length === 0 ? (
              <p className="dash-empty">No platform traffic in this window.</p>
            ) : (
              <div className="sc-devices">
                {perPlatform.map((entry) => (
                  <div className="sc-device" key={entry.platform}>
                    <Mark platform={entry.platform} name={entry.platform} size={15} />
                    <span className="sc-device-copy">
                      <span className="sc-device-name">{entry.platform}</span>
                      <span className="sc-device-meta">
                        {entry.scheduled} scheduled · {entry.published} published
                      </span>
                    </span>
                    <span className="sc-ov-bars">
                      <MicroBars values={[...past.slice(1), ...future].map((day) => entry.days.get(day) ?? 0)} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="dash-panel" aria-labelledby="sc-attention-h">
            <header className="dash-panel-head dash-panel-head-flush">
              <h2 id="sc-attention-h">Needs attention</h2>
              <p>Failed, awaiting approval, then drafts — act on the calendar</p>
            </header>
            {attention.length === 0 ? (
              <p className="dash-empty">Nothing waiting — every post is scheduled or out.</p>
            ) : (
              <div className="sc-ov-list">
                {attention.map((post) => (
                  <div className="sc-ov-row" key={post.id}>
                    <span className="sc-dot" style={{
                      background: post.status === 'failed' || post.status === 'error' ? 'var(--sc-critical)' : 'var(--sc-ember)',
                    }} aria-hidden />
                    <span className="sc-ov-body">{post.body || post.title || '(no caption)'}</span>
                    <span className="sc-status">{statusLabel(post.status)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="dash-foot"><Link className="dash-link" href={calendarHref}>Open the calendar →</Link></p>
          </section>
        </>
      )}
    </div>
  )
}
