'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  OAuthAccountStatus,
  RequirementProfileStats,
  RequirementRow,
  RequirementSource,
  SubredditList,
} from '@/lib/reddit/types'
import {
  CONFIDENCE_LABEL,
  CONFIDENCE_NOTE,
  eligibility,
  type UserVerdict,
} from '@/lib/reddit/requirements'
import DropSelect from '../dashboard/DropSelect'
import { compact, timeAgo, untilLabel } from './bits'
import { useJson } from './useReddit'
import type { RequirementBoardMeta } from '@/lib/reddit/queries'

type BoardPayload = {
  rows: RequirementRow[]
  meta: RequirementBoardMeta
  lists: SubredditList[]
  oauth: OAuthAccountStatus
  settings: { requirements_interval_minutes: number; requirements_enabled: boolean }
  categories: readonly string[]
}

type SortKey =
  | 'name' | 'subscribers' | 'min_post_karma' | 'min_comment_karma' | 'min_age_days'
  | 'avg_total_karma' | 'posts_per_day' | 'confidence' | 'bot_bouncer'

const CONFIDENCE_TONE: Record<string, string> = {
  verified: 'ok', high: 'ok', medium: 'idle', low: 'warn', insufficient: 'idle',
}

const BOT_BOUNCER_LABEL: Record<string, string> = {
  yes: 'Installed', no: 'No', unknown: 'Unknown',
}

/** How the board explains each column in its header tooltip. Kept next to
 *  the columns so copy and data cannot drift. */
const COLUMN_HELP: Partial<Record<SortKey | 'sources', string>> = {
  subscribers: 'Subscribers as Reddit reports them on the community card',
  min_post_karma: 'Lowest post karma seen among recently surviving posts — the gate must be at or below it',
  min_comment_karma: 'Lowest comment karma seen among recently surviving posts',
  min_age_days: 'Shortest account age (at posting) seen among recently surviving posts',
  avg_total_karma: 'Average combined karma of the sampled surviving posters',
  posts_per_day: 'New posts per day, extrapolated from the sampled listing window',
  sources: 'The posts this estimate rests on — lowest-karma survivors and AutoMod-filtered samples',
  confidence: 'How much data backs these numbers, and whether the bounds held across passes',
  bot_bouncer: 'Whether the Bot Bouncer moderation app is installed on the community',
}

/** Subreddits Requirements — the posting-gate board. Every figure is read
 *  from sampled posters' own account stats through the governed Reddit
 *  client; nothing is fabricated and every bound links back to its post. */
export default function RedditRequirements() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [botBouncer, setBotBouncer] = useState<'all' | 'with' | 'without'>('all')
  const [nsfw, setNsfw] = useState(true)
  const [listId, setListId] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'subscribers', dir: 'desc' })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [listName, setListName] = useState('')
  const [profile, setProfile] = useState<RequirementProfileStats | null>(null)
  const [profileName, setProfileName] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [onlyFits, setOnlyFits] = useState(false)

  const params = new URLSearchParams()
  if (category) params.set('category', category)
  if (botBouncer !== 'all') params.set('botBouncer', botBouncer)
  if (!nsfw) params.set('nsfw', '0')
  if (listId) params.set('list', listId)
  const url = `/api/reddit/requirements?${params.toString()}`
  const { data, error, loading, reload } = useJson<BoardPayload>(url)

  // The OAuth callback returns here with its verdict in the query string.
  useEffect(() => {
    const incoming = new URLSearchParams(window.location.search)
    if (incoming.get('connected')) {
      setNotice('Reddit account connected — Bot Bouncer checks will run on the next pass')
      window.history.replaceState(null, '', window.location.pathname)
    } else if (incoming.get('connect_error')) {
      const reason = incoming.get('connect_error')
      setNotice(reason === 'state-mismatch'
        ? 'Connection failed: the consent response did not match this browser session'
        : `Connection failed: ${reason}`)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const activeList = data?.lists.find((list) => list.id === listId) ?? null

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase().replace(/^\/?r\//, '')
    let out = (data?.rows ?? []).filter((row) =>
      needle ? row.id.includes(needle) || (row.display_name ?? '').toLowerCase().includes(needle) : true)
    if (profile && onlyFits) {
      out = out.filter((row) => eligibility(profile, row).overall !== 'under')
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    const value = (row: RequirementRow): number | string | null => {
      switch (sort.key) {
        case 'name': return row.id
        case 'confidence': return confidenceRank(row.confidence)
        case 'bot_bouncer': return row.bot_bouncer
        default: return row[sort.key] ?? null
      }
    }
    return [...out].sort((a, b) => {
      const left = value(a)
      const right = value(b)
      if (left === null && right === null) return a.id.localeCompare(b.id)
      if (left === null) return 1
      if (right === null) return -1
      if (typeof left === 'string' || typeof right === 'string') {
        return dir * String(left).localeCompare(String(right))
      }
      return dir * (left - right)
    })
  }, [data, search, profile, onlyFits, sort])

  const addCandidate = useMemo(() => {
    const needle = search.trim().toLowerCase().replace(/^\/?r\//, '').replace(/[^a-z0-9_]/g, '')
    if (needle.length < 2 || needle.length > 21) return null
    if ((data?.rows ?? []).some((row) => row.id === needle)) return null
    return needle
  }, [search, data])

  function toggleSort(key: SortKey) {
    setSort((current) => current.key === key
      ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' })
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function call(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const parsed = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(parsed?.error ?? `Request failed (${response.status})`)
      return parsed
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
      throw reason
    } finally {
      setBusy(false)
    }
  }

  async function addSubreddit(name: string) {
    setAdding(true)
    try {
      await call('/api/reddit/requirements', 'POST', { input: name })
      setNotice(`r/${name} added — the next collection pass will prove it exists and start sampling`)
      setSearch('')
      reload()
    } catch { /* notice set */ } finally {
      setAdding(false)
    }
  }

  async function collectNow() {
    try {
      const body = await call('/api/reddit/requirements/collect', 'POST')
      const result = body?.result as { subreddits?: number; samples_new?: number; judged?: number; reason?: string } | undefined
      setNotice(result
        ? `Requirements pass: ${result.subreddits ?? 0} communities, ${result.samples_new ?? 0} new samples, ${result.judged ?? 0} judged${result.reason ? ` (${result.reason})` : ''}`
        : 'Requirements pass finished')
      reload()
    } catch { /* notice set */ }
  }

  async function checkUser() {
    const username = profileName.trim()
    if (username.length < 2) return
    setProfileBusy(true)
    setProfileError(null)
    try {
      const response = await fetch('/api/reddit/requirements/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`)
      setProfile(body.profile as RequirementProfileStats)
      setOnlyFits(false)
    } catch (reason) {
      setProfile(null)
      setProfileError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setProfileBusy(false)
    }
  }

  async function createList() {
    const name = listName.trim()
    if (name.length < 2) return
    try {
      const body = await call('/api/reddit/requirements', 'PATCH', {
        action: 'list',
        name,
        subreddits: rows.map((row) => row.id),
      })
      const list = body?.list as SubredditList | undefined
      setNotice(`List "${name}" saved with ${list?.items.length ?? 0} communities`)
      setListName('')
      setListOpen(false)
      if (list) setListId(list.id)
      reload()
    } catch { /* notice set */ }
  }

  async function removeList() {
    if (!activeList) return
    if (!window.confirm(`Delete the list "${activeList.name}"? The communities themselves stay on the board.`)) return
    try {
      await fetch(`/api/reddit/lists?id=${encodeURIComponent(activeList.id)}`, { method: 'DELETE' })
      setListId('')
      setNotice(`List "${activeList.name}" deleted`)
      reload()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function toggleListItem(row: RequirementRow) {
    if (!activeList) return
    const inList = activeList.items.includes(row.id)
    try {
      await call('/api/reddit/lists', 'PATCH', {
        id: activeList.id,
        add: inList ? [] : [row.id],
        remove: inList ? [row.id] : [],
      })
      reload()
    } catch { /* notice set */ }
  }

  function showAll() {
    setSearch('')
    setCategory('')
    setBotBouncer('all')
    setNsfw(true)
    setListId('')
    setOnlyFits(false)
  }

  const meta = data?.meta
  const filtersActive = Boolean(search || category || botBouncer !== 'all' || !nsfw || listId)

  return (
    <div className="rt-page">
      <section className="rt-reqabout">
        <h2 className="rt-section-label">Requirements for posting in subreddits</h2>
        <p className="rt-desc">
          Observed, not published: these figures are measured from the accounts of users who actually posted —
          their post and comment karma and their account age at posting time — through Reddit&apos;s API.
          Reddit does not expose the gates themselves, so each minimum is the lowest reading seen survive; a
          filtered author is evidence the gate sits above theirs. <b>No data</b> means not enough samples yet, never zero.
        </p>
        <p className="rt-dim rt-reqmeta">
          {meta ? `${meta.total} communities · ${meta.with_bot_bouncer} with Bot Bouncer · ${meta.without_bot_bouncer} without · ${meta.unknown_bot_bouncer} unknown` : 'loading…'}
          {meta?.last_updated ? ` · last collected ${timeAgo(meta.last_updated)}` : ''}
          {meta?.next_due_at ? ` · next scan ${untilLabel(meta.next_due_at)}` : ''}
        </p>
      </section>

      {notice && <p className="rt-notice">{notice}</p>}
      {error && <div className="rt-error"><b>Could not load the requirements board</b><p>{error}</p></div>}

      {data && !data.oauth.connected && data.meta.unknown_bot_bouncer > 0 && (
        <div className="rt-reqconnect">
          <span>
            Bot Bouncer status is unknown for {data.meta.unknown_bot_bouncer} communities. Reddit refuses moderator
            lists to app-only tokens, so connect a Reddit account (read scope only) and the collector will fill the column.
          </span>
          <a className="rt-btn" href="/api/reddit/oauth?action=start">Connect Reddit account</a>
        </div>
      )}
      {data?.oauth.connected && (
        <p className="rt-dim rt-reqmeta">
          Bot Bouncer checks run as u/{data.oauth.username}
          {data.oauth.last_ok_at ? ` · last check ${timeAgo(data.oauth.last_ok_at)}` : ''}
          {data.oauth.last_error ? ` · last error: ${data.oauth.last_error}` : ''}
          {' · '}
          <button type="button" className="rt-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
            onClick={async () => {
              await fetch('/api/reddit/oauth', { method: 'DELETE' })
              setNotice('Reddit account disconnected — existing statuses stay as last observed')
              reload()
            }}>
            disconnect
          </button>
        </p>
      )}

      <div className="rt-toolbar rt-reqcontrols">
        <div className="rt-reqgroup">
          <label className="rt-switch">
            <input type="checkbox" checked={nsfw} onChange={(event) => setNsfw(event.target.checked)} />
            Display nsfw subreddits
          </label>

          <form className="rt-searchform rt-reqsearch" onSubmit={(event) => { event.preventDefault(); void checkUser() }}>
            <span className="rt-reqprefix" aria-hidden>u/</span>
            <input value={profileName} onChange={(event) => setProfileName(event.target.value)}
              placeholder="Enter a username" aria-label="Reddit username to check" />
            <button type="submit" className="rt-mini" disabled={profileBusy || profileName.trim().length < 2}>
              {profileBusy ? 'Checking…' : 'Check'}
            </button>
          </form>

          <form className="rt-searchform rt-reqsearch" onSubmit={(event) => event.preventDefault()}>
            <span className="rt-reqprefix" aria-hidden>r/</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Search subreddits" aria-label="Search subreddits" />
          </form>

          <DropSelect className="rt-dd" label="Filter by tag" value={category} onChange={setCategory}
            options={[{ value: '', label: 'Search by tags — all' },
              ...(data?.meta.categories ?? []).map((option) => ({ value: option, label: option }))]} />
        </div>

        <div className="rt-reqgroup">
          <div className="rt-toggle" role="group" aria-label="Bot Bouncer filter">
            {([['all', 'All subreddits'], ['with', 'With Bot Bouncer'], ['without', 'Without Bot Bouncer']] as const).map(([value, label]) => (
              <button key={value} type="button" data-on={botBouncer === value} onClick={() => setBotBouncer(value)}>
                {label}
              </button>
            ))}
          </div>
          <DropSelect className="rt-dd" label="Saved list" value={listId} onChange={setListId}
            options={[{ value: '', label: 'All rows' }, ...(data?.lists ?? []).map((list) => ({ value: list.id, label: `${list.name} · ${list.items.length}` }))]} />
          {activeList && (
            <button type="button" className="rt-mini" data-tone="danger" onClick={removeList} disabled={busy} title="Delete this list">✕</button>
          )}
          <button type="button" className="rt-btn" onClick={() => setListOpen((open) => !open)}>+ New List</button>
          <button type="button" className="rt-btn rt-btn-quiet" onClick={showAll} disabled={!filtersActive && !profile}>Show All</button>
          <button type="button" className="rt-btn" onClick={collectNow} disabled={busy}>
            {busy ? 'Collecting…' : 'Collect now'}
          </button>
        </div>
      </div>

      {addCandidate && (
        <div className="rt-chipline">
          <button type="button" className="rt-chip" disabled={adding} onClick={() => addSubreddit(addCandidate)}>
            + Add r/{addCandidate} to the board
          </button>
        </div>
      )}

      {listOpen && (
        <section className="rt-panel rt-addpanel">
          <div className="rt-addrow">
            <input className="rt-input rt-input-wide" autoFocus value={listName}
              onChange={(event) => setListName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && listName.trim().length >= 2) void createList() }}
              placeholder="List name — e.g. Warm-up accounts week 1" aria-label="List name" />
            <button type="button" className="rt-btn" disabled={busy || listName.trim().length < 2} onClick={createList}>
              Save {rows.length} shown
            </button>
          </div>
          <p className="rt-field-hint">
            A list is a saved slice of the board. Create it from what the filters show now, then reopen it any time;
            rows can be added or removed while a list is active.
          </p>
        </section>
      )}

      {profileError && <p className="rt-error-inline">{profileError}</p>}

      {profile && (
        <div className="rt-requserbar">
          <b>u/{profile.username}</b>
          <span className="rt-dim">
            {profile.link_karma === null ? '—' : `${compact(profile.link_karma)} post karma`}
            {' · '}
            {profile.comment_karma === null ? '—' : `${compact(profile.comment_karma)} comment karma`}
            {' · '}
            {profile.age_days === null ? 'age unknown' : `${profile.age_days}d old`}
            {' · read '}{timeAgo(profile.fetched_at)}
          </span>
          <label className="rt-switch">
            <input type="checkbox" checked={onlyFits} onChange={(event) => setOnlyFits(event.target.checked)} />
            Only rows this account clears
          </label>
          <button type="button" className="rt-mini" onClick={() => { setProfile(null); setProfileName(''); setOnlyFits(false) }}>Clear</button>
        </div>
      )}

      <div className="rt-tablewrap">
        <table className="rt-table rt-reqtable">
          <thead>
            <tr>
              <th>
                <SortHeader label="Name" help={undefined} sortKey="name" sort={sort} onSort={toggleSort} />
              </th>
              <th className="rt-col-num"><SortHeader label="Subscribers" help={COLUMN_HELP.subscribers} sortKey="subscribers" sort={sort} onSort={toggleSort} /></th>
              <th className="rt-col-num"><SortHeader label="Min. post karma" help={COLUMN_HELP.min_post_karma} sortKey="min_post_karma" sort={sort} onSort={toggleSort} /></th>
              <th className="rt-col-num"><SortHeader label="Min. comment karma" help={COLUMN_HELP.min_comment_karma} sortKey="min_comment_karma" sort={sort} onSort={toggleSort} /></th>
              <th className="rt-col-num"><SortHeader label="Min. age" help={COLUMN_HELP.min_age_days} sortKey="min_age_days" sort={sort} onSort={toggleSort} /></th>
              <th className="rt-col-num"><SortHeader label="Avg. karma 🔥" help={COLUMN_HELP.avg_total_karma} sortKey="avg_total_karma" sort={sort} onSort={toggleSort} /></th>
              <th className="rt-col-num"><SortHeader label="Posts / day" help={COLUMN_HELP.posts_per_day} sortKey="posts_per_day" sort={sort} onSort={toggleSort} /></th>
              <th><HeaderHelp label="Source links" help={COLUMN_HELP.sources} /></th>
              <th><SortHeader label="Verification" help={COLUMN_HELP.confidence} sortKey="confidence" sort={sort} onSort={toggleSort} /></th>
              <th><SortHeader label="Bot Bouncer" help={COLUMN_HELP.bot_bouncer} sortKey="bot_bouncer" sort={sort} onSort={toggleSort} /></th>
              {profile && <th>u/{profile.username}</th>}
              <th className="rt-col-num">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const verdict = profile ? eligibility(profile, row) : null
              const sources = row.sources ?? []
              const open = expanded.has(row.id)
              return (
                <RequirementsRowFragment
                  key={row.id}
                  row={row}
                  verdict={verdict}
                  sources={sources}
                  open={open}
                  busy={busy}
                  inList={activeList ? activeList.items.includes(row.id) : null}
                  onToggleSources={() => toggleExpanded(row.id)}
                  onDue={async () => {
                    await call('/api/reddit/requirements', 'PATCH', { action: 'due', id: row.id })
                    setNotice(`r/${row.display_name} queued for the next collection pass`)
                    reload()
                  }}
                  onToggleList={() => toggleListItem(row)}
                  onRemove={async () => {
                    if (!window.confirm(`Remove r/${row.display_name} and its samples from the board?`)) return
                    await fetch(`/api/reddit/requirements?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
                    setNotice(`r/${row.display_name} removed`)
                    reload()
                  }}
                />
              )
            })}
            {loading && !data && Array.from({ length: 7 }, (_, index) => (
              <tr key={index}><td colSpan={profile ? 12 : 11}><div className="rt-skel"><i /></div></td></tr>
            ))}
            {!loading && !rows.length && (
              <tr>
                <td colSpan={profile ? 12 : 11} className="rt-hint">
                  {filtersActive
                    ? 'No communities match these filters — Show All clears them.'
                    : 'No communities on the board yet. Add one above or run a collection pass.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="rt-dim rt-reqfoot">
        Estimates improve as sampling continues ({data?.settings.requirements_interval_minutes ?? 1440} min cadence per
        community); a verified label means the same bounds held across three or more passes. Estimates are upper bounds —
        an account at or above them has matched everyone observed surviving.
      </p>
    </div>
  )
}

function confidenceRank(confidence: string): number {
  return { insufficient: 0, low: 1, medium: 2, high: 3, verified: 4 }[confidence] ?? 0
}

function HeaderHelp({ label, help }: { label: string; help?: string }) {
  return (
    <span className="rt-reqhead">
      {label}
      {help && <span className="rt-reqhelp" title={help} aria-label={help} role="img">?</span>}
    </span>
  )
}

function SortHeader({
  label, help, sortKey, sort, onSort,
}: {
  label: string
  help?: string
  sortKey: SortKey
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (key: SortKey) => void
}) {
  const on = sort.key === sortKey
  return (
    <span className="rt-reqhead">
      <button type="button" className="rt-sortbtn" data-on={on}
        aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
        onClick={() => onSort(sortKey)}>
        {label}{on ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
      {help && <span className="rt-reqhelp" title={help} aria-label={help} role="img">?</span>}
    </span>
  )
}

function RequirementsRowFragment({
  row, verdict, sources, open, busy, inList, onToggleSources, onDue, onToggleList, onRemove,
}: {
  row: RequirementRow
  verdict: UserVerdict | null
  sources: RequirementSource[]
  open: boolean
  busy: boolean
  inList: boolean | null
  onToggleSources: () => void
  onDue: () => void
  onToggleList: () => void
  onRemove: () => void
}) {
  const number = (value: number | null, format: (value: number) => string = compact) =>
    value === null ? <span className="rt-dim">—</span> : format(value)

  return (
    <>
      <tr>
        <td>
          <a className="rt-link rt-reqname" href={`https://www.reddit.com/r/${row.id}/`} target="_blank" rel="noreferrer">
            r/{row.display_name}
          </a>
          {row.over18 && <i className="rt-tag" data-tone="adult">18+</i>}
          <div className="rt-dim rt-reqsub">{row.category} · sampled {row.sample_count}</div>
        </td>
        <td className="rt-col-num">{number(row.subscribers)}</td>
        <td className="rt-col-num">{number(row.min_post_karma)}</td>
        <td className="rt-col-num">{number(row.min_comment_karma)}</td>
        <td className="rt-col-num">{row.min_age_days === null ? <span className="rt-dim">—</span> : `${row.min_age_days}d`}</td>
        <td className="rt-col-num">{number(row.avg_total_karma)}</td>
        <td className="rt-col-num">{row.posts_per_day === null ? <span className="rt-dim">—</span> : row.posts_per_day.toFixed(1)}</td>
        <td>
          {sources.length
            ? <button type="button" className="rt-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                onClick={onToggleSources} aria-expanded={open}>
                {sources.length} link{sources.length === 1 ? '' : 's'}
              </button>
            : <span className="rt-dim">—</span>}
        </td>
        <td>
          <i className="rt-status" data-tone={CONFIDENCE_TONE[row.confidence] ?? 'idle'}
            title={`${CONFIDENCE_NOTE[row.confidence]} · ${row.survivor_count} survivors, ${row.filtered_count} filtered, ${row.profile_count} profiled`}>
            {CONFIDENCE_LABEL[row.confidence]}
          </i>
        </td>
        <td>
          <i className="rt-status" data-tone={row.bot_bouncer === 'yes' ? 'bad' : row.bot_bouncer === 'no' ? 'ok' : 'idle'}
            title={row.bot_bouncer === 'unknown'
              ? 'Not checked yet — connect a Reddit account so installed apps can be read from moderator lists'
              : row.bot_bouncer_source === 'modlist' ? 'Detected via the moderator list, where installed apps appear' : 'Manually recorded'}>
            {BOT_BOUNCER_LABEL[row.bot_bouncer]}
          </i>
        </td>
        {verdict && (
          <td>
            <i className="rt-reqverdict" data-verdict={verdict.overall}
              title={`post karma: ${verdictText(verdict.post_karma)} · comment karma: ${verdictText(verdict.comment_karma)} · age: ${verdictText(verdict.age)}`}>
              {verdict.overall === 'fits' ? 'Clears' : verdict.overall === 'under' ? 'Under' : 'Unknown'}
            </i>
          </td>
        )}
        <td className="rt-col-num">
          <span className="rt-actions">
            {inList !== null && (
              <button type="button" className="rt-mini" disabled={busy} onClick={onToggleList}>
                {inList ? 'Remove' : '+ List'}
              </button>
            )}
            <button type="button" className="rt-mini" disabled={busy} onClick={onDue} title="Sample this community on the next pass">Update</button>
            <button type="button" className="rt-mini" data-tone="danger" disabled={busy} onClick={onRemove}>Remove</button>
          </span>
        </td>
      </tr>
      {open && (
        <tr className="rt-reqexpand">
          <td colSpan={verdict ? 12 : 11}>
            {sources.length === 0 && <span className="rt-dim">No samples recorded yet.</span>}
            <ul className="rt-list">
              {sources.map((source) => (
                <li key={source.post_id} className="rt-list-row">
                  <i className="rt-status" data-tone={source.outcome === 'filtered' ? 'bad' : source.outcome === 'survived' ? 'ok' : 'idle'}>
                    {source.outcome}
                  </i>
                  <span className="rt-list-main">
                    <b>u/{source.author ?? 'deleted'}</b>
                    <span className="rt-dim">
                      {source.link_karma === null ? 'karma unknown' : `${compact(source.link_karma)} post · ${compact(source.comment_karma ?? 0)} comment karma`}
                      {source.account_age_days === null ? '' : ` · ${source.account_age_days}d old at posting`}
                      {' · '}{timeAgo(source.post_created_utc)}
                    </span>
                  </span>
                  {source.permalink && (
                    <a className="rt-link" href={source.permalink} target="_blank" rel="noreferrer">open post</a>
                  )}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
}

function verdictText(verdict: string): string {
  return verdict === 'ok' ? 'clears' : verdict === 'under' ? 'under estimate' : 'unknown'
}
