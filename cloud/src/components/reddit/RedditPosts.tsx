'use client'

import { useMemo, useState } from 'react'
import type { OverviewPost, PostDetail } from '@/lib/reddit/queries'
import DropSelect from '../dashboard/DropSelect'
import { compact, num, timeAgo } from './bits'
import { useJson } from './useReddit'

type SortKey = 'velocity' | 'score' | 'comments' | 'recent'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'velocity', label: 'Highest velocity' },
  { key: 'score', label: 'Top score' },
  { key: 'comments', label: 'Most discussion' },
  { key: 'recent', label: 'Newest' },
]
const LISTINGS = ['', 'new', 'hot', 'rising']

/** The Posts board, and the detail panel behind every row. */
export default function RedditPosts() {
  const [sort, setSort] = useState<SortKey>('velocity')
  const [listing, setListing] = useState('')
  const [subreddit, setSubreddit] = useState('')
  const [range, setRange] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const url = useMemo(() => {
    const params = new URLSearchParams()
    params.set('sort', sort)
    if (listing) params.set('listing', listing)
    if (subreddit.trim()) params.set('subreddit', subreddit.trim().replace(/^r\//i, '').toLowerCase())
    if (query.trim()) params.set('q', query.trim())
    if (range) params.set('range', range)
    params.set('limit', '60')
    return `/api/reddit/posts?${params}`
  }, [sort, listing, subreddit, query, range])

  const { data, error, loading } = useJson<{ rows: OverviewPost[] }>(url)
  const rows = data?.rows ?? []

  return (
    <div className="rt-page">
      <div className="rt-toolbar">
        <div className="rt-filters">
          <DropSelect className="rt-dd" label="Sort" value={sort}
            onChange={(next) => setSort(next as SortKey)}
            options={SORTS.map((option) => ({ value: option.key, label: option.label }))} />
          <DropSelect className="rt-dd" label="Listing" value={listing} onChange={setListing}
            options={[{ value: '', label: 'Any listing' }, ...LISTINGS.filter(Boolean).map((option) => ({ value: option, label: option }))]} />
          <DropSelect className="rt-dd" label="Time range" value={range} onChange={setRange}
            options={[
              { value: '', label: 'Any time' },
              { value: '24h', label: 'Today' },
              { value: '7d', label: 'This week' },
              { value: '30d', label: 'This month' },
            ]} />
        </div>
        <div className="rt-toolbar-right">
          <input className="rt-input" value={subreddit} onChange={(event) => setSubreddit(event.target.value)}
            placeholder="r/subreddit" aria-label="Filter by subreddit" />
          <form className="rt-searchform" onSubmit={(event) => event.preventDefault()}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles…" aria-label="Search post titles" />
          </form>
        </div>
      </div>

      {error && <div className="rt-error"><b>Could not load posts</b><p>{error}</p></div>}

      <div className="rt-tablewrap">
        <table className="rt-table">
          <thead>
            <tr>
              <th>Post</th><th>Subreddit</th>
              <th className="rt-col-num">Score</th><th className="rt-col-num">Comments</th>
              <th className="rt-col-num">Age</th><th className="rt-col-num">Velocity</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((post) => (
              <tr key={post.id} tabIndex={0} role="button" aria-label={`Open ${post.title}`}
                onClick={() => setOpen(post.id)}
                onKeyDown={(event) => { if (event.key === 'Enter') setOpen(post.id) }}>
                <td>
                  <b className="rt-clamp">{post.title}</b>
                  {post.over18 && <i className="rt-tag" data-tone="adult">NSFW</i>}
                </td>
                <td className="rt-dim">r/{post.subreddit}</td>
                <td className="rt-col-num">{compact(post.score)}</td>
                <td className="rt-col-num">{compact(post.comments)}</td>
                <td className="rt-col-num rt-dim">{timeAgo(post.created_utc)}</td>
                <td className="rt-col-num"><b>{num(post.velocity, 1)}</b> <span className="rt-dim">u/h</span></td>
                <td className="rt-col-num">
                  {post.permalink && (
                    <a className="rt-link" href={post.permalink} target="_blank" rel="noreferrer noopener"
                      onClick={(event) => event.stopPropagation()}>Reddit ↗</a>
                  )}
                </td>
              </tr>
            ))}
            {loading && !data && Array.from({ length: 8 }, (_, index) => (
              <tr key={index}><td colSpan={7}><div className="rt-skel"><i /></div></td></tr>
            ))}
            {!loading && !rows.length && (
              <tr><td colSpan={7} className="rt-hint">Nothing collected yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && <PostSheet id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function PostSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useJson<PostDetail>(`/api/reddit/posts/${id}`)
  const post = data?.post
  const snapshots = data?.snapshots ?? []
  const points = snapshots.slice(-40)

  return (
    <>
      <button type="button" className="rt-scrim" aria-label="Close post" onClick={onClose} />
      <aside className="rt-sheet" aria-label="Post detail">
        <div className="rt-sheet-head">
          <button type="button" className="rt-sheet-close" onClick={onClose} aria-label="Close">×</button>
          {error && <p className="rt-error-inline">{error}</p>}
          {post && (
            <>
              <p className="rt-kicker">r/{post.subreddit} · {timeAgo(post.created_utc)} · {post.kind}</p>
              <h3>{post.title}</h3>
              <p className="rt-sub">
                {post.author ? `u/${post.author}` : 'author unavailable'}
                {post.flair ? ` · ${post.flair}` : ''}
                {post.over18 ? ' · NSFW' : ''}
                {post.permalink && (
                  <> · <a href={post.permalink} target="_blank" rel="noreferrer noopener">open on Reddit ↗</a></>
                )}
              </p>
            </>
          )}
        </div>

        {post && (
          <div className="rt-sheet-body">
            <div className="rt-metrics">
              <div className="rt-metric"><span className="rt-metric-label">Score</span><b className="rt-metric-value">{compact(post.score)}</b><span className="rt-metric-note">observed</span></div>
              <div className="rt-metric"><span className="rt-metric-label">Comments</span><b className="rt-metric-value">{compact(post.comments)}</b><span className="rt-metric-note">observed</span></div>
              <div className="rt-metric"><span className="rt-metric-label">Upvote ratio</span><b className="rt-metric-value">{post.upvote_ratio === null ? '—' : `${Math.round(post.upvote_ratio * 100)}%`}</b></div>
              <div className="rt-metric"><span className="rt-metric-label">Self-text</span><b className="rt-metric-value">{post.selftext_len ?? 0}</b></div>
            </div>

            <p className="rt-section-label">Performance over time</p>
            {points.length >= 2 ? (
              <SnapshotChart points={points} />
            ) : (
              <p className="rt-hint">Single reading so far</p>
            )}

            {post.topics.length > 0 && (
              <>
                <p className="rt-section-label">Topic associations</p>
                <div className="rt-chipline">
                  {post.topics.map((topic) => (
                    <a key={topic.id} className="rt-chip" href={`/reddit-trends/topics/${topic.id}`}>{topic.name}</a>
                  ))}
                </div>
              </>
            )}

            {data?.related && data.related.length > 0 && (
              <>
                <p className="rt-section-label">Related posts in r/{post.subreddit}</p>
                <ul className="rt-list">
                  {data.related.map((related) => (
                    <li key={related.id} className="rt-list-row">
                      <span className="rt-list-main"><b className="rt-clamp">{related.title}</b></span>
                      <span className="rt-list-figs"><b>{compact(related.score)}</b><span className="rt-dim">score</span></span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  )
}

/** Score and comments as they were observed — never interpolation. */
function SnapshotChart({ points }: { points: { captured_at: string; score: number | null; comments: number | null }[] }) {
  const W = 460
  const H = 140
  const pad = 24
  const scores = points.map((point) => point.score ?? 0)
  const comments = points.map((point) => point.comments ?? 0)
  const hi = Math.max(1, ...scores, ...comments)
  const x = (index: number) => pad + (index / (points.length - 1)) * (W - pad * 2)
  const y = (value: number) => H - pad - (value / hi) * (H - pad * 2)
  const line = (values: number[]) => values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  return (
    <svg className="rt-snapchart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score and comments over time">
      <path className="rt-snap-score" d={line(scores)} />
      <path className="rt-snap-comments" d={line(comments)} />
      <text x={pad} y={14}>peak {hi.toLocaleString('en-US')}</text>
    </svg>
  )
}
