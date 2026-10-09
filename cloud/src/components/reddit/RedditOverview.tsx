'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { OverviewData } from '@/lib/reddit/queries'
import { TOPIC_CATEGORIES } from '@/lib/reddit/registry'
import DropSelect from '../dashboard/DropSelect'
import Sparkline from '../dashboard/Sparkline'
import { compact, num, timeAgo, untilLabel } from './bits'
import RedditLoading from './RedditLoading'
import RedditTrendChart from './RedditTrendChart'
import { useJson, postJson } from './useReddit'

const RANGE_OPTIONS = ['1h', '6h', '24h', '7d', '30d', '90d'] as const

/** The Overview board: one stat strip, the index graph, and the ranked
 *  lists — all from the cached analytics, with a refresh that collects now. */
export default function RedditOverview() {
  const router = useRouter()
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number] | 'custom'>('24h')
  const [mode, setMode] = useState<'interest' | 'activity'>('interest')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [subreddit, setSubreddit] = useState('')

  const chartParams = new URLSearchParams({ range })
  if (category) chartParams.set('category', category)
  if (subreddit.trim()) chartParams.set('subreddit', subreddit.trim())
  const { data, error, loading, reload } = useJson<OverviewData>(`/api/reddit/overview?${chartParams}`)

  // While baselines build, interest sits at its normal (~50) by design — the
  // activity line is what actually moves, so start there once, then let the
  // reader choose.
  const pickedDefault = useRef(false)
  useEffect(() => {
    if (!data || pickedDefault.current) return
    pickedDefault.current = true
    if (data.building_baseline) setMode('activity')
  }, [data])

  async function refresh() {
    setBusy(true)
    setNotice(null)
    try {
      const body = await postJson<{ result: { state: string; reason?: string; posts_new: number; mentions: number } }>(
        '/api/reddit/collect', { mode: 'run' },
      )
      const result = body.result
      if (result.state === 'skipped') {
        setNotice(result.reason === 'not-configured'
          ? 'Reddit credentials are not configured.'
          : `Collector ${result.reason?.replace('-', ' ')}.`)
      } else {
        setNotice(`${result.posts_new.toLocaleString('en-US')} new posts · ${result.mentions} new mentions`)
      }
      reload()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const displayedRange = data?.range ?? range
  const bucketSize = displayedRange === '7d' || displayedRange === '30d' || displayedRange === '90d' ? 'day' : 'hour'
  const collector = data?.collector

  return (
    <div className="rt-page" aria-busy={loading || busy}>
      <div className="rt-toolbar">
        <div className="rt-toolbar-left">
          <span className="rt-health" data-tone={
            !collector?.last_run_at ? 'idle'
              : collector.last_run_state === 'done' ? 'ok'
              : collector.last_run_state === 'stopped' ? 'warn' : 'bad'
          }>
            <i className="rt-beacon" aria-hidden />
            {loading && !data ? 'loading collector' : !collector?.last_run_at ? 'idle'
              : collector.last_run_state === 'done' ? 'collector healthy'
              : `collector ${collector.last_run_state}`}
          </span>
          <span className="rt-stamp">{loading && !data ? 'Reading latest snapshot…' : timeAgo(data?.last_updated)}</span>
          {data && (loading || busy) && (
            <span className="rt-loading-update" role="status">
              <i className="rt-beacon" aria-hidden="true" />
              {busy ? 'Collecting posts…' : 'Updating trends…'}
            </span>
          )}
        </div>

        <div className="rt-toolbar-right">
          <form className="rt-searchform" onSubmit={(event) => {
            event.preventDefault()
            if (query.trim().length >= 2) router.push(`/reddit-trends/search?q=${encodeURIComponent(query.trim())}`)
          }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Search…" aria-label="Search Reddit data" />
          </form>

          <DropSelect className="rt-dd" label="Filter chart by category" value={category}
            onChange={setCategory}
            options={[{ value: '', label: 'All categories' }, ...TOPIC_CATEGORIES.map((option) => ({ value: option, label: option }))]} />
          <input className="rt-input" value={subreddit} onChange={(event) => setSubreddit(event.target.value)}
            placeholder="r/subreddit" aria-label="Filter chart by subreddit" />

          <div className="rt-range" role="group" aria-label="Date range">
            {RANGE_OPTIONS.map((option) => (
              <button key={option} type="button" className="rt-range-btn" data-on={option === range}
                onClick={() => setRange(option)}>
                {option}
              </button>
            ))}
          </div>

          <button type="button" className="rt-btn" onClick={refresh} disabled={busy || loading}>
            {busy ? 'Collecting…' : 'Refresh'}
          </button>
          <a className="rt-btn rt-btn-quiet" href="/api/reddit/dataset?export=topics" download>Export</a>
        </div>
      </div>

      {notice && <p className="rt-notice">{notice}</p>}
      {error && (
        <div className="rt-error"><b>Could not load the board</b><p>{error}</p></div>
      )}

      {loading && !data && <RedditLoading />}

      {data && (
        <>
          <section className="rt-stats" aria-label="Headline figures">
            {(data?.cards ?? []).map((card) => (
              <div className="rt-stat" key={card.key} title={`${card.note ?? ''} · ${card.basis}`}>
                <span className="rt-stat-label">{card.label}</span>
                <b className="rt-stat-value" data-tone={card.key === 'success_rate' && (card.value ?? 100) < 90 ? 'warn' : undefined}>
                  {card.value === null ? '—' : card.key === 'success_rate' ? `${card.value}%` : compact(card.value)}
                </b>
              </div>
            ))}
          </section>

          <section className="rt-panel" aria-label="Interest over time">
            <div className="rt-panel-head">
              <h2>Reddit Interest Index</h2>
              {data?.building_baseline && <i className="rt-note-chip">building baseline</i>}
              <div className="rt-toggle" role="group" aria-label="Chart measure">
                <button type="button" data-on={mode === 'interest'} onClick={() => setMode('interest')}>Interest</button>
                <button type="button" data-on={mode === 'activity'} onClick={() => setMode('activity')}>Activity</button>
              </div>
            </div>
            <RedditTrendChart
              points={data?.series ?? []}
              previous={data?.previous ?? []}
              mode={mode}
              bucketSize={bucketSize}
            />
          </section>

          <div className="rt-columns">
            <section className="rt-panel" aria-label="Trending topics">
              <div className="rt-panel-head">
                <h2>Trending Topics</h2>
                <Link className="rt-panel-link" href="/reddit-trends/trending">All →</Link>
              </div>
              <ul className="rt-list">
                {(data?.trending ?? []).map((topic, index) => (
                  <li key={topic.id}>
                    <Link href={`/reddit-trends/topics/${topic.id}`} className="rt-list-row">
                      <span className="rt-rank">{index + 1}</span>
                      <span className="rt-list-main">
                        <b>{topic.name}</b>
                        <span className="rt-dim">{topic.mentions} mentions · {topic.subreddits} communities</span>
                      </span>
                      <Sparkline values={topic.spark} width={72} height={22} />
                      <span className="rt-list-figs">
                        <b>{topic.interest === null ? '—' : topic.interest.toFixed(0)}</b>
                        <span className="rt-dim">interest</span>
                      </span>
                      <i className="rt-status" data-tone={topic.status}>{topic.status}</i>
                    </Link>
                  </li>
                ))}
                {!loading && !data?.trending.length && <li className="rt-hint">No scored topics yet</li>}
              </ul>
            </section>

            <section className="rt-panel" aria-label="Rising topics">
              <div className="rt-panel-head"><h2>Rising Topics</h2></div>
              <ul className="rt-list">
                {(data?.rising ?? []).map((topic) => (
                  <li key={topic.id}>
                    <Link href={`/reddit-trends/topics/${topic.id}`} className="rt-list-row">
                      <span className="rt-list-main">
                        <b>{topic.name}</b>
                        <span className="rt-dim">{topic.mentions} mentions · {topic.subreddits} communities</span>
                      </span>
                      <span className="rt-growth" data-dir={(topic.growth ?? 0) > 0 ? 'up' : 'flat'}>
                        {topic.growth === null ? 'new' : `${topic.growth > 0 ? '+' : ''}${Math.round(topic.growth * 100)}%`}
                      </span>
                      <Sparkline values={topic.spark} width={72} height={22} />
                    </Link>
                  </li>
                ))}
                {!loading && !data?.rising.length && <li className="rt-hint">Nothing accelerating yet</li>}
              </ul>
            </section>

            <section className="rt-panel" aria-label="Top posts by velocity">
              <div className="rt-panel-head">
                <h2>Top Posts by Velocity</h2>
                <Link className="rt-panel-link" href="/reddit-trends/posts">All →</Link>
              </div>
              <ul className="rt-list">
                {(data?.top_posts ?? []).map((post) => (
                  <li key={post.id}>
                    <a href={post.permalink ?? '#'} target="_blank" rel="noreferrer noopener" className="rt-list-row">
                      <span className="rt-list-main">
                        <b className="rt-clamp">{post.title}</b>
                        <span className="rt-dim">r/{post.subreddit} · {timeAgo(post.created_utc)}</span>
                      </span>
                      <span className="rt-list-figs">
                        <b>{num(post.velocity, 1)}</b>
                        <span className="rt-dim">u/h</span>
                      </span>
                      <span className="rt-list-figs">
                        <b>{compact(post.score)}</b>
                        <span className="rt-dim">score</span>
                      </span>
                    </a>
                  </li>
                ))}
                {!loading && !data?.top_posts.length && <li className="rt-hint">No posts yet</li>}
              </ul>
            </section>
          </div>

          <div className="rt-columns rt-columns-2">
            <section className="rt-panel" aria-label="Collector health">
              <div className="rt-panel-head">
                <h2>Collector</h2>
                <span className="rt-health" data-tone={
                  !collector?.last_run_at ? 'idle'
                    : collector.last_run_state === 'done' ? 'ok'
                    : collector.last_run_state === 'stopped' ? 'warn' : 'bad'
                }>
                  <i className="rt-beacon" aria-hidden />
                  {!collector?.last_run_at ? 'idle'
                    : collector.last_run_state === 'done' ? 'healthy'
                    : collector.last_run_state}
                </span>
                <Link className="rt-panel-link" href="/reddit-trends/health">Details →</Link>
              </div>
              <div className="rt-metrics">
                <div className="rt-metric" title="Last collection run"><span className="rt-metric-label">Last sync</span><b className="rt-metric-value">{timeAgo(collector?.last_run_at)}</b></div>
                <div className="rt-metric" title="Next queued fetch"><span className="rt-metric-label">Next scan</span><b className="rt-metric-value">{untilLabel(collector?.next_scan_at)}</b></div>
                <div className="rt-metric" title="Communities waiting"><span className="rt-metric-label">Queue</span><b className="rt-metric-value">{collector?.queued ?? 0}</b></div>
                <div className="rt-metric" title="Runs with errors in the last 24 hours"><span className="rt-metric-label">Errors · 24h</span><b className="rt-metric-value" data-tone={(collector?.errors_24h ?? 0) > 0 ? 'bad' : undefined}>{collector?.errors_24h ?? 0}</b></div>
                <div className="rt-metric" title="Quota Reddit last reported remaining"><span className="rt-metric-label">Quota left</span><b className="rt-metric-value">{collector?.api_remaining === null || collector?.api_remaining === undefined ? '—' : Math.round(collector.api_remaining)}</b></div>
              </div>
              {collector && (
                <div className="rt-budget">
                  <div className="rt-budget-top">
                    <span>Daily requests</span>
                    <b>{collector.requests_today.toLocaleString('en-US')} / {collector.daily_cap.toLocaleString('en-US')}</b>
                  </div>
                  <div className="rt-budget-track" role="progressbar" aria-label="Daily request budget"
                    aria-valuenow={collector.requests_today} aria-valuemin={0} aria-valuemax={collector.daily_cap}>
                    <i data-tone={collector.requests_today / Math.max(1, collector.daily_cap) >= 0.9 ? 'warn' : undefined}
                      style={{ width: `${Math.min(100, (collector.requests_today / Math.max(1, collector.daily_cap)) * 100)}%` }} />
                  </div>
                </div>
              )}
            </section>

            <section className="rt-panel" aria-label="Alerts">
              <div className="rt-panel-head">
                <h2>Alerts</h2>
                <Link className="rt-panel-link" href="/reddit-trends/health">All →</Link>
              </div>
              <ul className="rt-list">
                {(data?.alerts ?? []).map((alert) => (
                  <li key={alert.id} className="rt-alert" data-severity={alert.severity}>
                    <span className="rt-list-main">
                      <b>{alert.title}</b>
                      <span className="rt-dim">{alert.body}</span>
                    </span>
                    <span className="rt-dim">{timeAgo(alert.created_at)}</span>
                  </li>
                ))}
                {!loading && !data?.alerts.length && <li className="rt-hint">No alerts</li>}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
