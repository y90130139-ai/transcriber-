'use client'

import Link from 'next/link'
import { useMemo, useState, type FormEvent } from 'react'
import type { PlanCommunity, PlanData } from '@/lib/reddit/queries'
import type { RequirementProfileStats } from '@/lib/reddit/types'
import { CONFIDENCE_LABEL, eligibility, type UserVerdict } from '@/lib/reddit/requirements'
import { StatusPill, GrowthText, Empty, Skeletons, compact, timeAgo } from './bits'
import { useJson, postJson } from './useReddit'

/** The Today board — the one screen that answers "what do we post, where,
 *  and can our account get in". Ready to post joins the measured gates
 *  with the week-over-week heat; Heating topics carry their hot
 *  communities and a title worth copying. Geno, 2026-10-18: the
 *  marketing-first face of the section. */

const MAX_COMMUNITIES = 10

function heatOf(community: PlanCommunity): number | null {
  if (community.previous_7d > 0) return community.posts_7d / community.previous_7d
  return null
}

/** The gates said in the words a poster would use, never in column names.
 *  Missing means unmeasured — the copy says exactly that. */
function gateWords(community: PlanCommunity): string {
  const parts: string[] = []
  if (community.min_post_karma !== null) parts.push(`${compact(community.min_post_karma)}+ post karma`)
  if (community.min_comment_karma !== null) parts.push(`${compact(community.min_comment_karma)}+ comment karma`)
  if (community.min_age_days !== null) parts.push(`account ${compact(community.min_age_days)}d+ old`)
  if (!parts.length) return 'Posting rules not measured yet'
  return parts.join(' · ')
}

function verdictTitle(verdict: UserVerdict): string {
  if (verdict.overall === 'fits') return 'At or above every gate we have measured'
  if (verdict.overall === 'unknown') return 'Not enough measured gates to judge this account'
  const fails = [
    verdict.post_karma === 'under' ? 'post karma' : null,
    verdict.comment_karma === 'under' ? 'comment karma' : null,
    verdict.age === 'under' ? 'account age' : null,
  ].filter(Boolean)
  return `Below the measured ${fails.join(' · ')}`
}

function ageWords(days: number): string {
  if (days < 90) return `${days} days old`
  return `${(days / 365).toFixed(1)} years old`
}

export default function RedditToday() {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [checking, setChecking] = useState(false)
  const [profile, setProfile] = useState<RequirementProfileStats | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const { data, error, loading, reload } = useJson<PlanData>('/api/reddit/plan')

  const collector = data?.collector
  const collectorTone = !collector ? 'idle'
    : collector.emergency_stop || collector.paused ? 'bad'
    : !collector.last_run_at ? 'idle'
    : collector.last_run_state === 'done' || collector.last_run_state === 'partial' || collector.last_run_state === 'running' ? 'ok'
    : collector.last_run_state === 'stopped' ? 'warn'
    : 'bad'
  const collectorWord = !collector ? 'collector idle'
    : collector.emergency_stop ? 'collector stopped'
    : collector.paused ? 'collector paused'
    : !collector.last_run_at ? 'collector idle'
    : collector.last_run_state === 'done' ? 'collector healthy'
    : collector.last_run_state === 'running' ? 'collecting now'
    : `collector ${collector.last_run_state}`

  const communities = useMemo(() => {
    const rows = [...(data?.communities ?? [])]
    rows.sort((a, b) => {
      const left = heatOf(a)
      const right = heatOf(b)
      if (left === null && right === null) return b.posts_7d - a.posts_7d
      if (left === null) return 1
      if (right === null) return -1
      return right - left || b.posts_7d - a.posts_7d
    })
    return rows.slice(0, MAX_COMMUNITIES)
  }, [data])

  const check = useMemo(() => {
    if (!profile || !data?.communities.length) return null
    const verdicts = new Map(data.communities.map((row) => [row.id, eligibility(profile, row)]))
    let fits = 0
    let unknown = 0
    for (const verdict of verdicts.values()) {
      if (verdict.overall === 'fits') fits += 1
      else if (verdict.overall === 'unknown') unknown += 1
    }
    return { verdicts, fits, unknown, total: data.communities.length }
  }, [profile, data])

  const karma = profile
    ? profile.total_karma ?? (profile.link_karma !== null && profile.comment_karma !== null
      ? profile.link_karma + profile.comment_karma : null)
    : null

  async function refresh() {
    setBusy(true)
    setNotice(null)
    try {
      const body = await postJson<{ result: { state: string; reason?: string; subreddits: number; posts_new: number; mentions: number } }>(
        '/api/reddit/collect', { mode: 'run' },
      )
      const result = body.result
      if (result.state === 'skipped') {
        setNotice(result.reason === 'not-configured'
          ? 'Reddit credentials are not configured.'
          : `The collector is ${result.reason?.replace('-', ' ')}.`)
      } else if (result.subreddits === 0) {
        setNotice('Nothing was due — every community is already on its latest scan.')
      } else {
        setNotice(`${result.posts_new.toLocaleString('en-US')} new posts and ${result.mentions} new mentions from ${result.subreddits} ${result.subreddits === 1 ? 'community' : 'communities'}.`)
      }
      reload()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function checkAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = username.trim().replace(/^\/?u\//i, '')
    if (name.length < 2) {
      setCheckError('Type a username first — the u/ prefix is optional.')
      return
    }
    setChecking(true)
    setCheckError(null)
    try {
      const body = await postJson<{ profile: RequirementProfileStats }>('/api/reddit/requirements/user', { username: name })
      setProfile(body.profile)
    } catch (reason) {
      setProfile(null)
      setCheckError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setChecking(false)
    }
  }

  async function copyTitle(topicId: string, title: string) {
    try {
      await navigator.clipboard.writeText(title)
      setCopied(topicId)
      window.setTimeout(() => setCopied((current) => (current === topicId ? null : current)), 1600)
    } catch {
      setNotice('Could not copy — select the title by hand instead.')
    }
  }

  return (
    <div className="rt-page" aria-busy={loading || busy}>
      <div className="rt-toolbar">
        <div className="rt-toolbar-left">
          <span className="rt-health" data-tone={collectorTone}>
            <i className="rt-beacon" aria-hidden />
            {loading && !data ? 'reading the board' : collectorWord}
          </span>
          {data && <span className="rt-stamp">synced {timeAgo(collector?.last_run_at)}</span>}
        </div>
        <div className="rt-toolbar-right">
          <form className="rt-check" onSubmit={checkAccount}>
            <input className="rt-input" value={username} onChange={(event) => setUsername(event.target.value)}
              placeholder="u/username" aria-label="Reddit account to check against the gates" />
            <button type="submit" className="rt-btn rt-btn-quiet" disabled={checking}>
              {checking ? 'Checking…' : 'Check an account'}
            </button>
          </form>
          <button type="button" className="rt-btn" onClick={refresh} disabled={busy || loading}>
            {busy ? 'Collecting…' : 'Refresh'}
          </button>
        </div>
      </div>

      {notice && <p className="rt-notice">{notice}</p>}
      {checkError && <p className="rt-notice">{checkError}</p>}
      {error && <div className="rt-error"><b>Could not load the board</b><p>{error}</p></div>}

      {profile && (
        <p className="rt-check-line" role="status">
          <b>u/{profile.username}</b>
          <span>{karma === null ? '· karma not visible' : `· ${compact(karma)} combined karma`}</span>
          {profile.age_days !== null && <span>· {ageWords(profile.age_days)}</span>}
          {check && (
            <span>
              · clears <b>{check.fits}</b> of {check.total} communities
              {check.unknown > 0 && ` · ${check.unknown} without enough measured rules`}
            </span>
          )}
          <button type="button" className="rt-copy" onClick={() => { setProfile(null); setUsername('') }}>Clear</button>
        </p>
      )}

      {loading && !data && <Skeletons rows={7} />}

      {data && (
        <>
          <section className="rt-stats rt-stats-4" aria-label="Headline figures">
            <div className="rt-stat" title="Adult communities in the tracked scope">
              <span className="rt-stat-label">Communities tracked</span>
              <b className="rt-stat-value">{compact(data.stats.communities)}</b>
            </div>
            <div className="rt-stat" title="Breakout and rising, from the latest reading">
              <span className="rt-stat-label">Topics heating</span>
              <b className="rt-stat-value">{compact(data.stats.heating)}</b>
            </div>
            <div className="rt-stat" title="Posts first seen in the last 24 hours">
              <span className="rt-stat-label">New posts today</span>
              <b className="rt-stat-value">{compact(data.stats.posts_today)}</b>
            </div>
            <div className="rt-stat" title="Communities whose gates have enough samples to trust">
              <span className="rt-stat-label">Posting rules measured</span>
              <b className="rt-stat-value">{data.stats.measured}/{data.stats.communities}</b>
            </div>
          </section>

          <section className="rt-panel" aria-label="Ready to post">
            <div className="rt-panel-head">
              <h2>Ready to post</h2>
              <span className="rt-panel-sub">where the posting is heaviest right now, and the rules we measured to get in</span>
              <Link className="rt-panel-link" href="/reddit-trends/subreddits">All communities →</Link>
            </div>
            {communities.length ? (
              <ul className="rt-list">
                {communities.map((community) => {
                  const heat = heatOf(community)
                  const verdict = check?.verdicts.get(community.id) ?? null
                  return (
                    <li key={community.id}>
                      <div className="rt-list-row">
                        <Link href={`/reddit-trends/subreddits/${community.id}`} className="rt-list-main">
                          <span className="rt-chipline">
                            <b>r/{community.id}</b>
                            {community.over18 && <i className="rt-tag" data-tone="adult">18+</i>}
                            {community.bot_bouncer === 'yes' && (
                              <i className="rt-status" data-tone="warn"
                                title="This community runs Bot Bouncer — brand-new accounts get screened">bot bouncer</i>
                            )}
                            {verdict && (
                              <i className="rt-status"
                                data-tone={verdict.overall === 'fits' ? 'ok' : verdict.overall === 'under' ? 'bad' : 'idle'}
                                title={verdictTitle(verdict)}>
                                {verdict.overall === 'fits' ? 'account fits' : verdict.overall === 'under' ? 'account under' : 'gates unknown'}
                              </i>
                            )}
                          </span>
                          <span className="rt-dim">
                            {gateWords(community)} · {CONFIDENCE_LABEL[community.confidence]}
                            {community.hot_topics > 0 && ` · ${community.hot_topics} hot topics`}
                          </span>
                        </Link>
                        <span className="rt-list-figs">
                          <b>{heat === null ? (community.posts_7d > 0 ? 'new' : '—') : `${heat.toFixed(1)}×`}</b>
                          <span className="rt-dim">{heat === null ? (community.posts_7d > 0 ? 'no prior week' : 'quiet') : 'vs last week'}</span>
                        </span>
                        <span className="rt-list-figs">
                          <b>{compact(community.posts_7d)}</b>
                          <span className="rt-dim">posts · 7d</span>
                        </span>
                        <a className="rt-link" href={`https://www.reddit.com/r/${community.id}`}
                          target="_blank" rel="noreferrer noopener">Open ↗</a>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Empty title="No communities in scope"
                note="The tracked list and the gates board both build from collection — the Subreddits board shows every community and what the collector last read."
                action={<Link className="rt-link" href="/reddit-trends/subreddits">Open Subreddits →</Link>} />
            )}
          </section>

          <section className="rt-today-sec" aria-label="Heating topics">
            <div className="rt-panel-head">
              <h2>Heating topics → where</h2>
              <span className="rt-panel-sub">rising phrases, the communities driving each one, and a title worth stealing</span>
              <Link className="rt-panel-link" href="/reddit-trends/topics">All topics →</Link>
            </div>
            {data.topics.length ? (
              <div className="rt-columns">
                {data.topics.map((topic) => {
                  const example = topic.example
                  return (
                    <article className="rt-panel" key={topic.id}>
                      <div className="rt-panel-head">
                        <h2><Link href={`/reddit-trends/topics/${topic.id}`}>{topic.name}</Link></h2>
                        <StatusPill status={topic.status} />
                        <GrowthText value={topic.growth} />
                      </div>
                      <p className="rt-hint">
                        {compact(topic.mentions)} mentions · {topic.subreddits} {topic.subreddits === 1 ? 'community' : 'communities'}
                      </p>
                      {topic.communities.length > 0 && (
                        <div className="rt-chipline">
                          {topic.communities.map((entry) => (
                            <Link key={entry.id} className="rt-chip rt-chip-static"
                              href={`/reddit-trends/subreddits/${entry.id}`}>
                              r/{entry.id} · {entry.mentions}
                            </Link>
                          ))}
                        </div>
                      )}
                      {example && (
                        <div className="rt-postline">
                          <p title={example.title}>{example.title}</p>
                          <button type="button" className="rt-copy" data-done={copied === topic.id}
                            onClick={() => copyTitle(topic.id, example.title)}>
                            {copied === topic.id ? 'Copied' : 'Copy title'}
                          </button>
                          {example.permalink && (
                            <a className="rt-link" href={`https://www.reddit.com${example.permalink}`}
                              target="_blank" rel="noreferrer noopener">Open ↗</a>
                          )}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            ) : (
              <Empty title="Nothing is heating yet"
                note="Topics score once enough mentions accumulate across communities — collection fills this in through the day." />
            )}
          </section>
        </>
      )}
    </div>
  )
}
