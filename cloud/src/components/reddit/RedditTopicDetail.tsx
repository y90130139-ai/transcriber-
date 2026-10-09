'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { TopicDetail } from '@/lib/reddit/queries'
import Sparkline from '../dashboard/Sparkline'
import { compact, GrowthText, num, StatusPill, timeAgo } from './bits'
import RedditTopicChart from './RedditTopicChart'
import { useJson } from './useReddit'

/** One topic, whole: the history graph, the numbers behind it, the posts
 *  and communities it lives in, and what else is moving nearby. */
export default function RedditTopicDetail() {
  const params = useParams<{ slug: string }>()
  const slug = typeof params?.slug === 'string' ? params.slug : ''
  const { data, error, loading } = useJson<TopicDetail>(slug ? `/api/reddit/topics/${slug}` : null)

  if (error) {
    return (
      <div className="rt-page">
        <div className="rt-error">
          <b>Topic not found</b>
          <p>{error}</p>
          <Link className="rt-btn rt-btn-quiet" href="/reddit-trends/topics">Back to Topics</Link>
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return <div className="rt-page"><div className="rt-skel"><i /><i /><i /><i /><i /></div></div>
  }
  if (!data) return null

  const { topic, latest, history, posts, subreddits, related } = data

  return (
    <div className="rt-page">
      <div className="rt-detail-head">
        <div>
          <p className="rt-kicker">
            <Link href="/reddit-trends/topics">Topics</Link> / {topic.category}
          </p>
          <h1 className="rt-detail-title">{topic.name} <StatusPill status={latest.status} /></h1>
          <p className="rt-sub">
            {topic.adult && <i className="rt-tag" data-tone="adult">adult</i>}
            {topic.source === 'derived' && <i className="rt-tag">derived from recurring titles</i>}
            Tracking since {timeAgo(topic.first_seen_at)}
          </p>
        </div>
        <div className="rt-detail-figs">
          <span><i>Interest</i><b>{latest.interest === null ? '—' : latest.interest.toFixed(1)}</b></span>
          <span><i>24h change</i><b><GrowthText value={latest.growth} /></b></span>
          <span><i>Velocity</i><b>{num(latest.velocity, 1)}</b></span>
          <span><i>Confidence</i><b>{latest.confidence === null ? '—' : `${Math.round(latest.confidence * 100)}%`}</b></span>
          <span><i>Last scored</i><b>{timeAgo(latest.captured_at)}</b></span>
        </div>
      </div>

      <section className="rt-panel">
        <div className="rt-panel-head">
          <h2>Growth</h2>
          {latest.captured_at && <span className="rt-panel-sub">updated {timeAgo(latest.captured_at)}</span>}
        </div>
        <RedditTopicChart history={history} />
      </section>

      <div className="rt-columns">
        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Measured</h2></div>
          <div className="rt-metrics">
            <div className="rt-metric" title="Observed mentions in the window"><span className="rt-metric-label">Mentions</span><b className="rt-metric-value">{compact(latest.mentions)}</b></div>
            <div className="rt-metric" title="Observed distinct authors"><span className="rt-metric-label">Authors</span><b className="rt-metric-value">{latest.unique_authors}</b></div>
            <div className="rt-metric" title="Observed communities"><span className="rt-metric-label">Communities</span><b className="rt-metric-value">{latest.subreddits}</b></div>
            <div className="rt-metric" title="Observed score + comments — not impressions"><span className="rt-metric-label">Engagement</span><b className="rt-metric-value">{compact(latest.engagement)}</b></div>
            <div className="rt-metric" title="Calculated 0–1"><span className="rt-metric-label">Breakout</span><b className="rt-metric-value">{latest.breakout === null ? '—' : latest.breakout.toFixed(2)}</b></div>
            <div className="rt-metric" title="Summed subscribers across the communities it appears in"><span className="rt-metric-label">Subscriber context</span><b className="rt-metric-value">{latest.subscriber_context === null ? '—' : compact(latest.subscriber_context)}</b></div>
          </div>
          {topic.keywords.length > 0 && (
            <>
              <p className="rt-section-label">Related keywords</p>
              <div className="rt-chipline">
                {topic.keywords.map((keyword) => <i className="rt-chip rt-chip-static" key={keyword}>{keyword}</i>)}
              </div>
            </>
          )}
        </section>

        <section className="rt-panel">
          <div className="rt-panel-head"><h2>Related subreddits</h2></div>
          <ul className="rt-list">
            {subreddits.map((subreddit) => (
              <li key={subreddit.id}>
                <Link href={`/reddit-trends/subreddits/${subreddit.id}`} className="rt-list-row">
                  <span className="rt-list-main"><b>r/{subreddit.id}</b></span>
                  <span className="rt-list-figs"><b>{subreddit.mentions}</b><span className="rt-dim">mentions</span></span>
                  <span className="rt-list-figs"><b>{compact(subreddit.engagement)}</b><span className="rt-dim">engagement</span></span>
                </Link>
              </li>
            ))}
            {!subreddits.length && <li className="rt-hint">No communities yet</li>}
          </ul>
          {related.length > 0 && (
            <>
              <p className="rt-section-label">Similar trends in {topic.category}</p>
              <ul className="rt-list">
                {related.map((entry) => (
                  <li key={entry.id}>
                    <Link href={`/reddit-trends/topics/${entry.id}`} className="rt-list-row">
                      <span className="rt-list-main"><b>{entry.name}</b></span>
                      <span className="rt-list-figs"><b>{entry.interest === null ? '—' : entry.interest.toFixed(0)}</b><span className="rt-dim">interest</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="rt-panel">
        <div className="rt-panel-head">
          <h2>Top Posts</h2>
        </div>
        <div className="rt-tablewrap">
          <table className="rt-table">
            <thead>
              <tr><th>Post</th><th>Subreddit</th><th className="rt-col-num">Score</th><th className="rt-col-num">Comments</th><th className="rt-col-num">Posted</th><th className="rt-col-num">Link</th></tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id}>
                  <td><Link href={`/reddit-trends/posts?q=${encodeURIComponent(post.title.slice(0, 60))}`}><b className="rt-clamp">{post.title}</b></Link></td>
                  <td className="rt-dim">r/{post.subreddit}</td>
                  <td className="rt-col-num">{compact(post.score)}</td>
                  <td className="rt-col-num">{compact(post.comments)}</td>
                  <td className="rt-col-num rt-dim">{timeAgo(post.created_utc)}</td>
                  <td className="rt-col-num">
                    {post.permalink && (
                      <a className="rt-link" href={post.permalink} target="_blank" rel="noreferrer noopener">source ↗</a>
                    )}
                  </td>
                </tr>
              ))}
              {!posts.length && <tr><td colSpan={6} className="rt-hint">No posts yet</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rt-panel">
        <div className="rt-panel-head"><h2>Readings</h2></div>
        <ul className="rt-history">
          {history.slice(0, 14).map((point) => (
            <li key={point.captured_at}>
              <span className="rt-dim">{timeAgo(point.captured_at)}</span>
              <span><b>{point.mentions}</b> mentions · <b>{point.authors}</b> authors · <b>{point.communities}</b> comms</span>
              <span>
                interest <b>{point.interest === null ? '—' : point.interest.toFixed(1)}</b> ·
                growth <b>{point.growth === null ? 'new' : `${Math.round(point.growth * 100)}%`}</b> ·
                velocity <b>{num(point.velocity, 1)}</b>
              </span>
              <Sparkline values={[point.mentions, point.authors, point.communities]} width={54} height={18} />
            </li>
          ))}
          {!history.length && <li className="rt-hint">No readings yet</li>}
        </ul>
      </section>
    </div>
  )
}
