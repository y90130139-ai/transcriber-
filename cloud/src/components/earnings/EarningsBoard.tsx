'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AccountRow, EarningsWindow } from '@/lib/earnings/board'
import { money } from '@/lib/earnings/report'
import BarChart from '../dashboard/BarChart'
import { ReelDayRow } from './ReelMoney'
import type { ReelDay } from '@/lib/earnings/reels'
import PeriodSwitch from '../dashboard/PeriodSwitch'
import { ago, shortDay } from '../dashboard/format'

type Board = {
  window: { from: string; to: string; days: number }
  total: { net: number; gross: number; prevNet: number; change: number | null }
  daily: { day: string; net: number }[]
  accounts: AccountRow[]
  models: { id: string; name: string }[]
  messages: { id: string; kind: string; status: string; model_name: string; period: string; error: string | null }[]
  pulledAt: string | null
  reelHits: (ReelDay & { model_id: string; model_name: string })[]
}

const KIND_WORD: Record<string, string> = { weekly: 'Week of', win: 'Win', milestone: 'Milestone', monthly: 'Recap' }
const monthOf = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })

/** A single account over this share of agency net is structural risk. */
const CONCENTRATION = 30

const STATUS_WORD: Record<string, string> = {
  draft: 'Waiting in OPS', approved: 'Approved', sent: 'Sent', skipped: 'Skipped', failed: 'Not sent',
}

/** OnlyFans earnings from Infloww, internal only: the agency, every account,
 *  and which roster model each account belongs to. */
export default function EarningsBoard({ onOpenModel }: { onOpenModel: (id: string) => void }) {
  const [days, setDays] = useState<EarningsWindow>(30)
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: EarningsWindow) => {
    setError(null)
    const response = await fetch(`/api/earnings?days=${d}`).catch(() => null)
    if (!response?.ok) { setError('Earnings did not load. Try again in a moment.'); return }
    setBoard(await response.json())
  }, [])

  useEffect(() => { void load(days) }, [load, days])

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

  const top = board?.accounts[0]
  const unmatched = board?.accounts.filter((a) => !a.model_id && !a.missing_since).length ?? 0

  return (
    <div className="dash earn">
      <header className="dash-head">
        <div>
          <p className="dash-kicker">OnlyFans · Infloww</p>
          <h2 className="dash-title">Earnings</h2>
          <p className="dash-sub">
            Net is after OnlyFans&rsquo; 20% fee. Refunds are left out.
            {board?.pulledAt && <> Last pulled {ago(board.pulledAt)}.</>}
          </p>
        </div>
        <div className="dash-head-tools">
          <PeriodSwitch value={days} onChange={setDays} />
          {board && <p className="dash-range">{shortDay(board.window.from)} – {shortDay(board.window.to)}</p>}
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
              <h3>Net earnings</h3>
              <p className="dash-stat-value">{money(board.total.net)}</p>
              <p className="dash-stat-note">
                {board.total.change === null
                  ? 'no earlier period to compare'
                  : <><b data-sign={Math.sign(board.total.change)}>{board.total.change > 0 ? '+' : ''}{board.total.change}%</b> vs the {days} days before</>}
              </p>
            </article>
            <article className="dash-stat">
              <h3>Gross</h3>
              <p className="dash-stat-value">{money(board.total.gross)}</p>
              <p className="dash-stat-note">before OnlyFans&rsquo; fee</p>
            </article>
            <article className="dash-stat">
              <h3>Per day</h3>
              <p className="dash-stat-value">{money(Math.round(board.total.net / days))}</p>
              <p className="dash-stat-note">net, average</p>
            </article>
            <article className="dash-stat" data-warn={top && top.share > CONCENTRATION ? 'true' : undefined}>
              <h3>Top account</h3>
              <p className="dash-stat-value">{top ? `${top.share}%` : '–'}</p>
              <p className="dash-stat-note">
                {top ? top.name : ''}{top && top.share > CONCENTRATION ? ' · over 30% of the agency' : ''}
              </p>
            </article>
            <article className="dash-stat" data-warn={unmatched ? 'true' : undefined}>
              <h3>Unmatched</h3>
              <p className="dash-stat-value">{unmatched}</p>
              <p className="dash-stat-note">{unmatched ? 'no reports until matched' : 'every account matched'}</p>
            </article>
          </section>

          <section className="dash-panel" aria-labelledby="earn-daily-h">
            <header className="dash-panel-head">
              <h2 id="earn-daily-h">Net by day</h2>
              <p>Every account together, in dollars. The last ~3 days are still settling.</p>
            </header>
            <BarChart series={board.daily.map((d) => ({ day: d.day, value: Math.round(d.net / 100) }))}
              label="Net earnings by day, in dollars" emptyNote="No sales in this period." />
          </section>

          <section className="dash-panel" aria-labelledby="earn-reels-h">
            <header className="dash-panel-head">
              <h2 id="earn-reels-h">Reels that moved money</h2>
              <p>Hit reels (2×+ her usual views) followed by 1.5×+ her usual two days. Internal only: timing, not proof.</p>
            </header>
            {board.reelHits.length === 0
              ? <p className="dash-empty">None in this period yet.</p>
              : <ul className="reel-days">{board.reelHits.map((d) => <ReelDayRow key={`${d.model_id}${d.day}`} d={d} name />)}</ul>}
          </section>

          <section className="dash-panel" aria-labelledby="earn-acc-h">
            <header className="dash-panel-head">
              <h2 id="earn-acc-h">Accounts</h2>
              <p>Match each account to her roster model. Reports only ever go to the matched model&rsquo;s group.</p>
            </header>
            <div className="dash-table-wrap">
              <table className="dash-table earn-table">
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Model</th>
                    <th scope="col" className="num">Net</th>
                    <th scope="col" className="num">Change</th>
                    <th scope="col" className="num">Share</th>
                    <th scope="col">Pull</th>
                  </tr>
                </thead>
                <tbody>
                  {board.accounts.map((a) => (
                    <tr key={a.infloww_id} data-missing={a.missing_since ? 'true' : undefined}>
                      <th scope="row">
                        <span className="earn-name">{a.name}</span>
                        <span className="earn-user">@{a.username}</span>
                      </th>
                      <td>
                        <label className="earn-match">
                          <span className="sr-only">Model for {a.name}</span>
                          <select value={a.model_id ?? ''} onChange={(e) => void match(a, e.target.value || null)}>
                            <option value="">Not matched</option>
                            {board.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </label>
                        {a.model_id && (
                          <button className="earn-open" onClick={() => onOpenModel(a.model_id!)} aria-label={`Open ${a.model_name}`}>↗</button>
                        )}
                      </td>
                      <td className="num">{money(a.net)}</td>
                      <td className="num" data-sign={a.change === null ? 0 : Math.sign(a.change)}>
                        {a.change === null ? '–' : `${a.change > 0 ? '+' : ''}${a.change}%`}
                      </td>
                      <td className="num" data-warn={a.share > CONCENTRATION ? 'true' : undefined}>{a.share}%</td>
                      <td className="earn-pull">
                        {a.missing_since
                          ? <span className="earn-bad">Gone from Infloww {ago(a.missing_since)}</span>
                          : a.pull_error
                            ? <span className="earn-bad" title={a.pull_error}>Failed · {a.pull_error.slice(0, 40)}</span>
                            : a.pulled_through ? `through ${shortDay(a.pulled_through)}` : 'not yet'}
                      </td>
                    </tr>
                  ))}
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
