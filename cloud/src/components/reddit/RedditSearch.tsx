'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { RedditPreferences } from '@/lib/reddit/types'
import type { SearchResult } from '@/lib/reddit/queries'
import Sparkline from '../dashboard/Sparkline'
import { compact, GrowthText, StatusPill, timeAgo } from './bits'
import { putJson, useJson } from './useReddit'

/** Search across everything collected — titles, topics, communities,
 *  mentions — with saved searches kept in the owner's preferences. */
export default function RedditSearch() {
  const initial = useSearchParams().get('q') ?? ''
  const [query, setQuery] = useState(initial)
  const [debounced, setDebounced] = useState(initial)
  const [saveName, setSaveName] = useState('')
  const [savedNotice, setSavedNotice] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const { data, error, loading } = useJson<SearchResult>(
    debounced.length >= 2 ? `/api/reddit/search?q=${encodeURIComponent(debounced)}` : null,
  )
  const prefs = useJson<RedditPreferences>('/api/reddit/preferences')

  async function saveSearch() {
    if (!saveName.trim() || debounced.length < 2) return
    const current = prefs.data?.saved_searches ?? []
    try {
      await putJson('/api/reddit/preferences', {
        saved_searches: [...current, { name: saveName.trim(), query: debounced, kinds: [] }].slice(-30),
      })
      setSavedNotice(`Saved “${saveName.trim()}”.`)
      setSaveName('')
      prefs.reload()
    } catch (reason) {
      setSavedNotice(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className="rt-page">
      <div className="rt-toolbar">
        <form className="rt-searchform rt-searchform-wide" onSubmit={(event) => event.preventDefault()}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search collected posts, topics, subreddits…" aria-label="Search" />
        </form>
        <div className="rt-toolbar-right">
          <input className="rt-input" value={saveName} onChange={(event) => setSaveName(event.target.value)}
            placeholder="Save this search as…" aria-label="Save search name" />
          <button type="button" className="rt-btn rt-btn-quiet" disabled={!saveName.trim() || debounced.length < 2}
            onClick={saveSearch}>
            Save search
          </button>
        </div>
      </div>

      {savedNotice && <p className="rt-notice">{savedNotice}</p>}

      {(prefs.data?.saved_searches ?? []).length > 0 && (
        <div className="rt-chipline">
          <span className="rt-section-label">Saved</span>
          {(prefs.data?.saved_searches ?? []).map((saved, index) => (
            <button key={`${saved.name}-${index}`} type="button" className="rt-chip"
              onClick={() => { setQuery(saved.query); setDebounced(saved.query) }}>
              {saved.name}
            </button>
          ))}
        </div>
      )}

      {error && <div className="rt-error"><b>Search failed</b><p>{error}</p></div>}

      {data && (
        <>
          <p className="rt-resultline">
            {data.counts.posts} posts · {data.counts.topics} topics · {data.counts.subreddits} subreddits
            · {data.counts.mentions} mentions
          </p>

          {data.topics.length > 0 && (
            <section className="rt-panel">
              <div className="rt-panel-head"><h2>Topics</h2></div>
              <div className="rt-topicgrid">
                {data.topics.map((topic) => (
                  <Link className="rt-topiccard" key={topic.id} href={`/reddit-trends/topics/${topic.id}`}>
                    <div className="rt-topiccard-top"><b>{topic.name}</b><StatusPill status={topic.status} /></div>
                    <div className="rt-topiccard-figs">
                      <span><i>Interest</i><b>{topic.interest === null ? '—' : topic.interest.toFixed(1)}</b></span>
                      <span><i>24h</i><b><GrowthText value={topic.growth} /></b></span>
                      <span><i>Mentions</i><b>{topic.mentions}</b></span>
                    </div>
                    <div className="rt-topiccard-foot">
                      <Sparkline values={topic.spark} width={120} height={26} area />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {data.subreddits.length > 0 && (
            <section className="rt-panel">
              <div className="rt-panel-head"><h2>Subreddits</h2></div>
              <ul className="rt-list">
                {data.subreddits.map((sub) => (
                  <li key={sub.id}>
                    <Link href={`/reddit-trends/subreddits/${sub.id}`} className="rt-list-row">
                      <span className="rt-list-main"><b>r/{sub.display_name}</b><span className="rt-dim">{sub.category}</span></span>
                      <span className="rt-list-figs"><b>{compact(sub.posts_collected)}</b><span className="rt-dim">posts</span></span>
                      <i className="rt-status" data-tone={sub.status === 'active' ? 'ok' : 'idle'}>{sub.status}</i>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.posts.length > 0 && (
            <section className="rt-panel">
              <div className="rt-panel-head">
                <h2>Posts</h2>
                <span className="rt-panel-sub">Top {data.posts.length} by score</span>
              </div>
              <ul className="rt-list">
                {data.posts.map((post) => (
                  <li key={post.id}>
                    <a href={post.permalink ?? '#'} target="_blank" rel="noreferrer noopener" className="rt-list-row">
                      <span className="rt-list-main">
                        <b className="rt-clamp">{post.title}</b>
                        <span className="rt-dim">r/{post.subreddit} · {timeAgo(post.created_utc)}</span>
                      </span>
                      <span className="rt-list-figs"><b>{compact(post.score)}</b><span className="rt-dim">score</span></span>
                      <span className="rt-list-figs"><b>{compact(post.comments)}</b><span className="rt-dim">comments</span></span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.mentions.length > 0 && (
            <section className="rt-panel">
              <div className="rt-panel-head"><h2>Topic mentions</h2></div>
              <ul className="rt-list">
                {data.mentions.map((mention) => (
                  <li key={`${mention.post_id}-${mention.topic_id}`} className="rt-list-row">
                    <span className="rt-list-main">
                      <b className="rt-clamp">{mention.title}</b>
                      <span className="rt-dim">r/{mention.subreddit} · {timeAgo(mention.created_utc)}</span>
                    </span>
                    <Link className="rt-link" href={`/reddit-trends/topics/${mention.topic_id}`}>{mention.topic_name}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!loading && !data.posts.length && !data.topics.length && !data.subreddits.length && !data.mentions.length && (
            <div className="rt-empty"><b>No matches</b></div>
          )}
        </>
      )}

      {!data && !error && debounced.length >= 2 && loading && <div className="rt-skel"><i /><i /><i /></div>}
      {debounced.length < 2 && <div className="rt-empty"><b>Type at least two characters</b></div>}
    </div>
  )
}
