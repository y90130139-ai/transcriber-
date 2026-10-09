'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import type { SubredditDetail } from '@/lib/reddit/queries'
import { compact, num, timeAgo } from './bits'
import RedditSubredditChart from './RedditSubredditChart'
import { useJson } from './useReddit'

/** One community: description, history, what it talks about, what performs,
 *  and the collection record — including its failures. */
export default function RedditSubredditDetail() {
  const params = useParams<{ name: string }>()
  const name = typeof params?.name === 'string' ? params.name : ''
  const { data, error, loading, reload } = useJson<SubredditDetail>(name ? `/api/reddit/subreddits/${name}` : null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function patch(update: Record<string, unknown>, message: string) {
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/reddit/subreddits/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`)
      setNotice(message)
      reload()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="rt-page">
        <div className="rt-error">
          <b>Community not found</b><p>{error}</p>
          <Link className="rt-btn rt-btn-quiet" href="/reddit-trends/subreddits">Back to Subreddits</Link>
        </div>
      </div>
    )
  }
  if (loading && !data) return <div className="rt-page"><div className="rt-skel"><i /><i /><i /></div></div>
  if (!data) return null

  const sub = data.subreddit

  return (
    <div className="rt-page">
      <div className="rt-detail-head">
        <div>
          <p className="rt-kicker">
            <Link href="/reddit-trends/subreddits">Subreddits</Link> / {sub.category}
          </p>
          <h1 className="rt-detail-title">
            r/{sub.display_name}
            {sub.over18 && <i className="rt-tag" data-tone="adult">NSFW</i>}
            {sub.paused && <i className="rt-tag">paused</i>}
          </h1>
          <p className="rt-sub">
            {sub.url && <a href={sub.url} target="_blank" rel="noreferrer noopener">open on Reddit ↗</a>}
            {' · '}{sub.title ?? 'no public title read yet'}
          </p>
          {sub.description && <p className="rt-desc">{sub.description}</p>}
        </div>
        <div className="rt-detail-figs">
          <span><i>Subscribers</i><b>{sub.subscribers === null ? '—' : compact(sub.subscribers)}</b></span>
          <span><i>Posts collected</i><b>{compact(sub.posts_collected)}</b></span>
          <span><i>Engagement</i><b>{compact(sub.engagement)}</b></span>
          <span><i>Avg / post</i><b>{sub.posts_collected ? compact(sub.engagement / sub.posts_collected) : '—'}</b></span>
          <span><i>Last sync</i><b>{timeAgo(sub.last_synced_at)}</b></span>
        </div>
      </div>

      {notice && <p className="rt-notice">{notice}</p>}

      <div className="rt-toolbar">
        <div className="rt-filters">
          <button type="button" className="rt-chip" disabled={busy}
            onClick={() => patch({ paused: !sub.paused }, sub.paused ? 'Collection resumed.' : 'Collection paused.')}>
            {sub.paused ? 'Resume collection' : 'Pause collection'}
          </button>
          {(['high', 'medium', 'low'] as const).map((priority) => (
            <button key={priority} type="button" className="rt-chip" data-on={sub.priority === priority} disabled={busy}
              onClick={() => patch({ priority }, `Priority set to ${priority}.`)}>
              {priority} priority
            </button>
          ))}
          <button type="button" className="rt-chip" disabled={busy}
            onClick={() => patch({ enabled: !sub.enabled }, sub.enabled ? 'Tracking disabled.' : 'Tracking enabled.')}>
            {sub.enabled ? 'Disable tracking' : 'Enable tracking'}
          </button>
        </div>
      </div>

      <div className="rt-columns">
        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Activity</h2></div>
          <RedditSubredditChart series={data.series} />
          <div className="rt-metrics">
            <div className="rt-metric" title={sub.status_note ?? `interval ${sub.interval_minutes}m`}><span className="rt-metric-label">Status</span><b className="rt-metric-value">{sub.status}</b></div>
            <div className="rt-metric"><span className="rt-metric-label">Validated</span><b className="rt-metric-value">{timeAgo(sub.validated_at)}</b></div>
            <div className="rt-metric"><span className="rt-metric-label">Failures</span><b className="rt-metric-value" data-tone={sub.consecutive_failures > 0 ? 'bad' : undefined}>{sub.consecutive_failures}</b></div>
          </div>
        </section>

        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Top trending topics here</h2></div>
          <ul className="rt-list">
            {data.topics.map((topic) => (
              <li key={topic.id}>
                <Link href={`/reddit-trends/topics/${topic.id}`} className="rt-list-row">
                  <span className="rt-list-main"><b>{topic.name}</b></span>
                  <span className="rt-list-figs"><b>{topic.mentions}</b><span className="rt-dim">mentions</span></span>
                </Link>
              </li>
            ))}
            {!data.topics.length && <li className="rt-hint">No mentions yet</li>}
          </ul>
          {data.errors.length > 0 && (
            <>
              <p className="rt-section-label">Collection errors</p>
              <ul className="rt-list">
                {data.errors.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="rt-alert" data-severity="warning">
                    <span className="rt-list-main"><b>{entry.error}</b><span className="rt-dim">{timeAgo(entry.at)}</span></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="rt-panel">
        <div className="rt-panel-head">
          <h2>Top posts</h2>
          <span className="rt-panel-sub">By observed score</span>
        </div>
        <div className="rt-tablewrap">
          <table className="rt-table">
            <thead>
              <tr><th>Post</th><th className="rt-col-num">Score</th><th className="rt-col-num">Comments</th><th className="rt-col-num">Age</th><th className="rt-col-num">Velocity</th><th className="rt-col-num">Link</th></tr>
            </thead>
            <tbody>
              {data.posts.map((post) => (
                <tr key={post.id}>
                  <td><b className="rt-clamp">{post.title}</b>{post.over18 && <i className="rt-tag" data-tone="adult">NSFW</i>}</td>
                  <td className="rt-col-num">{compact(post.score)}</td>
                  <td className="rt-col-num">{compact(post.comments)}</td>
                  <td className="rt-col-num rt-dim">{timeAgo(post.created_utc)}</td>
                  <td className="rt-col-num">{num(post.velocity, 1)}</td>
                  <td className="rt-col-num">{post.permalink && <a className="rt-link" href={post.permalink} target="_blank" rel="noreferrer noopener">source ↗</a>}</td>
                </tr>
              ))}
              {!data.posts.length && <tr><td colSpan={6} className="rt-hint">No posts yet</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
