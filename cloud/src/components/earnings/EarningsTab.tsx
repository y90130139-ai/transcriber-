'use client'

import { useCallback, useEffect, useState } from 'react'
import type { EarningsWindow } from '@/lib/earnings/board'
import type { WeeklyNumbers } from '@/lib/earnings/report'
import { money, niceDay } from '@/lib/earnings/report'
import BarChart from '../dashboard/BarChart'
import ReelMoney from './ReelMoney'
import type { ReelDay, ReelSummary } from '@/lib/earnings/reels'
import PeriodSwitch from '../dashboard/PeriodSwitch'
import { shortDay } from '../dashboard/format'

type ModelEarnings = {
  accounts: { infloww_id: string; name: string; username: string; missing_since: string | null }[]
  daily: { day: string; net: number; gross: number; subs: number; renewals: number }[]
  week: WeeklyNumbers | null
  reels: ReelDay[]
  reelSummary: ReelSummary
  window: { from: string; to: string; days: number }
}

const TYPE_WORD: Record<string, string> = {
  Messages: 'Messages', Tips: 'Tips', Subscription: 'New subs', RecurringSubscription: 'Renewals', Posts: 'Posts',
}

/** One model's OnlyFans earnings — her accounts together, the same numbers
 *  her Monday report is built from. */
export default function EarningsTab({ modelId }: { modelId: string }) {
  const [days, setDays] = useState<EarningsWindow>(30)
  const [data, setData] = useState<ModelEarnings | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: EarningsWindow) => {
    setError(null)
    const response = await fetch(`/api/earnings/model/${modelId}?days=${d}`).catch(() => null)
    if (!response?.ok) { setError('Her earnings did not load. Try again in a moment.'); return }
    setData(await response.json())
  }, [modelId])

  useEffect(() => { void load(days) }, [load, days])

  if (error) return <p className="dash-error" role="alert">{error} <button className="chip" onClick={() => void load(days)}>Retry</button></p>
  if (!data) return <p className="dash-empty" aria-busy="true">Reading her earnings…</p>
  if (data.accounts.length === 0) {
    return <p className="dash-empty">No OnlyFans account is matched to her yet. Match one on Dashboard → Earnings.</p>
  }

  const net = data.daily.reduce((n, d) => n + d.net, 0)
  const subs = data.daily.reduce((n, d) => n + d.subs, 0)
  const renewals = data.daily.reduce((n, d) => n + d.renewals, 0)
  const best = data.daily.reduce<ModelEarnings['daily'][number] | null>((b, d) => (d.net > 0 && (!b || d.net > b.net) ? d : b), null)
  const w = data.week

  return (
    <div className="earn-tab">
      <div className="earn-tab-head">
        <p className="earn-accounts">
          {data.accounts.map((a) => (
            <span key={a.infloww_id} data-missing={a.missing_since ? 'true' : undefined}>@{a.username}</span>
          ))}
        </p>
        <PeriodSwitch value={days} onChange={setDays} />
      </div>

      <section className="dash-stats earn-stats" aria-label="Her totals">
        <article className="dash-stat dash-stat-lead">
          <h3>Net · {days} days</h3>
          <p className="dash-stat-value">{money(net)}</p>
          <p className="dash-stat-note">{shortDay(data.window.from)} – {shortDay(data.window.to)}</p>
        </article>
        <article className="dash-stat">
          <h3>Best day</h3>
          <p className="dash-stat-value">{best ? money(best.net) : '–'}</p>
          <p className="dash-stat-note">{best ? niceDay(best.day) : 'no sales yet'}</p>
        </article>
        <article className="dash-stat">
          <h3>New subs</h3>
          <p className="dash-stat-value">{subs}</p>
          <p className="dash-stat-note">{renewals} renewals</p>
        </article>
      </section>

      <section className="dash-panel" aria-labelledby="earn-tab-daily">
        <header className="dash-panel-head">
          <h2 id="earn-tab-daily">Net by day</h2>
          <p>In dollars, after OnlyFans&rsquo; 20% fee</p>
        </header>
        <BarChart series={data.daily.map((d) => ({ day: d.day, value: Math.round(d.net / 100) }))}
          label="Her net earnings by day, in dollars" emptyNote="No sales in this period." />
      </section>

      <section className="dash-panel" aria-labelledby="earn-tab-reels">
        <header className="dash-panel-head">
          <h2 id="earn-tab-reels">Reels and money</h2>
          <p>Each day she posted, and what she made that day and the next. Internal only.</p>
        </header>
        <ReelMoney days={data.reels} summary={data.reelSummary} />
      </section>

      {w && (
        <section className="dash-panel" aria-labelledby="earn-tab-week">
          <header className="dash-panel-head">
            <h2 id="earn-tab-week">Last week · {shortDay(w.from)} – {shortDay(w.to)}</h2>
            <p>What her Monday report says</p>
          </header>
          <dl className="earn-week">
            <div><dt>Net</dt><dd>{money(w.net)}{w.change !== null && <small data-sign={Math.sign(w.change)}> {w.change > 0 ? '+' : ''}{w.change}% vs the week before</small>}</dd></div>
            {w.best && <div><dt>Best day</dt><dd>{niceDay(w.best.day)} · {money(w.best.net)}</dd></div>}
            {w.split.length > 0 && <div><dt>Came from</dt><dd>{w.split.map((s) => `${TYPE_WORD[s.type]} ${s.share}%`).join(' · ')}</dd></div>}
            <div><dt>Subs</dt><dd>{w.subs} new · {w.renewals} renewals</dd></div>
            {w.vsAvg4 !== null && <div><dt>4-week average</dt><dd>{money(w.avg4 ?? 0)} <small data-sign={Math.sign(w.vsAvg4)}>{w.vsAvg4 > 0 ? '+' : ''}{w.vsAvg4}%</small></dd></div>}
          </dl>
        </section>
      )}
    </div>
  )
}
