'use client'

import { useCallback, useEffect, useState } from 'react'
import DropSelect from '../dashboard/DropSelect'

/**
 * Invites — the send screen, and only that (Geno, 2026-10-12).
 *
 * Type her email, pick the model she is, send. The accounts themselves live
 * on their own screen (`/app-accounts`); this one never carries a list.
 *
 * Accounts and passwords live in Supabase; every name here is read from Neon
 * (the models). The two meet at the model id.
 */

type ModelOption = { id: string; name: string }

const COPY_RESET_MS = 1600

export default function InvitesSend() {
  const [models, setModels] = useState<ModelOption[]>([])
  const [emailConfigured, setEmailConfigured] = useState(true)
  const [email, setEmail] = useState('')
  const [modelId, setModelId] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch('/api/models')
    if (response.ok) {
      const body = await response.json()
      setModels(
        (body.models ?? []).map((model: { id: string; name: string }) => ({
          id: String(model.id),
          name: String(model.name),
        })),
      )
    }
    const status = await fetch('/api/app-accounts')
    if (status.ok) {
      const body = await status.json()
      setEmailConfigured(Boolean(body.emailConfigured))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function send() {
    if (busy || !email.includes('@') || !modelId) return
    setBusy(true)
    setNote(null)
    setLink(null)
    try {
      const response = await fetch(`/api/models/${modelId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setNote({ text: data?.error ?? 'Something went wrong — try again.', bad: true })
        return
      }
      if (data.url) setLink(data.url)
      if (data.outcome === 'invited') {
        setNote({
          text: data.sent ? `Invite sent to ${data.account?.email ?? 'her'}` : 'Email did not go out — copy the link below for her.',
          bad: !data.sent,
        })
        setEmail('')
        setModelId('')
      } else if (data.outcome === 'already_active') {
        setNote({ text: 'She is already set up — send her a reset link from App accounts.' })
      } else if (data.outcome === 'no_account') {
        setNote({ text: data.why ?? 'No account yet — send the invite first.' })
      }
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), COPY_RESET_MS)
  }

  const selectedModel = models.find((model) => model.id === modelId)
  const ready = email.includes('@') && modelId.length > 0 && !busy

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="dash-kicker">The app</p>
          <h2 className="dash-title">Invites</h2>
          <p className="dash-sub">Her email, her model, one link — she signs in from her phone.</p>
        </div>
      </header>

      <div className="invites-grid invites-grid-single">
        <section className="dash-panel invites-form" aria-label="Send an invite">
          <div className="dash-panel-head">
            <h2>Send an invite</h2>
            <p>Links the account to one model. She sets her own password from the email.</p>
          </div>

          <div className="invites-row">
            <div className="invites-field">
              <label className="axis-name" htmlFor="invite-email">
                Her email
              </label>
              <input
                id="invite-email"
                className="field"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="her@email.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="invites-field">
              <span className="axis-name">Which model</span>
              <DropSelect
                className="invites-select"
                id="invite-model"
                label="Which model"
                value={modelId}
                onChange={setModelId}
                placeholder="Choose a model"
                options={models.map((model) => ({ value: model.id, label: model.name }))}
              />
            </div>

            <button className="btn invites-send" disabled={!ready} onClick={() => void send()}>
              {busy ? 'Sending…' : selectedModel ? `Invite ${selectedModel.name}` : 'Send invite'}
            </button>
          </div>

          {!emailConfigured ? (
            <p className="hint" data-tone="bad">
              Email is not set up on the server — the link will be minted and shown here to copy instead.
            </p>
          ) : null}

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
        </section>
      </div>
    </div>
  )
}
