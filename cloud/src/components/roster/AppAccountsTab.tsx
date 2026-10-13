'use client'

import { useCallback, useState } from 'react'
import type { AppAccountRow } from '@/lib/app-accounts'
import Avatar from '../dashboard/Avatar'

/**
 * App accounts — the list, and only the list (Geno, 2026-10-12).
 *
 * Its own screen: every account the app has, where it stands, and the two
 * actions that keep it alive — resend while she is still invited, reset once
 * she is in. The invite itself is its own screen (`/invites`).
 *
 * Accounts and passwords live in Supabase; the linked model — her name and
 * photo — is read from Neon. The two meet at the model id.
 *
 * Server-rendered (Geno, 2026-10-13): the rows arrive with the first paint,
 * so the page is instant instead of opening on placeholders. `load` only runs
 * again after an action changes something.
 */

function when(value: string | null): string {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const STATUS_LABEL: Record<AppAccountRow['status'], string> = {
  invited: 'Invited',
  active: 'Active',
  disabled: 'Disabled',
}

/** The one line of history under an email. */
function standing(row: AppAccountRow): string {
  if (row.status === 'active') {
    return row.lastLoginAt ? `Last opened ${when(row.lastLoginAt)}` : 'Set up — not opened yet'
  }
  if (row.status === 'disabled') return 'Disabled'
  return row.setupSentAt ? `Sent ${when(row.setupSentAt)} · ${row.setupSendCount}×` : 'Invite pending'
}

export default function AppAccountsTab({ initial, initialUnreachable = false }: {
  initial: AppAccountRow[]
  initialUnreachable?: boolean
}) {
  const [rows, setRows] = useState<AppAccountRow[]>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(
    initialUnreachable ? { text: 'The account store is unreachable — try again in a moment.', bad: true } : null,
  )
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  /** Refresh after an action — the first paint never needs it. */
  const load = useCallback(async () => {
    const response = await fetch('/api/app-accounts')
    if (response.ok) {
      const body = await response.json()
      setRows(body.accounts ?? [])
    }
  }, [])

  async function act(action: 'invite' | 'reset', row: AppAccountRow) {
    if (busy || !row.modelId) return
    setBusy(`${action}:${row.id}`)
    setNote(null)
    setLink(null)
    try {
      const response = await fetch(`/api/models/${row.modelId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reset' ? { action: 'reset' } : { email: row.email }),
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
          text: data.sent ? `${what} sent to ${data.account?.email ?? row.email}` : 'Email did not go out — copy the link below for her.',
          bad: !data.sent,
        })
      } else if (data.outcome === 'already_active') {
        setNote({ text: 'She is already set up — send her a reset link instead.' })
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

  const active = rows.filter((row) => row.status === 'active').length
  const invited = rows.filter((row) => row.status === 'invited').length

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="dash-kicker">The app</p>
          <h2 className="dash-title">App accounts</h2>
          <p className="dash-sub">Every account the app has, newest first.</p>
        </div>
        <div className="dash-head-tools">
          <p className="dash-range">
            {active} active · {invited} invited
          </p>
        </div>
      </header>

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
            <p>Send the first invite from the Invites screen — she gets a link, sets a password, and her week opens in the app.</p>
          </div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table apptable">
              <thead>
                <tr>
                  <th scope="col">Creator</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Activity</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="dash-who">
                        <Avatar name={row.modelName ?? row.email} src={row.modelPhoto} size={34} />
                        <span>
                          <span className="appcell-name">
                            {row.modelName ?? <i className="appcell-none">Not linked</i>}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="appcell-email" title={row.email}>{row.email}</td>
                    <td>
                      <span className="chip" data-on={row.status === 'active'}>
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td className="appcell-meta">{standing(row)}</td>
                    <td className="appcell-actions">
                      {row.status !== 'active' && row.modelId ? (
                        <button
                          className="btn btn-quiet btn-small"
                          disabled={Boolean(busy)}
                          onClick={() => void act('invite', row)}
                        >
                          {busy === `invite:${row.id}` ? 'Sending…' : 'Resend'}
                        </button>
                      ) : null}
                      {row.status === 'active' && row.modelId ? (
                        <button
                          className="btn btn-quiet btn-small"
                          disabled={Boolean(busy)}
                          onClick={() => void act('reset', row)}
                        >
                          {busy === `reset:${row.id}` ? 'Sending…' : 'Reset link'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
