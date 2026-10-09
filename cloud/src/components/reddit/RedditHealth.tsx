'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { AlertRow } from '@/lib/reddit/types'
import type { HealthData } from '@/lib/reddit/queries'
import { timeAgo, untilLabel } from './bits'
import { postJson, putJson, useJson } from './useReddit'

/** Where the collection actually stands: last run, queue, hourly API usage,
 *  community problems, alerts — and the pause / emergency controls. */
export default function RedditHealth() {
  const { data, error, loading, reload } = useJson<HealthData>('/api/reddit/health')
  const alerts = useJson<{ rows: AlertRow[]; unseen: number }>('/api/reddit/alerts?limit=40')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function run(mode: 'run' | 'validate') {
    setBusy(true)
    setNotice(null)
    try {
      const body = await postJson<{ result: { state: string; subreddits: number; posts_new: number; mentions: number; errors: number; reason?: string } }>(
        '/api/reddit/collect', { mode },
      )
      const result = body.result
      setNotice(result.state === 'skipped'
        ? `Not run: ${result.reason}`
        : `${mode === 'validate' ? 'Validated' : 'Collected'}: ${result.subreddits} communities, ${result.posts_new} new posts, ${result.mentions} mentions, ${result.errors} errors.`)
      reload()
      alerts.reload()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function setSwitch(patch: Record<string, unknown>, message: string) {
    setBusy(true)
    setNotice(null)
    try {
      await putJson('/api/reddit/settings', patch)
      setNotice(message)
      reload()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const usageMax = Math.max(1, ...(data?.usage_hourly ?? []).map((point) => point.requests))

  return (
    <div className="rt-page">
      <div className="rt-toolbar">
        <div className="rt-toolbar-left">
          {data && (
            <span className="rt-health" data-tone={
              !data.configured ? 'bad' : data.emergency_stop ? 'bad' : data.paused ? 'warn'
                : data.stale ? 'warn' : 'ok'
            }>
              <i className="rt-beacon" aria-hidden />
              {!data.configured ? 'Credentials missing — collection cannot run'
                : data.emergency_stop ? 'Emergency stop is on'
                : data.paused ? 'Collector paused'
                : data.stale ? 'Collection is stale (no run in 6h)' : 'Collector healthy'}
            </span>
          )}
          {data?.last_run && <span className="rt-stamp">Last run {timeAgo(data.last_run.started_at)} · {data.last_run.state}</span>}
        </div>
        <div className="rt-toolbar-right">
          <button type="button" className="rt-btn" onClick={() => run('run')} disabled={busy || !data?.configured}>Collect now</button>
          <button type="button" className="rt-btn rt-btn-quiet" onClick={() => run('validate')} disabled={busy || !data?.configured}>Validate queue</button>
          {data && (
            <button type="button" className="rt-btn rt-btn-quiet" disabled={busy}
              onClick={() => setSwitch({ paused: !data.paused }, data.paused ? 'Monitoring resumed.' : 'All monitoring paused.')}>
              {data.paused ? 'Resume monitoring' : 'Pause all monitoring'}
            </button>
          )}
          {data && (
            <button type="button" className="rt-btn rt-btn-danger" disabled={busy}
              onClick={() => {
                if (data.emergency_stop) void setSwitch({ emergency_stop: false }, 'Emergency stop released.')
                else if (window.confirm('Emergency stop halts all collection immediately. Continue?')) {
                  void setSwitch({ emergency_stop: true }, 'Emergency stop engaged.')
                }
              }}>
              {data.emergency_stop ? 'Release emergency stop' : 'Emergency stop'}
            </button>
          )}
        </div>
      </div>

      {notice && <p className="rt-notice">{notice}</p>}
      {error && <div className="rt-error"><b>Could not load health</b><p>{error}</p></div>}
      {loading && !data && <div className="rt-skel"><i /><i /><i /></div>}

      {data && (
        <>
          <div className="rt-columns">
            <section className="rt-panel">
              <div className="rt-panel-head"><h2>Runs</h2><span className="rt-panel-sub">last 12</span></div>
              <div className="rt-tablewrap">
                <table className="rt-table">
                  <thead>
                    <tr><th>Started</th><th>Trigger</th><th>State</th><th className="rt-col-num">Comms</th><th className="rt-col-num">Requests</th><th className="rt-col-num">New posts</th><th className="rt-col-num">Mentions</th><th className="rt-col-num">Errors</th></tr>
                  </thead>
                  <tbody>
                    {data.runs.map((entry) => (
                      <tr key={entry.id}>
                        <td className="rt-dim">{timeAgo(entry.started_at)}</td>
                        <td className="rt-dim">{entry.trigger}</td>
                        <td><i className="rt-status" data-tone={entry.state === 'done' ? 'ok' : entry.state === 'partial' ? 'warn' : 'bad'}>{entry.state}</i></td>
                        <td className="rt-col-num">{entry.subreddits}</td>
                        <td className="rt-col-num">{entry.requests}/{entry.budget}</td>
                        <td className="rt-col-num">{entry.posts_new}</td>
                        <td className="rt-col-num">{entry.mentions}</td>
                        <td className="rt-col-num" data-tone={entry.errors ? 'bad' : undefined}>{entry.errors}</td>
                      </tr>
                    ))}
                    {!data.runs.length && <tr><td colSpan={8} className="rt-hint">No runs yet</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rt-panel">
              <div className="rt-panel-head">
                <h2>API safety</h2>
                {data.rate.cooldown_until && Date.parse(data.rate.cooldown_until) > Date.now() && (
                  <button type="button" className="rt-btn rt-btn-quiet" disabled={busy}
                    onClick={() => setSwitch({ rate_cooldown_until: null }, 'Cooldown cleared')}>
                    Clear cooldown
                  </button>
                )}
              </div>
              <div className="rt-metrics">
                <div className="rt-metric" title="Seconds of quota Reddit last reported left">
                  <span className="rt-metric-label">Quota left</span>
                  <b className="rt-metric-value">{data.rate.remaining === null ? '—' : Math.round(data.rate.remaining)}</b>
                </div>
                <div className="rt-metric" title="Requests Reddit counted in the current window">
                  <span className="rt-metric-label">Used</span>
                  <b className="rt-metric-value">{data.rate.used === null ? '—' : Math.round(data.rate.used)}</b>
                </div>
                <div className="rt-metric" title="Rolling safety cap: requests in the last hour against the cap">
                  <span className="rt-metric-label">Calls · 1h</span>
                  <b className="rt-metric-value">{data.rate.requests_1h}<i className="rt-metric-sub">/{data.budget.hourly_cap}</i></b>
                </div>
                <div className="rt-metric" title="429/403 responses in the last 24 hours">
                  <span className="rt-metric-label">Blocked · 24h</span>
                  <b className="rt-metric-value" data-tone={data.rate.blocked_24h > 0 ? 'bad' : undefined}>{data.rate.blocked_24h}</b>
                </div>
                <div className="rt-metric" title="Collection stands down while a cooldown is active">
                  <span className="rt-metric-label">Cooldown</span>
                  <b className="rt-metric-value" data-tone={data.rate.cooldown_until && Date.parse(data.rate.cooldown_until) > Date.now() ? 'warn' : undefined}>
                    {data.rate.cooldown_until && Date.parse(data.rate.cooldown_until) > Date.now()
                      ? `until ${new Date(data.rate.cooldown_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : 'none'}
                  </b>
                </div>
              </div>
              <div className="rt-metrics">
                <div className="rt-metric" title="Requests per run"><span className="rt-metric-label">Budget</span><b className="rt-metric-value">{data.budget.per_run}</b></div>
                <div className="rt-metric" title="Minimum gap between requests"><span className="rt-metric-label">Interval</span><b className="rt-metric-value">{data.budget.min_interval_ms}ms</b></div>
                <div className="rt-metric" title="Share of Reddit's reported quota we allow ourselves"><span className="rt-metric-label">Safety</span><b className="rt-metric-value">{Math.round(data.budget.safety_ratio * 100)}%</b></div>
                <div className="rt-metric" title={data.jobs.map((job) => `${job.n} ${job.state}`).join(' · ')}><span className="rt-metric-label">Queue</span><b className="rt-metric-value">{data.jobs.reduce((total, job) => total + (job.state === 'queued' ? job.n : 0), 0)}</b></div>
              </div>
              <p className="rt-section-label">Calls per hour · 24h</p>
              <div className="rt-bars" aria-hidden>
                {data.usage_hourly.length
                  ? data.usage_hourly.map((point) => (
                    <i key={point.bucket} data-error={point.errors > 0}
                      style={{ height: `${Math.max(4, (point.requests / usageMax) * 100)}%` }}
                      title={`${point.requests} requests, ${point.errors} problems`} />
                  ))
                  : <span className="rt-hint">No calls yet</span>}
              </div>
            </section>
          </div>

          <section className="rt-panel">
            <div className="rt-panel-head">
              <h2>Monitoring</h2>
              <span className="rt-panel-sub">daily schedule · {data.scheduler.requests_today}/{data.scheduler.daily_cap} requests today</span>
            </div>
            <div className="rt-metrics">
              <div className="rt-metric" title="Communities in scope">
                <span className="rt-metric-label">Tracked</span><b className="rt-metric-value">{data.scheduler.tracked}</b>
              </div>
              <div className="rt-metric" title="Fetched at least once since midnight UTC">
                <span className="rt-metric-label">Scanned today</span><b className="rt-metric-value">{data.scheduler.scanned_today}</b>
              </div>
              <div className="rt-metric" title="Communities still waiting for today's scan">
                <span className="rt-metric-label">Remaining scans</span><b className="rt-metric-value">{data.scheduler.remaining_scans}</b>
              </div>
              <div className="rt-metric" title="Internal daily ceiling — failures and retries included">
                <span className="rt-metric-label">Budget left</span><b className="rt-metric-value">{data.scheduler.remaining_budget}</b>
              </div>
              <div className="rt-metric" title="When the next queued fetch is due">
                <span className="rt-metric-label">Next scan</span><b className="rt-metric-value">{untilLabel(data.scheduler.next_scan_at)}</b>
              </div>
              <div className="rt-metric" title="Last successful Reddit response">
                <span className="rt-metric-label">OAuth</span>
                <b className="rt-metric-value" data-tone={data.configured ? undefined : 'bad'}>
                  {data.configured ? (data.scheduler.oauth_ok_at ? `ok ${timeAgo(data.scheduler.oauth_ok_at)}` : 'no calls yet') : 'not configured'}
                </b>
              </div>
              <div className="rt-metric" title="Paused communities">
                <span className="rt-metric-label">Paused</span><b className="rt-metric-value">{data.scheduler.paused}</b>
              </div>
              <div className="rt-metric" title="Restricted, missing or repeatedly failing communities">
                <span className="rt-metric-label">Inaccessible</span>
                <b className="rt-metric-value" data-tone={data.scheduler.inaccessible > 0 ? 'warn' : undefined}>{data.scheduler.inaccessible}</b>
              </div>
            </div>
          </section>

          <section className="rt-panel">
            <div className="rt-panel-head">
              <h2>Community problems</h2>
              <span className="rt-panel-sub">restricted, missing or repeatedly failing</span>
            </div>
            <div className="rt-tablewrap">
              <table className="rt-table">
                <thead><tr><th>Community</th><th>Status</th><th>Note</th><th className="rt-col-num">Failures</th><th className="rt-col-num">Last error</th><th></th></tr></thead>
                <tbody>
                  {data.problem_subreddits.map((entry) => (
                    <tr key={entry.id}>
                      <td><b>r/{entry.id}</b></td>
                      <td><i className="rt-status" data-tone={entry.status === 'unavailable' ? 'bad' : 'warn'}>{entry.status}</i></td>
                      <td className="rt-dim">{entry.note ?? '—'}</td>
                      <td className="rt-col-num">{entry.failures}</td>
                      <td className="rt-dim rt-clamp">{entry.last_error ?? '—'}</td>
                      <td className="rt-col-num"><Link className="rt-link" href={`/reddit-trends/subreddits/${entry.id}`}>open</Link></td>
                    </tr>
                  ))}
                  {!data.problem_subreddits.length && <tr><td colSpan={6} className="rt-hint">No problems</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rt-panel">
            <div className="rt-panel-head">
              <h2>Alert centre</h2>
              <span className="rt-panel-sub">{alerts.data?.unseen ?? 0} unseen</span>
              <button type="button" className="rt-btn rt-btn-quiet" disabled={busy || !alerts.data?.unseen}
                onClick={async () => { await postJson('/api/reddit/alerts', { all: true }).catch(() => null); alerts.reload() }}>
                Mark all seen
              </button>
            </div>
            <ul className="rt-list">
              {(alerts.data?.rows ?? []).map((alert) => (
                <li key={alert.id} className="rt-alert" data-severity={alert.severity} data-unseen={!alert.seen_at}>
                  <span className="rt-list-main">
                    <b>{alert.title}</b>
                    <span className="rt-dim">{alert.body}</span>
                  </span>
                  <span className="rt-dim">{timeAgo(alert.created_at)}</span>
                  {!alert.seen_at && (
                    <button type="button" className="rt-mini" disabled={busy}
                      onClick={async () => { await postJson('/api/reddit/alerts', { id: alert.id }).catch(() => null); alerts.reload() }}>
                      Seen
                    </button>
                  )}
                </li>
              ))}
              {!loading && !(alerts.data?.rows ?? []).length && <li className="rt-hint">No alerts</li>}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
