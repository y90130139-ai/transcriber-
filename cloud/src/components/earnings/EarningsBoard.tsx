'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AccountRow, EarningsWindow } from '@/lib/earnings/board'
import { money } from '@/lib/earnings/report'
import Avatar from '../dashboard/Avatar'
import BarChart from '../dashboard/BarChart'
import DropSelect from '../dashboard/DropSelect'
import LineChart from '../dashboard/LineChart'
import MicroBars from '../dashboard/MicroBars'
import Sparkline from '../dashboard/Sparkline'
import PeriodSwitch from '../dashboard/PeriodSwitch'
import ViewSwitch, { type DashView } from '../dashboard/ViewSwitch'
import { ago, shortDay } from '../dashboard/format'
import type { ReelDay } from '@/lib/earnings/reels'

type Board = {
  window: { from: string; to: string; days: number }
  total: { net: number; gross: number; prevNet: number; change: number | null; subNet: number; subs: number; renewals: number }
  daily: { day: string; net: number; gross: number }[]
  accounts: AccountRow[]
  models: { id: string; name: string; photo_url: string | null; active: boolean }[]
  messages: { id: string; kind: string; status: string; model_name: string; period: string; error: string | null }[]
  pulledAt: string | null
}

type ReelHit = ReelDay & { model_id: string; model_name: string }

const KIND_WORD: Record<string, string> = { weekly: 'Week of', win: 'Win', milestone: 'Milestone', monthly: 'Recap' }
const monthOf = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })

/** A single account over this share of agency net is structural risk. */
const CONCENTRATION = 30

const STATUS_WORD: Record<string, string> = {
  draft: 'Waiting in OPS', approved: 'Approved', sent: 'Sent', skipped: 'Skipped', failed: 'Not sent',
}

type SortKey = 'net' | 'change' | 'share'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'net', label: 'Net' },
  { key: 'change', label: 'Change' },
  { key: 'share', label: 'Share' },
]

const sortValue = (a: AccountRow, key: SortKey): number =>
  key === 'net' ? a.net : key === 'share' ? a.share : (a.change ?? -Infinity)

/** Fifteen dots, one per slice of the period: green means money came in. */
function EarnDots({ rate }: { rate: number }) {
  const filled = Math.round(rate * 15)
  return (
    <div className="dash-dots" aria-hidden>
      {Array.from({ length: 15 }, (_, index) => <i key={index} data-on={index < filled} />)}
    </div>
  )
}

/** OnlyFans earnings from Infloww, internal only: the agency, every account,
 *  and which roster model each account belongs to. */
export default function EarningsBoard({ onOpenModel, view, onView }: {
  onOpenModel: (id: string) => void
  view: DashView
  onView: (next: DashView) => void
}) {
  const [days, setDays] = useState<EarningsWindow>(30)
  const [board, setBoard] = useState<Board | null>(null)
  const [hits, setHits] = useState<ReelHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const hitReq = useRef(0)
  const [sort, setSort] = useState<SortKey>('net')
  const accounts = useRef<HTMLElement>(null)

  const load = useCallback(async (d: EarningsWindow) => {
    setError(null)
    const response = await fetch(`/api/earnings?days=${d}`).catch(() => null)
    if (!response?.ok) { setError('Earnings did not load. Try again in a moment.'); return }
    setBoard(await response.json())
  }, [])

  useEffect(() => {
    const id = ++hitReq.current
    let live = true
    // The board paints first; the reel hits stream in right after, so the tab
    // never waits on creator posts and per-model history to show numbers.
    setHits(null)
    void load(days)
    fetch(`/api/earnings/reels?days=${days}`)
      .then((r) => (r.ok ? r.json() : { reelHits: [] }))
      .then((j) => { if (live && hitReq.current === id) setHits(j.reelHits ?? []) })
      .catch(() => { if (live && hitReq.current === id) setHits([]) })
    return () => { live = false }
  }, [load, days])

  async function match(account: AccountRow, modelId: string | null) {
    setError(null)
    const response = await fetch(`/api/earnings/accounts/${account.infloww_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, win_floor: account.win_floor_cents === null ? null : account.win_floor_cents / 100 }),
    }).catch(() => null)
    if (!response?.ok) { setError(`Could not match ${account.name}. Nothing changed.`); return }
    await load(days)
  }

  const rows = useMemo(() => {
    if (!board) return []
    const q = query.trim().toLowerCase()
    return board.accounts
      .filter((a) =>
        !q || a.name.toLowerCase().includes(q) || a.username.toLowerCase().includes(q) ||
        (a.model_name ?? '').toLowerCase().includes(q))
      .sort((a, b) => sortValue(b, sort) - sortValue(a, sort))
  }, [board, query, sort])

  const top = board?.accounts[0]
  const maxShare = top?.share ?? 0
  const photos = useMemo(() => new Map((board?.models ?? []).map((m) => [m.id, m.photo_url] as const)), [board])
  const photoOf = (modelId: string | null | undefined) => (modelId ? photos.get(modelId) ?? null : null)
  const peak = board ? Math.max(...board.daily.map((d) => d.net), 0) : 0
  const activeDays = board?.daily.filter((d) => d.net > 0).length ?? 0
  const activeRate = board && board.daily.length ? activeDays / board.daily.length : null
  const fee = board ? board.total.gross - board.total.net : 0
  const leaders = board?.accounts.slice(0, 5) ?? []
  const growing = board?.accounts.filter((a) => a.change !== null && a.change >= 5 && !a.missing_since) ?? []
  const slipping = board?.accounts.filter((a) => a.change !== null && a.change <= -5 && !a.missing_since) ?? []
  const steady = board?.accounts.filter((a) => (a.change === null || (a.change > -5 && a.change < 5)) && !a.missing_since) ?? []
  const tooNew = board?.accounts.filter((a) => a.change === null && !a.missing_since).length ?? 0
  // Cumulative net, in dollars: the pace lens. The LineChart tip reads the
  // day's take beside the running total, so one chart says both.
  const cumulative = useMemo(() => {
    let run = 0
    return (board?.daily ?? []).map((d) => {
      run += Math.round(d.net / 100)
      return { day: d.day, value: run }
    })
  }, [board])

  function scrollToAccounts() {
    accounts.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const hitsStrip = useRef<HTMLOListElement>(null)
  function slideHits(direction: 1 | -1) {
    const el = hitsStrip.current
    if (!el) return
    el.scrollBy({ left: direction * Math.min(el.clientWidth * 0.8, 560), behavior: 'smooth' })
  }

  return (
    <div className="dash earn">
      <header className="dash-head">
        <div>
          <h2 className="dash-title">Earnings</h2>
          <p className="dash-sub">
            Net is after OnlyFans&rsquo; 20% fee.
            {board?.pulledAt && <> Last pulled {ago(board.pulledAt)}.</>}
          </p>
        </div>
        <div className="dash-head-tools">
          <div className="dash-head-controls">
            <ViewSwitch value={view} onChange={onView} />
            <PeriodSwitch value={days} onChange={setDays} />
          </div>
        </div>
      </header>

      {error && <p className="dash-error" role="alert">{error} <button className="chip" onClick={() => void load(days)}>Retry</button></p>}
      {!board && !error && <p className="dash-empty" aria-busy="true">Reading earnings…</p>}
      {board && board.accounts.length === 0 && (
        <p className="dash-empty">No earnings pulled yet. The first pull runs every morning at 9 ET, or from the Mac with <code>npm run earnings</code>.</p>
      )}

      {board && board.accounts.length > 0 && (
        <>
          <section className="dash-stats earn-stats" aria-label="Totals">
            <article className="dash-stat dash-stat-lead">
              <h3>Net earnings · {days}d</h3>
              <p className="dash-stat-value">{money(board.total.net)}</p>
              <p className="dash-stat-note">
                {board.total.change === null
                  ? 'no earlier period to compare'
                  : <><b data-sign={Math.sign(board.total.change)}>{board.total.change > 0 ? '+' : ''}{board.total.change}%</b> vs the {days} days before</>}
              </p>
              <Sparkline values={board.daily.map((d) => d.net)} width={520} height={90} area
                format={(v, i) => `${board.daily[i] ? `${shortDay(board.daily[i].day)} · ` : ''}${money(v)}`} />
            </article>
            <article className="dash-stat">
              <h3>Gross · {days}d</h3>
              <p className="dash-stat-value">{money(board.total.gross)}</p>
              <p className="dash-stat-note">before OnlyFans&rsquo; fee</p>
              <p className="dash-pill" data-anchor="bottom">−{money(fee)} fee</p>
            </article>
            <article className="dash-stat">
              <h3>Per day · {days}d</h3>
              <p className="dash-stat-value">{money(Math.round(board.total.net / days))}</p>
              <MicroBars values={board.daily.map((d) => d.net)} />
              {peak > 0 && <p className="dash-pill">peak {money(peak)}</p>}
            </article>
            {/* Subscription money on its own (Geno, 2026-10-06): new subs +
                renewals together, and how much of the agency that side is.
                Free trials never reach the open API — no transaction exists
                for a $0 join — so what is counted here is paid subs only. */}
            <article className="dash-stat">
              <h3>Subscriptions</h3>
              <p className="dash-stat-value">{money(board.total.subNet)}</p>
              <p className="dash-stat-note">
                {board.total.subs} new · {board.total.renewals} renewals
                {board.total.net > 0 && <> · {Math.round((board.total.subNet / board.total.net) * 100)}% of net</>}
              </p>
            </article>
            <article className="dash-stat" data-warn={top && top.share > CONCENTRATION ? 'true' : undefined}>
              <h3>Top account</h3>
              <p className="dash-stat-value">{top ? `${top.share}%` : '–'}</p>
              <p className="dash-stat-note">{top ? top.name : ''}</p>
              <div className="dash-meter" data-warn={top && top.share > CONCENTRATION ? 'true' : undefined} aria-hidden>
                <i style={{ width: `${Math.min(top?.share ?? 0, 100)}%` }} />
              </div>
              {top && top.share > CONCENTRATION && (
                <p className="dash-pill" data-tone="attention">over 30% of the agency</p>
              )}
            </article>
            <article className="dash-stat">
              <h3>Paying days · {days}d</h3>
              <p className="dash-stat-value">{activeRate === null ? '–' : `${Math.round(activeRate * 100)}%`}</p>
              {activeRate !== null && <EarnDots rate={activeRate} />}
              {activeRate !== null && <p className="dash-pill">{activeDays} of {board.daily.length} days paid</p>}
            </article>
          </section>

          <div className="dash-grid-main">
            <section className="dash-panel dash-growth" aria-labelledby="earn-pace-h">
              <header className="dash-panel-head">
                <h2 id="earn-pace-h">Money momentum</h2>
                <p>Running net across every account, in dollars</p>
              </header>
              <LineChart series={cumulative} label="Cumulative net earnings by day, in dollars"
                emptyNote="Net history starts the day of the first pull — check back tomorrow." />
              <p className="dash-foot">The last ~3 days are still settling with OnlyFans. Hover any point for that day&rsquo;s take.</p>
            </section>
            <section className="dash-panel dash-leading" aria-labelledby="earn-lead-h">
              <header className="dash-panel-head">
                <h2 id="earn-lead-h">Top earners</h2>
                <p>By net in this period</p>
              </header>
              {leaders.length === 0 ? <p className="dash-empty">No sales in this period yet.</p> : (
                <ol className="dash-rank">
                  {leaders.map((a, i) => (
                    <li key={a.infloww_id}>
                      <button className="dash-rank-row" onClick={() => (a.model_id ? onOpenModel(a.model_id) : scrollToAccounts())}>
                        <span className="dash-rank-n">{String(i + 1).padStart(2, '0')}</span>
                        <Avatar name={a.model_name ?? a.name} src={photoOf(a.model_id)} />
                        <span className="dash-rank-name"><b>{a.name}</b><small>@{a.username}</small></span>
                        <span className="earn-lead-money">
                          <b>{money(a.net)}</b>
                          <small data-sign={a.change === null ? 0 : Math.sign(a.change)}>
                            {a.change === null ? 'new' : `${a.change > 0 ? '+' : ''}${a.change}%`}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <button className="dash-link" onClick={scrollToAccounts}>View all accounts →</button>
            </section>
          </div>

          <section className="dash-panel dash-movement" aria-labelledby="earn-move-h">
            <header className="dash-panel-head dash-panel-head-flush">
              <h2 id="earn-move-h">Movement</h2>
              <p>Net vs the {days} days before</p>
            </header>
            <div className="dash-move-cols">
              {([
                { key: 'up', title: 'Growing', icon: '↑', members: growing },
                { key: 'flat', title: 'Steady', icon: '→', members: steady },
                { key: 'down', title: 'Slipping', icon: '↓', members: slipping },
              ] as const).map((group) => (
                <div key={group.key} className="dash-move-col" data-trend={group.key === 'flat' ? undefined : group.key}>
                  <h3><b aria-hidden>{group.icon}</b> {group.title} <span>{group.members.length}</span></h3>
                  <div className="dash-faces">
                    {group.members.map((a) => (
                      <button key={a.infloww_id} className="dash-face earn-face"
                        onClick={() => (a.model_id ? onOpenModel(a.model_id) : scrollToAccounts())} title={`${a.name} · ${money(a.net)}`}>
                        <Avatar name={a.model_name ?? a.name} src={photoOf(a.model_id)} size={36} />
                        <span>{a.name.split(' ')[0]}</span>
                        <small data-sign={a.change === null ? 0 : Math.sign(a.change)}>
                          {a.change === null ? 'new' : `${a.change > 0 ? '+' : ''}${a.change}%`}
                        </small>
                      </button>
                    ))}
                    {group.members.length === 0 && <p className="dash-empty">Nobody</p>}
                  </div>
                </div>
              ))}
            </div>
            {tooNew > 0 && <p className="dash-foot">{tooNew} too new to compare — no earlier period yet.</p>}
          </section>

          <section className="dash-panel" aria-labelledby="earn-reels-h">
            <header className="dash-panel-head dash-reels-head">
              <div>
                <h2 id="earn-reels-h">Reels that moved money</h2>
                <p>Hit reels (2×+ her usual views) followed by 1.5×+ her usual two days. Internal only: timing, not proof.</p>
              </div>
              {hits !== null && hits.length > 0 && (
                <div className="dash-reel-nav" role="group" aria-label="Scroll money reels">
                  <button type="button" onClick={() => slideHits(-1)} aria-label="Scroll left">←</button>
                  <button type="button" onClick={() => slideHits(1)} aria-label="Scroll right">→</button>
                </div>
              )}
            </header>
            {hits === null
              ? <p className="dash-empty" aria-busy="true">Reading reels…</p>
              : hits.length === 0
              ? <p className="dash-empty">None in this period yet.</p>
              : (
                <ol className="earn-hits" ref={hitsStrip}>
                  {hits.map((d) => {
                    const topReel = d.reels[0]
                    return (
                      <li key={`${d.model_id}${d.day}`}>
                        <a className="earn-hit" href={topReel.url} target="_blank" rel="noopener noreferrer"
                          aria-label={`${d.model_name} reel from ${shortDay(d.day)}, ${money(d.net)}`}>
                          <p className="earn-hit-top">
                            <span className="earn-hit-model">
                              <Avatar name={d.model_name} src={photoOf(d.model_id)} size={20} />
                              <b>{d.model_name}</b>
                            </span>
                            <span>{shortDay(d.day)}</span>
                          </p>
                          <span className="earn-hit-cap">{topReel.caption?.trim() || `@${topReel.handle}`}</span>
                          <p className="earn-hit-views">
                            {`${views(topReel.plays)} views`}
                            {topReel.multiple != null && ` · ${topReel.multiple}× her usual`}
                          </p>
                          <p className="earn-hit-money"><b>{money(d.net)}</b></p>
                          <p className="earn-hit-mult">
                            <span className="dash-pill" data-tone="up">{d.moneyMultiple != null ? `${d.moneyMultiple}× her usual 2 days` : 'no baseline yet'}</span>
                          </p>
                          <p className="earn-hit-sub">{d.subs} subs{d.complete ? '' : ' · still counting'}</p>
                        </a>
                      </li>
                    )
                  })}
                </ol>
              )}
          </section>

          <section className="dash-panel" aria-labelledby="earn-daily-h">
            <header className="dash-panel-head dash-panel-head-flush">
              <h2 id="earn-daily-h">Net by day</h2>
              <p>Every account together, in dollars. Refunds are left out. The last ~3 days are still settling.</p>
            </header>
            <BarChart series={board.daily.map((d) => ({ day: d.day, value: Math.round(d.net / 100) }))}
              label="Net earnings by day, in dollars" emptyNote="No sales in this period."
              format={(value) => money(value * 100)} />
          </section>

          <section className="dash-panel dash-accounts" aria-labelledby="earn-acc-h" ref={accounts}>
            <header className="dash-panel-head dash-accounts-head">
              <div>
                <h2 id="earn-acc-h">Your accounts <span>{board.accounts.length}</span></h2>
                <p>Match each account to her roster model. Reports only ever go to the matched model&rsquo;s group.</p>
              </div>
              <div className="earn-search">
                <svg className="earn-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="16.5" y1="16.5" x2="21" y2="21" />
                </svg>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search accounts…" aria-label="Search accounts" />
                {query && (
                  <button type="button" className="minput-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>
                )}
              </div>
            </header>
            <div className="dash-table-wrap">
              <table className="dash-table earn-table">
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Model</th>
                    {SORTS.map((s) => (
                      <Fragment key={s.key}>
                        {s.key === 'change' && <th scope="col" className="num">Subs</th>}
                        <th scope="col" className="num" aria-sort={sort === s.key ? 'descending' : undefined}>
                          <button className="dash-sort" data-on={sort === s.key} onClick={() => setSort(s.key)}>
                            {s.label}{sort === s.key ? ' ↓' : ''}
                          </button>
                        </th>
                      </Fragment>
                    ))}
                    <th scope="col">Pull</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.infloww_id} data-missing={a.missing_since ? 'true' : undefined}>
                      <th scope="row">
                        <span className="dash-who">
                          <Avatar name={a.model_name ?? a.name} src={photoOf(a.model_id)} size={28} />
                          <span>
                            <span className="earn-name">{a.name}</span>
                            <span className="earn-user">@{a.username}</span>
                          </span>
                        </span>
                      </th>
                      <td>
                        <DropSelect value={a.model_id ?? ''} onChange={(v) => void match(a, v || null)}
                          label={`Model for ${a.name}`}
                          options={[{ value: '', label: 'Not matched' },
                            ...board.models.filter((m) => m.active || m.id === a.model_id)
                              .map((m) => ({ value: m.id, label: m.name }))]} />
                        {a.model_id && (
                          <button className="earn-open" onClick={() => onOpenModel(a.model_id!)} aria-label={`Open ${a.model_name}`}>↗</button>
                        )}
                      </td>
                      <td className="num">{money(a.net)}</td>
                      <td className="num earn-subs" title={`${a.subs} new subs · ${a.renewals} renewals`}>
                        {money(a.subNet)}
                        <span className="earn-subs-count">{a.subs} + {a.renewals} ren</span>
                      </td>
                      <td className="num" data-sign={a.change === null ? 0 : Math.sign(a.change)}>
                        {a.change === null ? '–' : `${a.change > 0 ? '+' : ''}${a.change}%`}
                      </td>
                      <td className="num" data-warn={a.share > CONCENTRATION ? 'true' : undefined}>
                        <span className="earn-share">
                          {a.share}%
                          <i style={{ width: `${maxShare > 0 ? (a.share / maxShare) * 100 : 0}%` }} />
                        </span>
                      </td>
                      <td className="earn-pull">
                        {a.missing_since
                          ? <span className="earn-bad">Gone from Infloww {ago(a.missing_since)}</span>
                          : a.pull_error
                            ? <span className="earn-bad" title={a.pull_error}>Failed · {a.pull_error.slice(0, 40)}</span>
                            : a.pulled_through ? `through ${shortDay(a.pulled_through)}` : 'not yet'}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={6} className="dash-empty">No account matches.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {board.messages.length > 0 && (
            <section className="dash-panel" aria-labelledby="earn-msg-h">
              <header className="dash-panel-head">
                <h2 id="earn-msg-h">Reports and wins</h2>
                <p>Drafted each morning, approved in OPS before they reach her.</p>
              </header>
              <ul className="earn-msgs">
                {board.messages.map((m) => (
                  <li key={m.id} data-status={m.status}>
                    <b>{m.model_name}</b>
                    <span>{KIND_WORD[m.kind] ?? m.kind} · {m.kind === 'monthly' ? monthOf(m.period) : shortDay(m.period)}</span>
                    <span className="earn-status" title={m.error ?? undefined}>{STATUS_WORD[m.status] ?? m.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

const views = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))
