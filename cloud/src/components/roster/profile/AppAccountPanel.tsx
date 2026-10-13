'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The model's app account, inside her sheet's Access tab (Geno, 2026-10-12).
 *
 * One button, one truth: whether she has an account, whether the invite has
 * gone out, and when she last opened the app. Invites go through the same
 * Resend account as everything else Gosian — but when email is not set up the
 * link is still shown, because copy-the-link is the fallback everywhere else
 * in this console and it stays the fallback here.
 */

type Account = {
  id: string
  email: string
  name: string | null
  status: 'invited' | 'active' | 'disabled'
  setupSentAt: string | null
  setupSendCount: number
  lastLoginAt: string | null
  activatedAt: string | null
}

const COPY_RESET_MS = 1600

function when(value: string | null): string {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function AppAccountPanel({ modelId, defaultEmail }: { modelId: string; defaultEmail?: string }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [emailConfigured, setEmailConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState(defaultEmail ?? '')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/models/${modelId}/invite`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error ?? 'Could not read the app account')
      setAccount(data.account ?? null)
      setEmailConfigured(Boolean(data.emailConfigured))
      if (data.account?.email) setEmail((current) => current || data.account.email)
    } catch (error) {
      setNote({ text: (error as Error).message, bad: true })
    } finally {
      setLoading(false)
    }
  }, [modelId])

  useEffect(() => {
    void load()
  }, [load])

  async function act(action: 'invite' | 'reset') {
    if (busy) return
    setBusy(true)
    setNote(null)
    setLink(null)
    try {
      const response = await fetch(`/api/models/${modelId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setNote({ text: data?.error ?? 'Something went wrong — try again.', bad: true })
        return
      }
      if (data.account) {
        setAccount(data.account)
        if (data.account.email) setEmail(data.account.email)
      }
      if (data.url) setLink(data.url)
      if (data.outcome === 'invited' || data.outcome === 'reset') {
        const what = data.outcome === 'invited' ? 'Invite' : 'Reset link'
        setNote({
          text: data.sent ? `${what} sent to ${data.account?.email ?? 'her'}` : 'Email did not go out — copy the link for her.',
          bad: !data.sent,
        })
      } else if (data.outcome === 'already_active') {
        setNote({ text: 'She is already set up — send a reset link instead.' })
      } else if (data.outcome === 'no_account') {
        setNote({ text: data.why ?? 'No app account yet — send the invite first.' })
      }
    } finally {
      setBusy(false)
    }
  }

  const status = account?.status === 'active' ? 'active' : 'invited'
  const statusLine =
    account && status === 'active'
      ? `Active · ${account.lastLoginAt ? `last opened ${when(account.lastLoginAt)}` : 'not opened yet'}`
      : account
        ? `Invited ${when(account.setupSentAt)} · sent ${account.setupSendCount}×`
        : ''

  return (
    <div className="axis">
      <div className="axis-head">
        <span className="axis-name">App account</span>
        {statusLine ? <span className="hint">{statusLine}</span> : null}
      </div>

      <p className="hint">
        She signs into the Gosian app with her own email and password. The invite comes
        from Gosian Media; this link works once.
      </p>

      <div className="form-row">
        <label className="axis-name" htmlFor="model-app-email">
          Her email
        </label>
        <input
          id="model-app-email"
          className="field"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="her@email.com"
          value={email}
          disabled={status === 'active'}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="btn btn-quiet"
          disabled={busy || loading || status === 'active' || !email.includes('@')}
          onClick={() => void act('invite')}
        >
          {busy && status !== 'active' ? 'Sending' : account && status === 'invited' ? 'Send again' : 'Send invite'}
        </button>
        <button
          className="btn btn-quiet"
          disabled={busy || loading || status !== 'active'}
          onClick={() => void act('reset')}
          title={status === 'active' ? undefined : 'She needs to set up her account first'}
        >
          Send reset link
        </button>
        {!emailConfigured && !loading ? <span className="hint">Email is not set up on the server — copy the link instead.</span> : null}
      </div>

      {note ? (
        <span className="hint" data-tone={note.bad ? 'bad' : undefined}>
          {note.text}
        </span>
      ) : null}

      {link ? (
        <>
          <p className="sharelink">{link}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-quiet"
              onClick={async () => {
                await navigator.clipboard.writeText(link)
                setCopied(true)
                setTimeout(() => setCopied(false), COPY_RESET_MS)
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
