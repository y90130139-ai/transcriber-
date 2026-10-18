'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import type { AppAccountDetail } from '@/lib/app-accounts'
import type { ActivityEvent } from '@/lib/app-activity'
import { ago } from '@/lib/format'
import { labelOf } from '@/lib/taxonomy'
import Avatar from '../dashboard/Avatar'
import DropSelect from '../dashboard/DropSelect'
import { Icon, type IconName } from '../console/ConsoleIcons'

/**
 * One creator's app account (Geno, 2026-10-14).
 *
 * Layout, per the brief: the console rail, then a second slim rail on this
 * page that switches the tabs — Activity, Contracts, Notifications, Forms,
 * and Settings. The first four are read-only: what she did and what she
 * filled; the one composer sends her a push. Settings is the page's one
 * write — it shows the model this account is attached to and links it when
 * it is not attached to one (2026-10-14). Inter only — the page sets both
 * font vars to the Inter face.
 */

type Tab = 'activity' | 'contracts' | 'notifications' | 'forms' | 'settings'

const SUBTABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'activity', label: 'Activity', icon: 'trending' },
  { id: 'contracts', label: 'Contracts', icon: 'copy' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'forms', label: 'Forms', icon: 'type' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

const STATUS_LABEL: Record<'invited' | 'active' | 'disabled', string> = {
  invited: 'Invited',
  active: 'Active',
  disabled: 'Disabled',
}

const KIND_ICON: Record<ActivityEvent['kind'], IconName> = {
  signin: 'userCheck',
  plan_open: 'eye',
  discover: 'sparkles',
  invite: 'mail',
  activated: 'userCheck',
  week_sent: 'calendar',
  week_opened: 'eye',
  accepted: 'checkCircle',
  declined: 'x',
  filmed: 'video',
  made: 'play',
  take: 'upload',
  message: 'chat',
  inbox: 'chat',
  note_read: 'eye',
  survey: 'list',
  device: 'bell',
  intake: 'folder',
  tour: 'sparkles',
  onboarding: 'checkCircle',
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const TIME_LABEL: Record<string, string> = {
  morning: 'Mornings', midday: 'Midday', afternoon: 'Afternoons', evening: 'Evenings', late: 'Late nights',
}
const BUSY_LABEL: Record<string, string> = {
  ahead: 'Stays ahead of the week',
  catchup: 'Catches up when behind',
  skip: 'Skips a busy week',
}

const CONTACT_LABELS: [string, string][] = [
  ['name', 'Full name'], ['email', 'Email'], ['phone', 'Phone'],
  ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['x', 'X / Twitter'], ['country', 'Country'],
]
const INTAKE_LABELS: [string, string][] = [
  ['name', 'Full legal name'], ['birthday', 'Date of birth'], ['city', 'City & country'],
  ['languages', 'Languages'], ['boundaries', 'Content boundaries'], ['notes', 'Anything else'],
]

type DayGroup = { key: string; label: string; events: ActivityEvent[] }

function groupByDay(events: ActivityEvent[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const event of events) {
    const at = new Date(event.at)
    const key = format(at, 'yyyy-MM-dd')
    const label = isToday(at) ? 'Today' : isYesterday(at) ? 'Yesterday' : format(at, 'd MMM yyyy')
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.events.push(event)
    else groups.push({ key, label, events: [event] })
  }
  return groups
}

/** Her questionnaire answers, in the console's reading order. */
function answerRows(answers: Record<string, unknown>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  const n = (value: unknown) => (typeof value === 'number' ? value : null)

  const perDay = n(answers.per_day)
  const weekly = n(answers.weekly)
  if (weekly !== null) rows.push({ label: 'Reels she will make', value: `${weekly} a week` })
  if (perDay !== null) rows.push({ label: 'A day at most', value: String(perDay) })

  if (Array.isArray(answers.days)) {
    const days = (answers.days as unknown[])
      .map((d) => (typeof d === 'number' && DAY_NAMES[d] ? DAY_NAMES[d] : null))
      .filter((d): d is string => d !== null)
    if (days.length) rows.push({ label: 'Filming days', value: days.join(', ') })
  }
  if (Array.isArray(answers.times)) {
    const times = (answers.times as unknown[])
      .map((t) => (typeof t === 'string' ? TIME_LABEL[t] ?? t : null))
      .filter((t): t is string => t !== null)
    if (times.length) rows.push({ label: 'Best times', value: times.join(' · ') })
  }
  const labels = (axis: 'format' | 'persona', value: unknown): string | null => {
    if (!Array.isArray(value) || value.length === 0) return null
    return (value as unknown[])
      .map((tag) => (typeof tag === 'string' ? labelOf(axis, tag) : null))
      .filter((tag): tag is string => tag !== null)
      .join(', ')
  }
  const formats = labels('format', answers.formats)
  if (formats) rows.push({ label: 'She makes', value: formats })
  const wont = labels('format', answers.wont)
  if (wont) rows.push({ label: 'Won’t do', value: wont })
  const personas = labels('persona', answers.personas)
  if (personas) rows.push({ label: 'Sounds like', value: personas })
  if (typeof answers.busy === 'string') {
    rows.push({ label: 'A busy week', value: BUSY_LABEL[answers.busy] ?? answers.busy })
  }
  return rows
}

/** One form payload as read-only rows; unknown keys are skipped. */
function valueRows(data: Record<string, unknown>, map: [string, string][]): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  for (const [key, label] of map) {
    const raw = data[key]
    const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : ''
    if (value) rows.push({ label, value })
  }
  return rows
}

function Panel({ title, note, className, children }: {
  title: string
  note?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={className ? `aa-panel ${className}` : 'aa-panel'}>
      <div className="aa-panel-head">
        <h3 className="aa-panel-title">{title}</h3>
        {note ? <span className="aa-panel-note">{note}</span> : null}
      </div>
      {children}
    </section>
  )
}

/** A live iPhone lock-screen mockup (Geno, 2026-10-14): what the composer on
 *  the left will look like on her phone. Purely visual — the fields own the
 *  text; this mirrors it. Static clock, so the markup never disagrees with
 *  itself between the server and the hydration pass. */
function PushPreview({ title, body }: { title: string; body: string }) {
  const shownTitle = title.trim() || 'New week is live'
  const shownBody = body.trim() || 'Open the app to see this week’s cards.'
  return (
    <div className="aa-preview">
      <div className="aa-phone" aria-hidden>
        <div className="aa-phone-screen">
          <span className="aa-phone-island" />
          <div className="aa-phone-status">
            <span>9:41</span>
            <span className="aa-phone-glyphs">
              <svg viewBox="0 0 16 10" width={13} height={8}><path d="M1 9h2V6H1zM5 9h2V4H5zM9 9h2V2H9zM13 9h2V0h-2z" fill="currentColor" /></svg>
              <svg viewBox="0 0 16 11" width={13} height={9} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M1.5 4.5a9 9 0 0 1 13 0" />
                <path d="M4 7a5.5 5.5 0 0 1 8 0" />
                <circle cx="8" cy="9.6" r="0.8" fill="currentColor" stroke="none" />
              </svg>
              <svg viewBox="0 0 18 10" width={16} height={9}>
                <rect x="1" y="1" width="14" height="8" rx="2.2" fill="none" stroke="currentColor" opacity=".5" />
                <rect x="2.6" y="2.6" width="9.5" height="4.8" rx="1.2" fill="currentColor" />
                <path d="M16.4 3.6v2.8a1.5 1.5 0 0 0 0-2.8z" fill="currentColor" opacity=".5" />
              </svg>
            </span>
          </div>
          <div className="aa-phone-lock">
            <p className="aa-phone-date">Tuesday, 14 October</p>
            <p className="aa-phone-time">9:41</p>
          </div>
          <div className="aa-phone-notif">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gosian-logo.png" alt="" className="aa-phone-app" />
            <span className="aa-phone-notif-copy">
              <span className="aa-phone-notif-head">
                <span className="aa-phone-app-name">Gosian</span>
                <span className="aa-phone-app-when">now</span>
              </span>
              <span className={title.trim() ? 'aa-phone-notif-title' : 'aa-phone-notif-title aa-dim'}>{shownTitle}</span>
              <span className={body.trim() ? 'aa-phone-notif-body' : 'aa-phone-notif-body aa-dim'}>{shownBody}</span>
            </span>
          </div>
        </div>
      </div>
      <p className="aa-preview-note">Live preview — this is how it lands on her lock screen.</p>
    </div>
  )
}

/** One first-run milestone. Done rows are doors (Geno, 2026-10-14): a tap
 *  takes you to the moment itself on the activity timeline below. */
function Mile({ done, at, label, hint, onOpen }: {
  done: boolean
  at: string | null
  label: string
  hint: string
  onOpen?: () => void
}) {
  const body = (
    <>
      <span className="aa-mile-mark" aria-hidden>
        {done ? <Icon name="checkCircle" size={16} /> : <span className="aa-mile-ring" />}
      </span>
      <span className="aa-mile-copy">
        <span className="aa-mile-label">{label}</span>
        <span className="aa-mile-hint">{at ? `Done ${format(new Date(at), 'd MMM yyyy, HH:mm')}` : hint}</span>
      </span>
      {done && onOpen ? (
        <span className="aa-mile-go" aria-hidden><Icon name="chevron" size={14} /></span>
      ) : null}
    </>
  )
  if (done && onOpen) {
    return (
      <button type="button" className="aa-mile" data-done onClick={onOpen} title={`Show it in the activity — ${label}`}>
        {body}
      </button>
    )
  }
  return <div className="aa-mile" data-done={done || undefined}>{body}</div>
}

export default function AppAccountPage({ detail, unreachable = false }: {
  detail: AppAccountDetail | null
  unreachable?: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('activity')
  /** Which timeline event just got flashed by a milestone tap. */
  const [flash, setFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(
    unreachable ? { text: 'The account store is unreachable — try again in a moment.', bad: true } : null,
  )
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [pushTitle, setPushTitle] = useState('')
  const [pushBody, setPushBody] = useState('')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushNote, setPushNote] = useState<{ text: string; bad?: boolean } | null>(null)

  // The Settings tab: the model this account is attached to, and the picker
  // that links it when it is attached to none (2026-10-14).
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string }[] | null>(null)
  const [pickedModel, setPickedModel] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkNote, setLinkNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const account = detail?.account ?? null
  const model = detail?.model ?? null
  const modelId = account?.modelId ?? model?.id ?? null

  // The picker follows the record: after a save and a refresh it shows what
  // is actually attached.
  useEffect(() => {
    setPickedModel(modelId ?? '')
  }, [modelId])

  // The models list loads the first time Settings opens — nowhere else needs it.
  useEffect(() => {
    if (tab !== 'settings' || modelOptions !== null) return
    void (async () => {
      const response = await fetch('/api/models').catch(() => null)
      const body = response?.ok ? await response.json().catch(() => null) : null
      const list = ((body?.models ?? []) as { id: string; name: string }[])
        .map((one) => ({ value: String(one.id), label: String(one.name) }))
        .sort((a, b) => a.label.localeCompare(b.label))
      setModelOptions(list)
    })()
  }, [tab, modelOptions])

  /** The tab's one write: point the account at the picked model. */
  async function saveLink() {
    if (!account?.id || !pickedModel || linkBusy) return
    setLinkBusy(true)
    setLinkNote(null)
    const response = await fetch('/api/app-accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.id, modelId: pickedModel }),
    }).catch(() => null)
    const data = await response?.json().catch(() => ({})) ?? {}
    setLinkBusy(false)
    if (!response?.ok) {
      setLinkNote({ text: (data as { error?: string }).error ?? 'Could not save the link — try again.', bad: true })
      return
    }
    setLinkNote({ text: 'Linked — her app opens against that model now.' })
    router.refresh()
  }

  const groups = useMemo(() => groupByDay(detail?.activity ?? []), [detail?.activity])
  const answers = useMemo(() => (detail?.survey?.answers ? answerRows(detail.survey.answers) : []), [detail?.survey?.answers])

  const agreement = detail?.submissions.find((entry) => entry.kind === 'agreement')
  const agreementTitle = agreement?.data.version === 'ica-2026-10-16'
    ? 'Independent Contractor Agreement'
    : 'Talent Management Agreement'
  const contact = detail?.submissions.find((entry) => entry.kind === 'contact')
  const intake = detail?.submissions.find((entry) => entry.kind === 'intake')

  /** A milestone tap lands on its own line of the story: switch to Activity
   *  if needed, scroll the matching event into view, and flash it once. */
  function jumpTo(kind: 'activated' | 'tour' | 'onboarding') {
    setTab('activity')
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const el = document.querySelector(`[data-aa-kind="${kind}"]`)
        if (!el) return
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' })
        setFlash(kind)
        window.setTimeout(() => setFlash((current) => (current === kind ? null : current)), 2000)
      })
    })
  }

  async function act(action: 'invite' | 'reset') {
    if (busy || !modelId) return
    setBusy(action)
    setNote(null)
    setLink(null)
    try {
      const response = await fetch(`/api/models/${modelId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reset' ? { action: 'reset' } : { email: account?.email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setNote({ text: data?.error ?? 'Something went wrong — try again.', bad: true })
        return
      }
      if (data.url) setLink(data.url)
      if (data.outcome === 'invited' || data.outcome === 'reset') {
        const what = data.outcome === 'invited' ? 'Invite' : 'Reset link'
        setNote({
          text: data.sent ? `${what} sent to ${data.account?.email ?? account?.email ?? 'her'}` : 'Email did not go out — copy the link below for her.',
          bad: !data.sent,
        })
      } else if (data.outcome === 'already_active') {
        setNote({ text: 'She is already set up — send her a reset link instead.' })
      } else if (data.outcome === 'no_account') {
        setNote({ text: data.why ?? 'No account yet — send the invite first.' })
      }
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function sendPush() {
    if (pushBusy || !modelId) return
    if (!pushTitle.trim() && !pushBody.trim()) {
      setPushNote({ text: 'Write a title or a message first.', bad: true })
      return
    }
    setPushBusy(true)
    setPushNote(null)
    try {
      const response = await fetch(`/api/models/${modelId}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: pushTitle, body: pushBody }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setPushNote({ text: data?.error ?? 'That push did not go out — try again.', bad: true })
        return
      }
      const sent = Number(data.sent ?? 0)
      setPushNote(sent > 0
        ? { text: `Sent to ${sent} ${sent === 1 ? 'device' : 'devices'}${data.pruned ? ` · ${data.pruned} dead token${data.pruned === 1 ? '' : 's'} pruned` : ''}.` }
        : { text: 'No devices — she has not turned notifications on in the app yet.', bad: true })
      if (sent > 0) {
        setPushTitle('')
        setPushBody('')
      }
    } finally {
      setPushBusy(false)
    }
  }

  async function copyLink() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  if (!detail) {
    return (
      <div className="dash aa-detail">
        <p className="dash-kicker">The app</p>
        <h2 className="dash-title">App account</h2>
        {note ? <p className="hint" data-tone={note.bad ? 'bad' : undefined}>{note.text}</p> : null}
      </div>
    )
  }

  const status = account?.status ?? 'invited'
  const devices = detail.devices
  const milestones = detail.milestones
  const milestoneDone = [milestones.invite_at, milestones.tour_at, milestones.onboarding_at].filter(Boolean).length

  const pushComposer = (
    <Panel
      title="Send a notification"
      note={devices.length === 0 ? 'No devices yet' : `${devices.length} ${devices.length === 1 ? 'phone' : 'phones'}`}
    >
      <div className="aa-push-form">
        <label className="aa-field-label" htmlFor="aa-push-title">Title</label>
        <input
          id="aa-push-title"
          className="field"
          value={pushTitle}
          maxLength={80}
          placeholder="New week is live"
          onChange={(event) => setPushTitle(event.target.value)}
        />
        <label className="aa-field-label" htmlFor="aa-push-body">Message</label>
        <textarea
          id="aa-push-body"
          className="field"
          value={pushBody}
          maxLength={400}
          rows={3}
          placeholder="Open the app to see this week’s cards."
          onChange={(event) => setPushBody(event.target.value)}
        />
        <div className="aa-push-foot">
          <button className="btn btn-small" disabled={pushBusy || (!pushTitle.trim() && !pushBody.trim())} onClick={() => void sendPush()}>
            {pushBusy ? 'Sending…' : 'Send push'}
          </button>
          {pushNote ? (
            <p className="hint" data-tone={pushNote.bad ? 'bad' : undefined}>{pushNote.text}</p>
          ) : (
            <p className="hint">She gets it on every phone she turned notifications on for.</p>
          )}
        </div>
      </div>
    </Panel>
  )

  const devicesPanel = (
    <Panel title="Devices">
      {devices.length === 0 ? (
        <p className="aa-empty">None — a phone appears here when she turns notifications on.</p>
      ) : (
        <div className="aa-devices">
          {devices.map((device) => (
            <div className="aa-device" key={device.id}>
              <span className="aa-device-icon" aria-hidden><Icon name="bell" size={14} /></span>
              <span className="aa-device-copy">
                <span className="aa-device-name">
                  {device.platform === 'ios' ? 'iPhone' : device.platform === 'android' ? 'Android' : 'Device'}
                </span>
                <span className="aa-device-meta">Seen {ago(device.last_seen_at)} · added {format(new Date(device.created_at), 'd MMM')}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )

  return (
    <div className="dash aa-detail">
      <header className="aa-hero">
        <Avatar name={model?.name ?? account?.email ?? 'App account'} src={model?.photo_url ?? null} size={56} />
        <div className="aa-hero-copy">
          <h1 className="aa-h1">{model?.name ?? 'App account'}</h1>
          <p className="aa-hero-sub">
            {model?.handle ? <span className="aa-handle">@{model.handle}</span> : null}
            <span className="aa-email">{account?.email ?? '—'}</span>
          </p>
          <div className="aa-hero-chips">
            <span className="chip" data-on={status === 'active'}>{STATUS_LABEL[status]}</span>
            {model ? (
              <span className="chip" data-on={model.status === 'active'}>{model.status === 'active' ? 'Model active' : 'Model paused'}</span>
            ) : (
              <span className="chip">Not linked to a model</span>
            )}
            <span className="chip" data-on={devices.length > 0}>
              {devices.length === 0 ? 'No push devices' : `${devices.length} push ${devices.length === 1 ? 'device' : 'devices'}`}
            </span>
          </div>
        </div>
        <div className="aa-hero-actions">
          {status !== 'active' && modelId ? (
            <button className="btn btn-quiet btn-small" disabled={Boolean(busy)} onClick={() => void act('invite')}>
              {busy === 'invite' ? 'Sending…' : 'Resend invite'}
            </button>
          ) : null}
          {status === 'active' && modelId ? (
            <button className="btn btn-quiet btn-small" disabled={Boolean(busy)} onClick={() => void act('reset')}>
              {busy === 'reset' ? 'Sending…' : 'Reset link'}
            </button>
          ) : null}
          {model ? (
            <Link className="btn btn-quiet btn-small" href={`/models?profile=${encodeURIComponent(model.id)}`}>
              Her profile
            </Link>
          ) : null}
        </div>
      </header>

      {note || link ? (
        <div className="invites-note aa-note">
          {note ? <p className="hint" data-tone={note.bad ? 'bad' : undefined}>{note.text}</p> : null}
          {link ? (
            <div className="invites-link">
              <p className="sharelink">{link}</p>
              <button className="btn btn-quiet btn-small" onClick={() => void copyLink()}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="aa-stats" aria-label="Account at a glance">
        <div className="aa-stat">
          <b>{account?.activatedAt ? format(new Date(account.activatedAt), 'd MMM') : '—'}</b>
          <span>Signed up</span>
        </div>
        <div className="aa-stat">
          <b>{account?.lastLoginAt ? ago(account.lastLoginAt) : 'Never'}</b>
          <span>Last sign-in</span>
        </div>
        <div className="aa-stat">
          <b>{account?.setupSendCount ?? 0}</b>
          <span>{account?.setupSendCount === 1 ? 'Invite sent' : 'Invites sent'}</span>
        </div>
        <div className="aa-stat">
          <b>{devices.length}</b>
          <span>Push {devices.length === 1 ? 'device' : 'devices'}</span>
        </div>
      </section>

      {/* The page's sections as horizontal tabs (Geno, 2026-10-14): above the
          content, one tap between her story, her contracts, her notifications
          and what she filled in. */}
      <nav className="aa-tabs" role="tablist" aria-label="Account sections">
        {SUBTABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`aa-panel-${entry.id}`}
            className="aa-tab-btn"
            data-on={tab === entry.id || undefined}
            onClick={() => setTab(entry.id)}
          >
            <Icon name={entry.icon} size={15} />
            <span>{entry.label}</span>
          </button>
        ))}
      </nav>

      {tab === 'activity' ? (
        <div className="aa-split" id="aa-panel-activity" role="tabpanel">
              <Panel title="Getting started" note={`${milestoneDone} of 3`}>
                <div className="aa-miles">
                  <Mile
                    done={Boolean(milestones.invite_at)}
                    at={milestones.invite_at}
                    label="Accepted the invite"
                    hint="Not yet — the invite is still waiting"
                    onOpen={() => jumpTo('activated')}
                  />
                  <Mile
                    done={Boolean(milestones.tour_at)}
                    at={milestones.tour_at}
                    label="Completed the tour"
                    hint="Not yet — she has not walked the welcome"
                    onOpen={() => jumpTo('tour')}
                  />
                  <Mile
                    done={Boolean(milestones.onboarding_at)}
                    at={milestones.onboarding_at}
                    label="Completed the onboarding"
                    hint="Not yet — agreement, contact and intake still open"
                    onOpen={() => jumpTo('onboarding')}
                  />
                </div>
              </Panel>

              <Panel title="App activity" note={`${detail.activity.length} events`}>
                {groups.length === 0 ? (
                  <p className="aa-empty">Nothing yet — her story starts the moment she opens the app.</p>
                ) : (
                  <div className="aa-timeline">
                    {groups.map((group) => (
                      <div className="aa-day" key={group.key}>
                        <p className="aa-day-label">{group.label}</p>
                        {group.events.map((event, index) => (
                          <div className="aa-ev" data-by={event.by} data-tone={event.kind === 'declined' ? 'bad' : undefined}
                            data-aa-kind={event.kind} data-flash={flash === event.kind || undefined}
                            key={`${group.key}-${index}-${event.at}`}>
                            <span className="aa-ev-time">{format(new Date(event.at), 'HH:mm')}</span>
                            <span className="aa-ev-rail" aria-hidden>
                              <span className="aa-ev-dot" />
                            </span>
                            <span className="aa-ev-copy">
                              <span className="aa-ev-label">
                                <span className="aa-ev-icon" aria-hidden><Icon name={KIND_ICON[event.kind]} size={13} /></span>
                                {event.label}
                              </span>
                              {event.detail ? <span className="aa-ev-detail">{event.detail}</span> : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
        </div>
      ) : null}

      {tab === 'contracts' ? (
        <div className="aa-doc-grid" id="aa-panel-contracts" role="tabpanel">
          <article className="aa-panel aa-doc" aria-label={agreementTitle}>
            <div className="aa-doc-head">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/gosian-logo.png" alt="Gosian Media" className="aa-doc-mark" />
              <span className="aa-doc-badge" data-quiet={agreement ? undefined : 'true'}>
                <Icon name={agreement ? 'checkCircle' : 'clock'} size={12} />
                {agreement ? 'Signed' : 'Awaiting signature'}
              </span>
            </div>
            <div className="aa-doc-titleblock">
              <h3 className="aa-doc-title">{agreementTitle}</h3>
              <p className="aa-doc-sub">Between Gosian Media LLC and {agreement?.data.name ? String(agreement.data.name) : 'the Client'}</p>
            </div>
            <div className="aa-doc-rule" role="presentation" />
            <div className="aa-doc-sign">
              <div className="aa-doc-field">
                <span className="aa-doc-label">{agreement ? 'Signed by' : 'Signature'}</span>
                <div className="aa-doc-signline">
                  {agreement && typeof agreement.data.signature === 'string' && agreement.data.signature.trim() ? (
                    <svg className="aa-signature aa-doc-ink" viewBox="0 0 390 170" role="img" aria-label="Her drawn signature">
                      <path d={agreement.data.signature} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </div>
                <span className="aa-doc-value">
                  {agreement
                    ? String(agreement.data.name ?? '—')
                    : <span className="aa-quiet">Awaiting her signature</span>}
                </span>
              </div>
              <div className="aa-doc-field">
                <span className="aa-doc-label">Date</span>
                <div className="aa-doc-signline" />
                <span className="aa-doc-value">
                  {agreement && typeof agreement.data.at === 'string' && !Number.isNaN(Date.parse(agreement.data.at))
                    ? format(new Date(agreement.data.at), 'd MMM yyyy, HH:mm')
                    : <span className="aa-quiet">—</span>}
                </span>
              </div>
            </div>
            <p className="aa-doc-note">
              {agreement
                ? 'Signed electronically in the Gosian app during onboarding. The signed text snapshot and signature details are recorded here.'
                : 'She signs this in the app — the first step of her onboarding checklist. The signed copy lands here the moment she does.'}
            </p>
          </article>

          <Panel title="Signature" note="Read-only">
            <dl className="aa-answers">
              <div className="aa-answer"><dt>State</dt><dd>{agreement ? 'Signed' : 'Awaiting signature'}</dd></div>
              {agreement ? (
                <>
                  <div className="aa-answer"><dt>Signed by</dt><dd>{String(agreement.data.name ?? '—')}</dd></div>
                  <div className="aa-answer">
                    <dt>Effective</dt>
                    <dd>
                      {typeof agreement.data.at === 'string' && !Number.isNaN(Date.parse(agreement.data.at))
                        ? format(new Date(agreement.data.at), 'd MMM yyyy, HH:mm')
                        : '—'}
                    </dd>
                  </div>
                  <div className="aa-answer"><dt>Method</dt><dd>Drawn by finger in the app</dd></div>
                  <div className="aa-answer"><dt>Recorded</dt><dd>{format(new Date(agreement.created_at), 'd MMM yyyy, HH:mm')}</dd></div>
                </>
              ) : (
                <>
                  <div className="aa-answer"><dt>Where</dt><dd>Onboarding · step 1 of her checklist in the app</dd></div>
                  <div className="aa-answer"><dt>Once signed</dt><dd>The record lands here automatically</dd></div>
                </>
              )}
            </dl>
          </Panel>
        </div>
      ) : null}

      {tab === 'notifications' ? (
        <div className="aa-split" id="aa-panel-notifications" role="tabpanel">
          <div className="aa-stack">
            {pushComposer}
            {devicesPanel}
          </div>
          <Panel title="Lock screen" note="Live preview">
            <PushPreview title={pushTitle} body={pushBody} />
          </Panel>
        </div>
      ) : null}

      {tab === 'forms' ? (
        <div className="aa-cols2" id="aa-panel-forms" role="tabpanel">
              <Panel
                className="aa-span-2"
                title="Her questionnaire"
                note={detail.survey?.submitted_at
                  ? `Answered ${format(new Date(detail.survey.submitted_at), 'd MMM')}`
                  : detail.survey?.opened_at
                    ? 'Opened, not answered yet'
                    : detail.survey?.sent_at
                      ? 'Sent, not opened yet'
                      : 'Not sent yet'}
              >
                {answers.length === 0 ? (
                  <p className="aa-empty">No answers on file{detail.survey?.sent_at ? ' — she has the questionnaire link.' : '.'}</p>
                ) : (
                  <dl className="aa-answers">
                    {answers.map((row) => (
                      <div className="aa-answer" key={row.label}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Panel>

              <Panel
                title="Contact form"
                note={contact ? `Submitted ${format(new Date(contact.created_at), 'd MMM yyyy')}` : 'Not submitted yet'}
              >
                {contact ? (
                  <FormRows rows={valueRows(contact.data.values && typeof contact.data.values === 'object' && !Array.isArray(contact.data.values) ? contact.data.values as Record<string, unknown> : contact.data, CONTACT_LABELS)} />
                ) : (
                  <p className="aa-empty">Nothing yet — she fills this in during onboarding.</p>
                )}
              </Panel>

              <Panel
                title="Intake form"
                note={intake ? `Submitted ${format(new Date(intake.created_at), 'd MMM yyyy')}` : 'Not submitted yet'}
              >
                {intake ? (
                  <FormRows rows={valueRows(intake.data.values && typeof intake.data.values === 'object' && !Array.isArray(intake.data.values) ? intake.data.values as Record<string, unknown> : intake.data, INTAKE_LABELS)} />
                ) : (
                  <p className="aa-empty">Nothing yet — she fills this in during onboarding.</p>
                )}
              </Panel>

              {detail.intake.length > 0 ? (
                <Panel className="aa-span-2" title="Her file">
                  <div className="aa-devices">
                    {detail.intake.map((entry, index) => (
                      <div className="aa-device" key={`${entry.created_at}-${index}`}>
                        <span className="aa-device-icon" aria-hidden><Icon name="folder" size={14} /></span>
                        <span className="aa-device-copy">
                          <span className="aa-device-name">{entry.filename ?? 'Intake'}</span>
                          <span className="aa-device-meta">Added {ago(entry.created_at)}{entry.applied_at ? ' · applied' : ''}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>
              ) : null}
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div className="aa-cols2" id="aa-panel-settings" role="tabpanel">
          <Panel title="Account">
            <dl className="aa-answers">
              <div className="aa-answer">
                <dt>Email</dt>
                <dd>{account?.email ?? '—'}</dd>
              </div>
              <div className="aa-answer">
                <dt>Status</dt>
                <dd>{STATUS_LABEL[status]}</dd>
              </div>
              <div className="aa-answer">
                <dt>Signed up</dt>
                <dd>{account?.activatedAt ? format(new Date(account.activatedAt), 'd MMM yyyy, HH:mm') : 'Not yet'}</dd>
              </div>
              <div className="aa-answer">
                <dt>Last sign-in</dt>
                <dd>{account?.lastLoginAt ? ago(account.lastLoginAt) : 'Never'}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Model attached" note={model ? 'Linked' : 'Not linked'}>
            {model ? (
              <div className="aa-linked">
                <Avatar name={model.name} src={model.photo_url} size={44} />
                <span className="aa-linked-copy">
                  <span className="aa-linked-name">{model.name}</span>
                  <span className="aa-linked-meta">
                    {model.handle ? `@${model.handle}` : 'No handle'}
                    {' · '}
                    {model.status === 'active' ? 'Active' : 'Paused'}
                  </span>
                </span>
                <Link className="btn btn-quiet btn-small" href={`/models?profile=${encodeURIComponent(model.id)}`}>
                  Her profile
                </Link>
              </div>
            ) : (
              <p className="aa-empty">
                This account is not attached to a model yet. Pick one below — her app then opens against that
                profile and its week, and every tab on this page fills in.
              </p>
            )}

            <div className="aa-link-row">
              <DropSelect
                label="Model"
                value={pickedModel}
                options={modelOptions ?? []}
                disabled={modelOptions === null}
                placeholder={modelOptions === null ? 'Loading models…' : 'Pick a model'}
                onChange={setPickedModel}
              />
              <button
                className="btn btn-small"
                disabled={linkBusy || !pickedModel || pickedModel === (modelId ?? '')}
                onClick={() => void saveLink()}
              >
                {linkBusy ? 'Saving…' : model ? 'Move to this model' : 'Link this model'}
              </button>
            </div>
            {linkNote ? (
              <p className="hint" data-tone={linkNote.bad ? 'bad' : undefined}>{linkNote.text}</p>
            ) : (
              <p className="hint">
                {model
                  ? 'Changing this moves the login only — her password, devices and history stay put.'
                  : 'Linking ties this login to a model; the account itself does not change.'}
              </p>
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

function FormRows({ rows }: { rows: { label: string; value: string }[] }) {
  if (rows.length === 0) return <p className="aa-empty">Nothing filled in.</p>
  return (
    <dl className="aa-answers">
      {rows.map((row) => (
        <div className="aa-answer" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
