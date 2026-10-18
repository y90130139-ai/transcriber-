'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import type { ApAccount } from '@/lib/autoposter'
import DropSelect from '../dashboard/DropSelect'
import { Mark, workspaceLabel } from './marks'

/**
 * The composer (Geno, 2026-10-14): one caption, its media, its accounts, and
 * when it goes out — now, into the queue's next slot, or at a date and time.
 * The shape posted is the documented one: one shared original version, the
 * media ids inside, and the platform options Autoposter actually reads
 * (Instagram's post kind, YouTube's required title).
 */

type Mode = 'now' | 'queue' | 'schedule'

const COMMON_ZONES = [
  'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'Asia/Dubai',
  'Asia/Kolkata', 'Australia/Sydney', 'UTC',
]

type Upload = { temp: string; name: string; preview: string; status: 'uploading' | 'ready'; id: number | null }

const MODES: { id: Mode; label: string; note: string }[] = [
  { id: 'now', label: 'Post now', note: 'Publishes the moment Autoposter takes it.' },
  { id: 'queue', label: 'Add to queue', note: 'Drops it into the next free slot of the posting schedule.' },
  { id: 'schedule', label: 'Schedule', note: 'Goes out at the date and time below.' },
]

export default function ComposerTab({ configured, workspaces, initialWorkspace, accounts: initialAccounts, preset }: {
  configured: boolean
  /** Every workspace the token reaches — the workspace rides the form. */
  workspaces: string[]
  initialWorkspace: string | null
  accounts: ApAccount[]
  preset: { date: string } | null
}) {
  const [workspace, setWorkspace] = useState<string | null>(initialWorkspace)
  const [accounts, setAccounts] = useState<ApAccount[]>(initialAccounts)
  const [accountsBusy, setAccountsBusy] = useState(false)
  const [body, setBody] = useState('')
  const [media, setMedia] = useState<Upload[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [mode, setMode] = useState<Mode>('schedule')
  const [date, setDate] = useState(preset?.date ?? '')
  const [time, setTime] = useState('')
  const [instagramType, setInstagramType] = useState<'post' | 'reel' | 'story'>('post')
  const [youtubeTitle, setYoutubeTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [doneId, setDoneId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const localZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return 'UTC'
    }
  }, [])
  const [timezone, setTimezone] = useState(localZone)
  const zones = useMemo(
    () => (COMMON_ZONES.includes(localZone) ? COMMON_ZONES : [localZone, ...COMMON_ZONES]),
    [localZone],
  )

  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selected.includes(account.id)),
    [accounts, selected],
  )
  const wantsInstagram = selectedAccounts.some((account) => account.platform === 'instagram')
  const wantsYoutube = selectedAccounts.some((account) => account.platform === 'youtube')

  function toggle(id: number) {
    setSelected((current) => (current.includes(id) ? current.filter((one) => one !== id) : [...current, id]))
  }

  /** Switch the workspace the post is written into: its accounts are read
   *  back, and the picked accounts reset so a post can never fan out to the
   *  workspace it was not written for. */
  async function pickWorkspace(next: string) {
    setWorkspace(next)
    setSelected([])
    setAccountsBusy(true)
    const response = await fetch(`/api/scheduler/accounts?workspace=${encodeURIComponent(next)}`).catch(() => null)
    const data = (await response?.json().catch(() => ({}))) ?? {}
    setAccounts(Array.isArray((data as { accounts?: unknown }).accounts) ? (data as { accounts: ApAccount[] }).accounts : [])
    if (!response?.ok) setNote({ text: (data as { error?: string }).error ?? 'Could not read that workspace.', bad: true })
    setAccountsBusy(false)
  }

  function removeMedia(temp: string) {
    setMedia((current) => {
      const leaving = current.find((one) => one.temp === temp)
      if (leaving?.preview.startsWith('blob:')) URL.revokeObjectURL(leaving.preview)
      return current.filter((one) => one.temp !== temp)
    })
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      const temp = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setMedia((current) => [
        ...current,
        { temp, name: file.name || 'upload', preview: URL.createObjectURL(file), status: 'uploading', id: null },
      ])
      const form = new FormData()
      form.append('file', file, file.name || 'upload')
      if (workspace) form.append('workspace', workspace)
      const response = await fetch('/api/scheduler/media', { method: 'POST', body: form }).catch(() => null)
      const data = (await response?.json().catch(() => ({}))) ?? {}
      if (!response?.ok || typeof (data as { media?: { id?: number } }).media?.id !== 'number') {
        setNote({
          text: (data as { error?: string }).error ?? `“${file.name}” did not upload — try again.`,
          bad: true,
        })
        setMedia((current) => current.filter((one) => one.temp !== temp))
        continue
      }
      const id = (data as { media: { id: number } }).media.id
      setMedia((current) => current.map((one) => (one.temp === temp ? { ...one, status: 'ready' as const, id } : one)))
    }
  }

  async function submit() {
    if (busy) return
    const readyIds = media.filter((one) => one.status === 'ready' && one.id !== null).map((one) => one.id as number)
    if (selected.length === 0) {
      setNote({ text: 'Pick at least one account.', bad: true })
      return
    }
    if (!body.trim() && readyIds.length === 0) {
      setNote({ text: 'Write a caption or attach media.', bad: true })
      return
    }
    if (wantsYoutube && !youtubeTitle.trim()) {
      setNote({ text: 'YouTube needs a title — add one below.', bad: true })
      return
    }
    if (mode === 'schedule' && (!date || !time)) {
      setNote({ text: 'Pick a date and a time.', bad: true })
      return
    }
    setBusy(true)
    setNote(null)
    setDoneId(null)
    const response = await fetch('/api/scheduler/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace,
        accounts: selected,
        body: body.trim(),
        media: readyIds,
        instagramType: wantsInstagram ? instagramType : undefined,
        youtubeTitle: wantsYoutube ? youtubeTitle.trim() : undefined,
        when: mode === 'schedule' ? { mode, date, time, timezone } : { mode },
      }),
    }).catch(() => null)
    const data = (await response?.json().catch(() => ({}))) ?? {}
    setBusy(false)
    if (!response?.ok) {
      setNote({ text: (data as { error?: string }).error ?? 'That did not post — try again.', bad: true })
      return
    }
    setDoneId((data as { post?: { id?: string } }).post?.id ?? null)
    setBody('')
    setMedia((current) => {
      for (const one of current) {
        if (one.preview.startsWith('blob:')) URL.revokeObjectURL(one.preview)
      }
      return []
    })
    setNote({
      text:
        mode === 'now'
          ? 'Published — Autoposter is taking it from here.'
          : mode === 'queue'
            ? 'In the queue — it goes out in the next free slot.'
            : `Scheduled for ${date} at ${time} — find it on the calendar.`,
    })
  }

  const modeInfo = MODES.find((one) => one.id === mode)
  const said = note && <p className="hint" data-tone={note.bad ? 'bad' : undefined} role="status">{note.text}</p>

  return (
    <div className="dash sc-tab">
      <header className="dash-head">
        <div>
          <p className="dash-kicker">Scheduler</p>
          <h2 className="dash-title">New post</h2>
          <p className="dash-sub">One caption, its media, its accounts — and when it goes out.</p>
        </div>
        <div className="dash-head-tools">
          <Link className="btn btn-small btn-quiet" href="/scheduler">Calendar</Link>
        </div>
      </header>

      {!configured ? (
        <section className="dash-panel">
          <p className="hint" data-tone="bad" role="alert">
            The scheduler is not connected yet — add <code>AUTOPOSTER_TOKEN</code> and{' '}
            <code>AUTOPOSTER_WORKSPACE</code> to the environment, then reload.
          </p>
        </section>
      ) : (
        <div className="sc-form">
          <section className="dash-panel" aria-label="The post">
            <div className="dash-panel-head">
              <h2>The post <span>what goes out</span></h2>
            </div>
            <div className="form-row">
              <label className="axis-name" htmlFor="sc-caption">Caption</label>
              <textarea
                id="sc-caption"
                className="field"
                rows={5}
                maxLength={5000}
                value={body}
                placeholder="Write it once — it fans out to every account below."
                onChange={(event) => setBody(event.target.value)}
              />
              <p className="tpl-hint">{body.trim().length}/5000</p>
            </div>

            <div className="form-row">
              <span className="axis-name">Media</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={(event) => {
                  void uploadFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <div className="sc-media">
                {media.map((one) => (
                  <span className="sc-thumb" key={one.temp} data-status={one.status}>
                    {one.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={one.preview} alt={one.name} />
                    ) : (
                      <span className="sc-thumb-none">{one.name.slice(0, 2).toUpperCase()}</span>
                    )}
                    {one.status === 'uploading' ? <span className="sc-thumb-busy" /> : null}
                    <button
                      type="button"
                      className="sc-thumb-x"
                      title="Remove"
                      aria-label={`Remove ${one.name}`}
                      onClick={() => removeMedia(one.temp)}>
                      ×
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="sc-media-add"
                  title="Attach photos or videos"
                  onClick={() => fileRef.current?.click()}>
                  ＋<span>Attach</span>
                </button>
              </div>
              <p className="tpl-hint">Upload a captioned file for TikTok and Reels — the caption editor only runs in the Autoposter dashboard.</p>
            </div>
          </section>

          <section className="dash-panel" aria-label="Where and when">
            <div className="dash-panel-head">
              <h2>Where &amp; when <span>accounts and schedule</span></h2>
            </div>
            {workspaces.length > 1 ? (
              <div className="form-row">
                <span className="axis-name">Workspace</span>
                <DropSelect
                  label="Workspace"
                  value={workspace ?? ''}
                  onChange={(next) => void pickWorkspace(next)}
                  options={workspaces.map((id) => ({ value: id, label: workspaceLabel(id) }))}
                />
              </div>
            ) : null}
            <div className="form-row">
              <span className="axis-name">Accounts</span>
              {accounts.length === 0 ? (
                <p className="hint">{accountsBusy ? 'Reading that workspace…' : 'No accounts yet — connect them in the Autoposter dashboard.'}</p>
              ) : (
                <div className="sc-picks">
                  {accounts.map((account) => {
                    const on = selected.includes(account.id)
                    return (
                      <button
                        key={account.id}
                        type="button"
                        className="sc-pick"
                        data-on={on || undefined}
                        onClick={() => toggle(account.id)}>
                        <Mark platform={account.platform} name={account.name} />
                        <span className="sc-pick-name">{account.name}</span>
                        <span className="sc-pick-go">{account.platform}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="form-row">
              <span className="axis-name">Go out</span>
              <div className="sc-statuses">
                {MODES.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    className="chip"
                    data-on={mode === one.id || undefined}
                    onClick={() => setMode(one.id)}>
                    {one.label}
                  </button>
                ))}
              </div>
              {modeInfo ? <p className="tpl-hint">{modeInfo.note}</p> : null}
            </div>

            {mode === 'schedule' ? (
              <div className="form-row">
                <span className="axis-name">At</span>
                <div className="sc-when">
                  <input
                    className="field field-inline"
                    type="date"
                    aria-label="Date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                  <input
                    className="field field-inline"
                    type="time"
                    aria-label="Time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                  />
                  <DropSelect label="Timezone" value={timezone} onChange={setTimezone} options={zones.map((zone) => ({ value: zone, label: zone }))} />
                </div>
              </div>
            ) : null}

            {wantsInstagram ? (
              <div className="form-row">
                <span className="axis-name">Instagram as</span>
                <DropSelect
                  label="Instagram post type"
                  value={instagramType}
                  onChange={(next) => setInstagramType(next as 'post' | 'reel' | 'story')}
                  options={[
                    { value: 'post', label: 'Post' },
                    { value: 'reel', label: 'Reel' },
                    { value: 'story', label: 'Story' },
                  ]}
                />
              </div>
            ) : null}

            {wantsYoutube ? (
              <div className="form-row">
                <label className="axis-name" htmlFor="sc-youtube-title">YouTube title</label>
                <input
                  id="sc-youtube-title"
                  className="field"
                  maxLength={100}
                  value={youtubeTitle}
                  placeholder="Morning routine 2026"
                  onChange={(event) => setYoutubeTitle(event.target.value)}
                />
                <p className="tpl-hint">Required when a YouTube account is on the post.</p>
              </div>
            ) : null}
          </section>

          <div className="sc-submit">
            {said}
            <div className="sc-submit-tools">
              {doneId ? (
                <Link
                  className="btn btn-small btn-quiet"
                  href={`/scheduler${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`}>
                  Open the calendar
                </Link>
              ) : null}
              <button type="button" className="btn" disabled={busy} onClick={() => void submit()}>
                {busy
                  ? 'Posting…'
                  : mode === 'now'
                    ? 'Publish now'
                    : mode === 'queue'
                      ? 'Add to queue'
                      : 'Schedule post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
