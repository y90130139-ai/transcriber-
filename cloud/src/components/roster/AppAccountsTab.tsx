'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import type { AppAccountRow } from '@/lib/app-accounts'
import { ago } from '@/lib/format'
import Avatar from '../dashboard/Avatar'
import { Icon } from '../console/ConsoleIcons'
import InviteDialog from './InviteDialog'

/**
 * App accounts — the list, redesigned (Geno, 2026-10-14).
 *
 * Every account the app has, where it stands, and what she has actually done
 * with it — the last sign-in and her live push devices ride each row, and the
 * whole row opens her account page: the full activity timeline, the
 * questionnaire she filled, and the push composer that reaches her phones.
 *
 * The list keeps one action per row — Open, the same door the row itself is.
 * Resending an invite stays here for a row that is still waiting (it is the
 * one thing you would do from the list); everything else — the reset link,
 * the push composer — lives on her account page, so the table stays a table
 * (Geno, 2026-10-14).
 *
 * The old Invites screen lives here too now (Geno, 2026-10-14): an Invite
 * button opens the popup, and the Pending invites tab filters the same table
 * down to the accounts still waiting to set up.
 *
 * Accounts and passwords live in Supabase; the linked model — her name and
 * photo — is read from Neon. The two meet at the model id.
 *
 * Server-rendered: the rows arrive with the first paint, and `load` only
 * runs again after an action changes something.
 */

const STATUS_LABEL: Record<AppAccountRow['status'], string> = {
  invited: 'Invited',
  active: 'Active',
  disabled: 'Disabled',
}

export default function AppAccountsTab({ initial, initialUnreachable = false, initialEmailConfigured = true }: {
  initial: AppAccountRow[]
  initialUnreachable?: boolean
  initialEmailConfigured?: boolean
}) {
  const router = useRouter()
  const [rows, setRows] = useState<AppAccountRow[]>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(
    initialUnreachable ? { text: 'The account store is unreachable — try again in a moment.', bad: true } : null,
  )
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'accounts' | 'invites'>('accounts')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [emailConfigured, setEmailConfigured] = useState(initialEmailConfigured)

  /** Refresh after an action — the first paint never needs it. */
  const load = useCallback(async () => {
    const response = await fetch('/api/app-accounts')
    if (response.ok) {
      const body = await response.json()
      setRows(body.accounts ?? [])
      if (typeof body.emailConfigured === 'boolean') setEmailConfigured(body.emailConfigured)
    }
  }, [])

  async function resend(row: AppAccountRow) {
    if (busy || !row.modelId) return
    setBusy(`invite:${row.id}`)
    setNote(null)
    setLink(null)
    try {
      const response = await fetch(`/api/models/${row.modelId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: row.email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setNote({ text: data?.error ?? 'Something went wrong — try again.', bad: true })
        return
      }
      if (data.url) setLink(data.url)
      if (data.outcome === 'invited') {
        setNote({
          text: data.sent ? `Invite sent to ${data.account?.email ?? row.email}` : 'Email did not go out — copy the link below for her.',
          bad: !data.sent,
        })
      } else if (data.outcome === 'already_active') {
        setNote({ text: 'She is already set up — open her account to send a reset link.' })
      } else if (data.outcome === 'no_account') {
        setNote({ text: data.why ?? 'No account yet — send the invite first.' })
      }
      void load()
    } finally {
      setBusy(null)
    }
  }

  async function copyLink() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  function open(row: AppAccountRow) {
    // A linked row opens on the model; an unlinked one opens on the account
    // itself — the detail page takes either id, and that is where it gets
    // linked (Geno, 2026-10-14).
    router.push(`/app-accounts/${encodeURIComponent(row.modelId ?? row.id)}`)
  }

  const active = rows.filter((row) => row.status === 'active').length
  const invited = rows.filter((row) => row.status === 'invited').length
  const devices = rows.reduce((sum, row) => sum + row.devices, 0)
  const neverIn = rows.filter((row) => row.status === 'active' && !row.lastLoginAt).length
  /** What the table shows — everything, or just the ones still waiting. */
  const shown = tab === 'invites' ? rows.filter((row) => row.status === 'invited') : rows

  return (
    <div className="dash aa-tab">
      <header className="dash-head">
        <div>
          <p className="dash-kicker">The app</p>
          <h2 className="dash-title">App accounts</h2>
          <p className="dash-sub">Every account the app has, newest first. Open one to read her whole story — sign-ins, weeks, cards, takes.</p>
        </div>
        <div className="dash-head-tools">
          <button type="button" className="btn btn-small" onClick={() => setInviteOpen(true)}>
            Invite
          </button>
        </div>
      </header>

      <section className="aa-stats" aria-label="App accounts at a glance">
        <div className="aa-stat">
          <b>{active}</b>
          <span>Active {active === 1 ? 'account' : 'accounts'}</span>
        </div>
        <div className="aa-stat">
          <b>{invited}</b>
          <span>{invited === 1 ? 'Invite open' : 'Invites open'}</span>
        </div>
        <div className="aa-stat">
          <b>{devices}</b>
          <span>Push {devices === 1 ? 'device' : 'devices'}</span>
        </div>
        <div className="aa-stat">
          <b>{neverIn}</b>
          <span>Set up, never opened</span>
        </div>
      </section>

      {/* The old Invites screen lives in this page now (Geno, 2026-10-14):
          the button above sends, this strip filters the same table. */}
      <nav className="aa-tabs" role="tablist" aria-label="App accounts sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'accounts'}
          className="aa-tab-btn"
          data-on={tab === 'accounts' || undefined}
          onClick={() => setTab('accounts')}>
          <Icon name="checkCircle" size={15} />
          <span>Accounts</span>
          <b className="aa-tab-count">{rows.length}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'invites'}
          className="aa-tab-btn"
          data-on={tab === 'invites' || undefined}
          onClick={() => setTab('invites')}>
          <Icon name="mail" size={15} />
          <span>Pending invites</span>
          <b className="aa-tab-count">{invited}</b>
        </button>
      </nav>

      <section className="dash-panel" aria-label="App accounts">
        {note || link ? (
          <div className="invites-note">
            {note ? (
              <p className="hint" data-tone={note.bad ? 'bad' : undefined}>
                {note.text}
              </p>
            ) : null}
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

        {rows.length === 0 ? (
          <div className="empty">
            <p>No accounts yet.</p>
            <p>Send the first invite — she gets a link, sets a password, and her week opens in the app.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <p>No pending invites.</p>
            <p>Everyone has set up their account. The Invite button mints the next one.</p>
          </div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table aa-table">
              <thead>
                <tr>
                  <th scope="col">Creator</th>
                  <th scope="col" className="aa-hide-md">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col" className="aa-hide-sm">Devices</th>
                  <th scope="col" className="aa-hide-sm">Signed up</th>
                  <th scope="col" className="aa-actions"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const linked = Boolean(row.modelId)
                  const href = `/app-accounts/${encodeURIComponent(row.modelId ?? row.id)}`
                  return (
                    <tr
                      key={row.id}
                      className="aa-row"
                      data-link
                      onClick={(event) => {
                        if ((event.target as Element).closest('a, button')) return
                        open(row)
                      }}
                    >
                      <td>
                        <span className="aa-creator">
                          <Avatar name={row.modelName ?? row.email} src={row.modelPhoto} size={34} />
                          <span className="aa-creator-copy">
                            {linked ? (
                              <Link
                                className="aa-name"
                                href={href}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {row.modelName ?? 'Open account'}
                              </Link>
                            ) : (
                              <span className="aa-name aa-name-plain">{row.modelName ?? <i className="appcell-none">Not linked</i>}</span>
                            )}
                            {row.modelHandle ? <span className="aa-handle">@{row.modelHandle}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td className="appcell-email aa-hide-md" title={row.email}>{row.email}</td>
                      <td>
                        <span className="chip" data-on={row.status === 'active'}>
                          {STATUS_LABEL[row.status]}
                        </span>
                        {row.status === 'invited' && (row.setupSendCount ?? 0) > 1 ? (
                          <span className="aa-cell-note">Sent {row.setupSendCount}×</span>
                        ) : null}
                      </td>
                      <td className="appcell-meta">
                        {row.lastLoginAt ? ago(row.lastLoginAt) : <span className="aa-quiet">Never</span>}
                      </td>
                      <td className="appcell-meta aa-hide-sm">
                        {row.devices > 0
                          ? <>{row.devices} · seen {row.deviceLastSeen ? ago(row.deviceLastSeen) : '—'}</>
                          : <span className="aa-quiet">None</span>}
                      </td>
                      <td className="appcell-meta aa-hide-sm">
                        {row.activatedAt ? ago(row.activatedAt) : <span className="aa-quiet">—</span>}
                      </td>
                      <td className="appcell-actions aa-actions">
                        {row.status !== 'active' && row.modelId ? (
                          <button
                            className="btn btn-quiet btn-small"
                            disabled={Boolean(busy)}
                            onClick={(event) => { event.stopPropagation(); void resend(row) }}
                          >
                            {busy === `invite:${row.id}` ? 'Sending…' : 'Resend'}
                          </button>
                        ) : null}
                        <Link
                          className="btn btn-small"
                          href={`/app-accounts/${encodeURIComponent(row.modelId ?? row.id)}`}
                          aria-label={`Open ${row.modelName ?? row.email}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <InviteDialog
        open={inviteOpen}
        emailConfigured={emailConfigured}
        onClose={() => setInviteOpen(false)}
        onInvited={() => {
          setTab('invites')
          void load()
        }}
      />
    </div>
  )
}
