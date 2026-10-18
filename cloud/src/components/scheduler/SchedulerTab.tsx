'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApAccountScoped, ApPost, PostKind } from '@/lib/autoposter'
import DropSelect, { type MenuOption } from '../dashboard/DropSelect'
import {
  WEEKDAYS_SUN,
  addDaysIso,
  addMonthsIso,
  dayNumber,
  inMonth,
  localTimezone,
  mondayOf,
  monthCells,
  monthStart,
  niceDay,
  niceMonth,
  niceRange,
  sundayOf,
  todayIsoLocal,
  weekDates,
} from './schedule-dates'
import { Mark, statusLabel, workspaceLabel } from './marks'

/**
 * Unified calendar (Geno, 2026-10-15): every Autoposter workspace on one
 * ContentStudio-style month grid. Filters live in the toolbar — Posts/Stories
 * and Reels/Videos as two buttons, accounts as a dropdown — and the grid is
 * full-bleed edge to edge.
 */

type ViewMode = 'day' | 'week' | 'month'

const FEED_KINDS: PostKind[] = ['post', 'story']
const CLIP_KINDS: PostKind[] = ['reel', 'video']

const MONTH_PREVIEW = 3

function statusTone(status: string): string {
  const lower = status.toLowerCase()
  if (lower === 'published' || lower === 'posted') return 'var(--sc-positive)'
  if (lower === 'failed' || lower === 'error') return 'var(--sc-critical)'
  if (lower === 'draft') return 'var(--sc-ink-150)'
  return 'var(--sc-ember)'
}

function atOf(post: ApPost): string {
  if (post.date && post.time) return `${post.date} ${post.time}`
  if (post.date) return post.date
  return 'Unscheduled'
}

function platformOf(post: ApPost, accountByKey: Map<string, ApAccountScoped>): string {
  if (post.platforms[0]) return post.platforms[0]
  for (const id of post.accountIds) {
    const account = accountByKey.get(`${post.workspaceId}:${id}`)
    if (account) return account.platform
  }
  return 'other'
}

function accountKey(workspaceId: string, accountId: number): string {
  return `${workspaceId}:${accountId}`
}

function rangeFor(view: ViewMode, anchor: string): { from: string; to: string } {
  if (view === 'day') return { from: anchor, to: anchor }
  if (view === 'week') {
    const start = sundayOf(new Date(`${anchor}T12:00:00Z`))
    return { from: start, to: addDaysIso(start, 6) }
  }
  const cells = monthCells(anchor)
  return { from: cells[0], to: cells[cells.length - 1] }
}

export type SchedulerSnapshot = { posts: ApPost[]; accounts: ApAccountScoped[] }
export type SchedulerWorkspace = { id: string; accounts: number }
export type SchedulerCoverage = {
  loaded: number
  failed: string[]
  total: number
  errors?: { workspaceId: string; message: string; status: number | null }[]
}

export default function SchedulerTab({
  configured,
  workspaces: workspaceMeta,
  initial,
  anchor: initialAnchor,
  today: todayProp,
  coverage: initialCoverage,
  loadFailed = false,
}: {
  configured: boolean
  workspaces: SchedulerWorkspace[]
  initial: SchedulerSnapshot
  /** YYYY-MM-DD inside the month the page opened on. */
  anchor: string
  /** Server-stamped "today" so the highlight matches first paint. */
  today: string
  coverage: SchedulerCoverage
  loadFailed?: boolean
}) {
  const [posts, setPosts] = useState<ApPost[]>(initial.posts)
  const [accounts, setAccounts] = useState<ApAccountScoped[]>(initial.accounts)
  const [view, setView] = useState<ViewMode>('month')
  const [anchor, setAnchor] = useState(initialAnchor)
  /** Posts + Stories button — off with clips also off means show everything. */
  const [feedOn, setFeedOn] = useState(false)
  /** Reels + Videos button. */
  const [clipsOn, setClipsOn] = useState(false)
  /** `all` or `${workspaceId}:${accountId}`. */
  const [accountPick, setAccountPick] = useState('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(configured && initialCoverage.total > 0)
  const [syncing, setSyncing] = useState(false)
  const [failed, setFailed] = useState(loadFailed)
  const [coverage, setCoverage] = useState<SchedulerCoverage>(initialCoverage)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [timezone, setTimezone] = useState('UTC')
  const [today, setToday] = useState(todayProp)
  const armTimer = useRef<number | null>(null)
  const bootstrapped = useRef(false)

  useEffect(() => {
    setTimezone(localTimezone())
    setToday(todayIsoLocal())
  }, [])

  /** Kick a due sweep off; true when it actually refreshed workspaces, so
   *  the caller knows a re-read will show more than the snapshot already did. */
  const refreshSnapshot = useCallback(async (): Promise<boolean> => {
    setSyncing(true)
    try {
      const response = await fetch('/api/scheduler/sync', { method: 'POST' }).catch(() => null)
      if (!response) {
        setLoadError('Could not start the scheduler sync. Check your connection and retry.')
        return false
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        setLoadError(body.error ?? `Scheduler sync returned an error (${response.status}).`)
        return false
      }
      const body = await response.json().catch(() => ({})) as { synced?: number }
      return typeof body.synced !== 'number' || body.synced > 0
    } finally {
      setSyncing(false)
    }
  }, [])

  const loadEverything = useCallback(async (nextView: ViewMode, nextAnchor: string) => {
    const { from, to } = rangeFor(nextView, nextAnchor)
    const query = new URLSearchParams({ from, to })
    const response = await fetch(`/api/scheduler/calendar?${query}`).catch(() => null)
    if (!response) {
      setLoadError('Could not reach the scheduler service. Check your connection and retry.')
      return false
    }

    const body = await response.json().catch(() => ({})) as {
      error?: string
      posts?: ApPost[]
      accounts?: ApAccountScoped[]
      loaded?: number
      failed?: string[]
      total?: number
      errors?: { workspaceId: string; message: string; status: number | null }[]
    }
    if (!response.ok) {
      setLoadError(body.error ?? `The scheduler returned an error (${response.status}).`)
      return false
    }

    setPosts(Array.isArray(body.posts) ? body.posts : [])
    if (Array.isArray(body.accounts)) setAccounts(body.accounts)

    const failedIds = Array.isArray(body.failed) ? body.failed : []
    const errors = Array.isArray(body.errors) ? body.errors : []
    const total = typeof body.total === 'number' ? body.total : workspaceMeta.length
    const loaded = typeof body.loaded === 'number' ? body.loaded : Math.max(0, total - failedIds.length)
    setCoverage({ loaded, failed: failedIds, total, errors })
    setLoadError(
      loaded === 0 && failedIds.length > 0
        ? errors[0]?.message ?? body.error ?? 'Autoposter did not return any workspaces.'
        : null,
    )
    // Partial results are still a usable calendar. Show a warning and a
    // workspace-level retry in the toolbar instead of blanking the whole view.
    return failedIds.length === 0 || loaded > 0
  }, [workspaceMeta.length])

  async function navigate(nextAnchor: string) {
    setAnchor(nextAnchor)
    setSelectedKey(null)
    setArmed(false)
    setLoading(true)
    setLoadError(null)
    const ok = await loadEverything(view, nextAnchor)
    setFailed(!ok)
    setLoading(false)
  }

  async function switchView(next: ViewMode) {
    if (next === view) return
    setView(next)
    setSelectedKey(null)
    setArmed(false)
    let nextAnchor = anchor
    if (next === 'month') nextAnchor = monthStart(anchor)
    else if (next === 'week') nextAnchor = sundayOf(new Date(`${anchor}T12:00:00Z`))
    setAnchor(nextAnchor)
    setLoading(true)
    setLoadError(null)
    const ok = await loadEverything(next, nextAnchor)
    setFailed(!ok)
    setLoading(false)
  }

  function goToday() {
    const today = todayIsoLocal()
    const next =
      view === 'month' ? monthStart(today) : view === 'week' ? sundayOf(new Date(`${today}T12:00:00Z`)) : today
    void navigate(next)
  }

  function step(direction: -1 | 1) {
    if (view === 'month') void navigate(addMonthsIso(anchor, direction))
    else if (view === 'week') void navigate(addDaysIso(anchor, direction * 7))
    else void navigate(addDaysIso(anchor, direction))
  }

  async function retry() {
    setFailed(false)
    setLoading(true)
    setLoadError(null)
    const ok = await loadEverything(view, anchor)
    setFailed(!ok)
    setLoading(false)
    // Retry is a re-read plus a sweep behind it: never hold the calendar on
    // the sync, only repaint if it actually brought something new (2026-10-16).
    if (await refreshSnapshot()) {
      const again = await loadEverything(view, anchor)
      setFailed(!again)
    }
  }

  // The stored snapshot paints first; the due sync sweeps in behind it and
  // only a sweep that refreshed something re-reads the calendar (Geno,
  // 2026-10-16 — awaiting the sync here used to stall the page for minutes
  // while Autoposter's 1.1s-per-request gate walked a pass).
  useEffect(() => {
    if (!configured || bootstrapped.current) return
    bootstrapped.current = true
    let cancelled = false
    async function pull(attempt: number) {
      setLoading(true)
      const ok = await loadEverything(view, anchor)
      if (cancelled) return
      setFailed(!ok)
      setLoading(false)
      if (!ok && attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 8000 * (attempt + 1)))
        if (!cancelled) await pull(attempt + 1)
      }
    }
    async function sweep() {
      if (cancelled || !(await refreshSnapshot())) return
      if (cancelled) return
      const ok = await loadEverything(view, anchor)
      if (!cancelled) setFailed(!ok)
    }
    void pull(0)
    void sweep()
    return () => { cancelled = true }
  }, [configured, loadEverything, refreshSnapshot, view, anchor])

  useEffect(() => {
    if (!configured) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadEverything(view, anchor)
        .then((ok) => setFailed(!ok))
        .catch(() => {
          setLoadError('Could not read the calendar. Check your connection and retry.')
          setFailed(true)
        })
    }, 90_000)
    return () => window.clearInterval(timer)
  }, [configured, view, anchor, loadEverything])

  useEffect(() => () => {
    if (armTimer.current) window.clearTimeout(armTimer.current)
  }, [])

  const accountByKey = useMemo(() => {
    const map = new Map<string, ApAccountScoped>()
    for (const account of accounts) map.set(accountKey(account.workspaceId, account.id), account)
    return map
  }, [accounts])

  const accountOptions = useMemo((): MenuOption[] => {
    const options: MenuOption[] = [{ value: 'all', label: 'All accounts' }]
    const sorted = [...accounts].sort((a, b) => {
      const byWs = a.workspaceId.localeCompare(b.workspaceId)
      if (byWs) return byWs
      return a.name.localeCompare(b.name)
    })
    for (const account of sorted) {
      options.push({
        value: accountKey(account.workspaceId, account.id),
        label: account.name,
        group: workspaceLabel(account.workspaceId),
      })
    }
    return options
  }, [accounts])

  const activeKinds = useMemo(() => {
    if (!feedOn && !clipsOn) return null
    const list: PostKind[] = []
    if (feedOn) list.push(...FEED_KINDS)
    if (clipsOn) list.push(...CLIP_KINDS)
    return list
  }, [feedOn, clipsOn])

  const shown = useMemo(() => {
    return posts.filter((post) => {
      if (activeKinds && !activeKinds.includes(post.kind)) return false
      if (accountPick !== 'all') {
        const hit = post.accountIds.some((id) => accountKey(post.workspaceId, id) === accountPick)
        if (!hit) return false
      }
      return true
    })
  }, [posts, activeKinds, accountPick])

  const byDay = useMemo(() => {
    const map = new Map<string, ApPost[]>()
    for (const post of shown) {
      if (!post.date) continue
      const list = map.get(post.date) ?? []
      list.push(post)
      map.set(post.date, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
    }
    return map
  }, [shown])

  const selected = selectedKey
    ? posts.find((post) => `${post.workspaceId}:${post.id}` === selectedKey) ?? null
    : null
  const cells = useMemo(() => monthCells(anchor), [anchor])
  const weekStart = useMemo(
    () => (view === 'week' ? sundayOf(new Date(`${anchor}T12:00:00Z`)) : mondayOf(new Date(`${anchor}T12:00:00Z`))),
    [view, anchor],
  )
  const weekDays = useMemo(() => weekDates(view === 'week' ? weekStart : sundayOf(new Date(`${anchor}T12:00:00Z`))), [view, weekStart, anchor])

  const title = useMemo(() => {
    if (view === 'month') return niceMonth(anchor)
    if (view === 'week') return niceRange(weekDays[0], weekDays[6])
    return niceDay(anchor)
  }, [view, anchor, weekDays])

  async function act(kind: 'approve' | 'queue' | 'delete') {
    if (!selected || busy) return
    if (kind === 'delete' && !armed) {
      if (armTimer.current) window.clearTimeout(armTimer.current)
      setArmed(true)
      armTimer.current = window.setTimeout(() => setArmed(false), 4000)
      return
    }
    if (armTimer.current) window.clearTimeout(armTimer.current)
    setArmed(false)
    setBusy(true)
    setNote(null)
    const workspace = selected.workspaceId
    try {
      const response =
        kind === 'delete'
          ? await fetch(
              `/api/scheduler/posts/${encodeURIComponent(selected.id)}?workspace=${encodeURIComponent(workspace)}`,
              { method: 'DELETE' },
            )
          : await fetch(`/api/scheduler/posts/${encodeURIComponent(selected.id)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: kind, workspace }),
            })
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        setNote({ text: data.error ?? 'That did not land — try again.', bad: true })
        return
      }
      setSelectedKey(null)
      setLoading(true)
      const ok = await loadEverything(view, anchor)
      setFailed(!ok)
      setLoading(false)
    } finally {
      setBusy(false)
    }
  }

  const said = note && (
    <p className="hint" data-tone={note.bad ? 'bad' : undefined} role="status">
      {note.text}
    </p>
  )

  function renderEvent(post: ApPost, compact = false) {
    const platform = platformOf(post, accountByKey)
    const marks = post.accountIds
      .map((id) => accountByKey.get(accountKey(post.workspaceId, id)))
      .filter((account): account is ApAccountScoped => Boolean(account))
    const label = post.body || post.title || '(no caption)'
    return (
      <button
        key={`${post.workspaceId}:${post.id}`}
        type="button"
        className={compact ? 'sc-event' : 'sc-card'}
        data-platform={platform}
        title={label}
        onClick={() => {
          setArmed(false)
          setNote(null)
          setSelectedKey(`${post.workspaceId}:${post.id}`)
        }}>
        {compact ? (
          <>
            <span className="sc-event-mark" aria-hidden>
              {marks[0] ? <Mark platform={marks[0].platform} name={marks[0].name} size={11} /> : null}
            </span>
            <span className="sc-event-time">{post.time ?? '—'}</span>
            <span className="sc-event-body">{label}</span>
          </>
        ) : (
          <>
            <span className="sc-card-top">
              <span className="sc-dot" style={{ background: statusTone(post.status) }} aria-hidden />
              <span className="sc-time">{post.time ?? atOf(post)}</span>
              <span className="sc-marks">
                {marks.slice(0, 3).map((account) => (
                  <Mark key={accountKey(account.workspaceId, account.id)} platform={account.platform} name={account.name} />
                ))}
                {marks.length > 3 ? <span className="sc-more">+{marks.length - 3}</span> : null}
              </span>
            </span>
            <span className="sc-body">{label}</span>
            <span className="sc-status">{statusLabel(post.status)}</span>
          </>
        )}
      </button>
    )
  }

  return (
    <div className="sc-tab sc-page">
      {!configured ? (
        <section className="dash-panel">
          <p className="hint" data-tone="bad" role="alert">
            The scheduler is not connected yet — add <code>AUTOPOSTER_TOKEN</code> and{' '}
            <code>AUTOPOSTER_WORKSPACES</code> to the environment, then reload.
          </p>
        </section>
      ) : (
        <div className="sc-cal">
          <div className="sc-toolbar" role="toolbar" aria-label="Calendar controls">
            <div className="sc-toolbar-left">
              <button type="button" className="btn btn-small btn-quiet" onClick={goToday}>
                Today
              </button>
              <div className="sc-nav-arrows">
                <button type="button" className="sc-arrow" onClick={() => step(-1)} aria-label="Previous">
                  ‹
                </button>
                <button type="button" className="sc-arrow" onClick={() => step(1)} aria-label="Next">
                  ›
                </button>
              </div>
              <h2 className="sc-cal-title">{title}</h2>
            </div>

            <div className="sc-toolbar-mid" role="group" aria-label="Filters">
              <button
                type="button"
                className="sc-type"
                data-on={feedOn || undefined}
                onClick={() => setFeedOn((on) => !on)}>
                Posts / Stories
              </button>
              <button
                type="button"
                className="sc-type"
                data-on={clipsOn || undefined}
                onClick={() => setClipsOn((on) => !on)}>
                Reels / Videos
              </button>
              <DropSelect
                className="sc-account-pick"
                label="Accounts"
                value={accountPick}
                onChange={setAccountPick}
                options={accountOptions}
              />
            </div>

            <div className="sc-toolbar-right">
              {coverage.total > 0 ? (
                <span
                  className="sc-load"
                  data-tone={coverage.failed.length ? 'warn' : loading ? 'busy' : 'ok'}
                  title={
                    coverage.failed.length
                      ? `${coverage.failed.length} workspace${coverage.failed.length === 1 ? '' : 's'} unavailable${coverage.errors?.[0]?.message ? `: ${coverage.errors[0].message}` : ''}`
                      : `${coverage.loaded} of ${coverage.total} workspaces`
                  }>
                  {loading
                    ? syncing ? 'Syncing schedule…' : 'Loading calendar…'
                    : coverage.failed.length
                      ? `${coverage.loaded}/${coverage.total} workspaces`
                      : `${coverage.total} workspaces`}
                  {coverage.failed.length ? (
                    <button type="button" className="sc-load-retry" onClick={() => void retry()}>
                      Retry
                    </button>
                  ) : null}
                </span>
              ) : null}
              <div className="sc-views" role="group" aria-label="Calendar view">
                {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className="sc-view"
                    data-on={view === mode || undefined}
                    onClick={() => void switchView(mode)}>
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              <span className="sc-tz" title={timezone}>
                {timezone}
              </span>
              <Link className="btn btn-small" href="/scheduler/new">
                New post
              </Link>
            </div>
          </div>

          <div className="sc-cal-body">
            <section
              className="sc-week sc-month-panel"
              aria-label="Calendar grid"
              aria-busy={loading || undefined}>
              {failed ? (
                <p className="hint" data-tone="bad">
                  {loadError ?? 'Could not read the calendar.'}{' '}
                  <button type="button" className="pill" onClick={() => void retry()}>
                    Retry
                  </button>
                </p>
              ) : null}

              {view === 'month' ? (
                <div className="sc-month">
                  <div className="sc-month-head">
                    {WEEKDAYS_SUN.map((day) => (
                      <div key={day} className="sc-month-dow">
                        {day[0]}
                      </div>
                    ))}
                  </div>
                  <div className="sc-month-grid">
                    {cells.map((date) => {
                      const list = byDay.get(date) ?? []
                      const outside = !inMonth(date, anchor)
                      const isToday = date === today
                      return (
                        <div
                          key={date}
                          className="sc-month-cell"
                          data-outside={outside || undefined}
                          data-today={isToday || undefined}>
                          <div className="sc-month-cell-head">
                            <button
                              type="button"
                              className="sc-month-daynum"
                              data-today={isToday || undefined}
                              onClick={() => {
                                setView('day')
                                void navigate(date)
                              }}
                              aria-label={niceDay(date)}>
                              {dayNumber(date)}
                            </button>
                            <Link
                              className="sc-month-add"
                              href={`/scheduler/new?date=${date}`}
                              aria-label={`Post on ${niceDay(date)}`}>
                              ＋
                            </Link>
                          </div>
                          <div className="sc-month-events">
                            {list.slice(0, MONTH_PREVIEW).map((post) => renderEvent(post, true))}
                            {list.length > MONTH_PREVIEW ? (
                              <button
                                type="button"
                                className="sc-month-more"
                                onClick={() => {
                                  setView('day')
                                  void navigate(date)
                                }}>
                                +{list.length - MONTH_PREVIEW} more
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {view === 'week' ? (
                <div className="sc-grid sc-grid-week">
                  {weekDays.map((date) => {
                    const list = byDay.get(date) ?? []
                    return (
                      <div className="sc-day" key={date} data-today={date === today || undefined}>
                        <div className="sc-day-head">
                          <span className="sc-day-name">{niceDay(date)}</span>
                          {date === today ? <span className="sc-today-dot" aria-label="Today" /> : null}
                        </div>
                        <div className="sc-posts">
                          {list.map((post) => renderEvent(post, false))}
                          <Link
                            className="sc-add"
                            href={`/scheduler/new?date=${date}`}
                            aria-label={`Post on ${niceDay(date)}`}>
                            ＋
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}

              {view === 'day' ? (
                <div className="sc-day-view">
                  <div className="sc-day-view-head">
                    <span className="sc-day-name">{niceDay(anchor)}</span>
                    {anchor === today ? <span className="sc-today-dot" aria-label="Today" /> : null}
                  </div>
                  <div className="sc-posts sc-day-posts">
                    {(byDay.get(anchor) ?? []).length === 0 ? (
                      <p className="dash-empty">Nothing scheduled for this day.</p>
                    ) : (
                      (byDay.get(anchor) ?? []).map((post) => renderEvent(post, false))
                    )}
                    <Link className="sc-add" href={`/scheduler/new?date=${anchor}`} aria-label={`Post on ${niceDay(anchor)}`}>
                      ＋ Add post
                    </Link>
                  </div>
                </div>
              ) : null}

              {!failed && shown.length === 0 && !loading ? (
                <p className="dash-empty sc-cal-empty">No posts in this range — clear filters or schedule one.</p>
              ) : null}
            </section>
          </div>
        </div>
      )}

      {selected ? (
        <div
          className="aa-modal-veil"
          onClick={() => {
            setArmed(false)
            setSelectedKey(null)
          }}>
          <div
            className="adddialog aa-modal-card sc-sheet"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}>
            <header className="adddialog-head">
              <div>
                <p className="adddialog-kicker">{statusLabel(selected.status)}</p>
                <h2>{atOf(selected)}</h2>
              </div>
              <button
                className="adddialog-x"
                onClick={() => {
                  setArmed(false)
                  setSelectedKey(null)
                }}
                aria-label="Close">
                ×
              </button>
            </header>
            <div className="adddialog-body">
              <div className="sc-sheet-accounts">
                {selected.accountIds.map((id) => {
                  const account = accountByKey.get(accountKey(selected.workspaceId, id))
                  if (!account) return <span className="chip chip-static" key={id}>#{id}</span>
                  return (
                    <span className="chip chip-static" key={accountKey(account.workspaceId, account.id)}>
                      <Mark platform={account.platform} name={account.name} />
                      {account.name}
                    </span>
                  )
                })}
                {selected.accountIds.length === 0 ? <span className="hint">No accounts on this post.</span> : null}
              </div>
              {selected.workspaceId ? (
                <p className="hint">
                  {workspaceLabel(selected.workspaceId)} · {selected.kind}
                </p>
              ) : null}
              <p className="sc-sheet-body">{selected.body || selected.title || '(no caption)'}</p>
              {selected.mediaCount > 0 ? (
                <p className="hint">
                  {selected.mediaCount === 1 ? '1 attachment' : `${selected.mediaCount} attachments`}
                </p>
              ) : null}
              {said}
            </div>
            <footer className="adddialog-foot">
              <span className="adddialog-note">{selected.timezone ?? ''}</span>
              {selected.status.includes('approv') ? (
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act('approve')}>
                  {busy ? 'Working…' : 'Approve'}
                </button>
              ) : null}
              {selected.status === 'draft' ? (
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act('queue')}>
                  {busy ? 'Working…' : 'Add to queue'}
                </button>
              ) : null}
              {armed ? (
                <button type="button" className="btn btn-small ac-armed" disabled={busy} onClick={() => void act('delete')}>
                  Confirm delete
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-small btn-quiet"
                  disabled={busy}
                  title={`Delete this ${selected.status === 'draft' ? 'draft' : 'post'}`}
                  onClick={() => void act('delete')}>
                  Delete
                </button>
              )}
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  )
}
