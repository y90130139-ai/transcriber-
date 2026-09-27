'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Board } from '@/lib/performance/load'
import AccountsTable from './AccountsTable'
import AttentionPanel from './AttentionPanel'
import BarChart from './BarChart'
import LeadingAccounts from './LeadingAccounts'
import LineChart from './LineChart'
import Movement from './Movement'
import PeriodSwitch, { type Period } from './PeriodSwitch'
import StatCards from './StatCards'
import TopReels from './TopReels'
import { shortDay } from './format'

const PERIOD_KEY = 'sinaura-dash-period'

/** The first thing the console shows: where every model stands on Instagram. */
export default function Dashboard({ onOpenModel }: { onOpenModel: (id: string) => void }) {
  const [period, setPeriod] = useState<Period>(30)
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAttention, setShowAttention] = useState(false)
  const accounts = useRef<HTMLElement>(null)

  const load = useCallback(async (days: Period) => {
    setError(null)
    const response = await fetch(`/api/dashboard?days=${days}`).catch(() => null)
    if (!response?.ok) { setError('The numbers did not load. Try again in a moment.'); return }
    setBoard(await response.json())
  }, [])

  // The period last looked at, read after mount so the server render and the
  // first client render agree.
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(PERIOD_KEY))
      if (saved === 7 || saved === 90) setPeriod(saved)
    } catch { /* storage blocked: 30 days it is */ }
  }, [])

  useEffect(() => { void load(period) }, [load, period])

  function choose(next: Period) {
    setPeriod(next)
    try { localStorage.setItem(PERIOD_KEY, String(next)) } catch { /* private window: fine */ }
  }

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="dash-kicker">Account intelligence</p>
          <h2 className="dash-title">Overview</h2>
          <p className="dash-sub">Every model&rsquo;s Instagram, read by Scout each day.</p>
        </div>
        <div className="dash-head-tools">
          <PeriodSwitch value={period} onChange={choose} />
          {board && <p className="dash-range">{shortDay(board.from)} – {shortDay(board.to)}</p>}
        </div>
      </header>

      {error && <p className="dash-error" role="alert">{error} <button className="chip" onClick={() => void load(period)}>Retry</button></p>}
      {!board && !error && <p className="dash-empty" aria-busy="true">Reading every account…</p>}

      {board && (
        <>
          <StatCards board={board} onAttention={() => setShowAttention((open) => !open)} />
          {showAttention && (
            <AttentionPanel models={board.models} onOpen={onOpenModel} onClose={() => setShowAttention(false)} />
          )}
          <div className="dash-grid-main">
            <section className="dash-panel dash-growth" aria-labelledby="dash-growth-h">
              <header className="dash-panel-head">
                <h2 id="dash-growth-h">Audience growth</h2>
                <p>Followers across every tracked account</p>
              </header>
              <LineChart series={board.followers_series} previous={board.followers_prev}
                label="Total followers by day"
                emptyNote="Follower history starts the day Scout first reads an account — check back tomorrow." />
              {board.followers_series.length > 0 && board.followers_series.length < period && (
                <p className="dash-foot">History starts {shortDay(board.followers_series[0].day)}, when Scout began reading these accounts.</p>
              )}
            </section>
            <LeadingAccounts models={board.models} onOpen={onOpenModel}
              onAll={() => accounts.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          </div>
          <Movement models={board.models} onOpen={onOpenModel} />
          <TopReels reels={board.top_reels} />
          <section className="dash-panel" aria-labelledby="dash-views-h">
            <header className="dash-panel-head">
              <h2 id="dash-views-h">Views by day posted</h2>
              <p>Plays on every model&rsquo;s reels, by the day they went up</p>
            </header>
            <BarChart series={board.views_series} label="Views by day posted" emptyNote="No reels posted in this period." />
          </section>
          <AccountsTable ref={accounts} models={board.models} days={board.days} onOpen={onOpenModel} />
        </>
      )}
    </div>
  )
}
