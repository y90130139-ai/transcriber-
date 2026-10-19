'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import DropSelect from '../dashboard/DropSelect'

/**
 * The invite popup (Geno, 2026-10-14): the old Invites screen, moved into
 * App accounts as a dialog. Her email, her model, one link — the account the
 * invite creates shows up in the list and in the Pending invites tab the
 * moment it is sent. Fades in and out like the inbox's own dialogs.
 */

type ModelOption = { id: string; name: string }

const CLOSE_MS = 180
const COPY_RESET_MS = 1600

export default function InviteDialog({ open, emailConfigured, onClose, onInvited }: {
  open: boolean
  emailConfigured: boolean
  onClose: () => void
  onInvited: () => void
}) {
  const [closing, setClosing] = useState(false)
  const [models, setModels] = useState<ModelOption[] | null>(null)
  const [email, setEmail] = useState('')
  const [modelId, setModelId] = useState('')
  const [legalName, setLegalName] = useState('')
  const [stageName, setStageName] = useState('')
  const [laterServiceStartDate, setLaterServiceStartDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const modelsLoaded = useRef(false)

  /** Every way out lands here: fade, then unmount (Geno, 2026-10-14). */
  const close = useCallback(() => {
    setClosing((wasClosing) => {
      if (wasClosing) return wasClosing
      window.setTimeout(() => {
        onClose()
        setClosing(false)
      }, CLOSE_MS)
      return true
    })
  }, [onClose])

  // A fresh form every time it opens; the models load once.
  useEffect(() => {
    if (!open) return
    setClosing(false)
    setNote(null)
    setLink(null)
    setCopied(false)
    setEmail('')
    setModelId('')
    setLegalName('')
    setStageName('')
    setLaterServiceStartDate('')
    const focus = window.setTimeout(() => emailRef.current?.focus(), 30)
    return () => window.clearTimeout(focus)
  }, [open])

  useEffect(() => {
    if (!open || modelsLoaded.current) return
    modelsLoaded.current = true
    void (async () => {
      const response = await fetch('/api/models').catch(() => null)
      const body = response?.ok ? await response.json().catch(() => null) : null
      setModels(
        ((body?.models ?? []) as { id: string; name: string }[])
          .map((one) => ({ id: String(one.id), name: String(one.name) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
    })()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  async function send() {
    if (busy || !email.includes('@') || !modelId) return
    setBusy(true)
    setNote(null)
    setLink(null)
    try {
      const response = await fetch(`/api/models/${modelId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          clientLegalName: legalName,
          clientStageName: stageName,
          laterServiceStartDate,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setNote({ text: data?.error ?? 'Something went wrong — try again.', bad: true })
        return
      }
      if (data.url) setLink(data.url)
      if (data.outcome === 'invited') {
        setNote({
          text: data.sent ? `Invite sent to ${data.account?.email ?? email}` : 'Email did not go out — copy the link below for her.',
          bad: !data.sent,
        })
        setEmail('')
        setModelId('')
        onInvited()
      } else if (data.outcome === 'already_active') {
        setNote({ text: 'She is already set up — send her a reset link from her account page.' })
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
    window.setTimeout(() => setCopied(false), COPY_RESET_MS)
  }

  if (!open) return null
  const ready = email.includes('@') && modelId.length > 0 && !busy

  return (
    <div className="aa-modal-veil" data-closing={closing || undefined} onClick={close}>
      <div
        className="adddialog aa-dialog aa-modal-card"
        data-closing={closing || undefined}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}>
        <header className="adddialog-head">
          <div>
            <p className="adddialog-kicker">The app</p>
            <h2>Invite a model</h2>
          </div>
          <button className="adddialog-x" onClick={close} aria-label="Close">
            ×
          </button>
        </header>

        <div className="adddialog-body">
          <div className="form-row">
            <label className="axis-name" htmlFor="invite-email">
              Her email
            </label>
            <input
              ref={emailRef}
              id="invite-email"
              className="field"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="her@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void send()
              }}
            />
          </div>

          <div className="form-row">
            <span className="axis-name">Which model</span>
            <DropSelect
              label="Which model"
              value={modelId}
              onChange={(next) => {
                setModelId(next)
                const picked = models?.find((model) => model.id === next)
                if (picked) setLegalName((current) => current || picked.name)
              }}
              disabled={models === null}
              placeholder={models === null ? 'Loading models…' : 'Choose a model'}
              options={(models ?? []).map((model) => ({ value: model.id, label: model.name }))}
            />
          </div>

          <div className="form-row">
            <label className="axis-name" htmlFor="invite-legal-name">
              Client legal name
            </label>
            <input
              id="invite-legal-name"
              className="field"
              autoComplete="off"
              placeholder="As it appears on her ID"
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
            />
          </div>

          <div className="form-row">
            <label className="axis-name" htmlFor="invite-stage-name">
              Stage name, if applicable
            </label>
            <input
              id="invite-stage-name"
              className="field"
              autoComplete="off"
              placeholder="Optional"
              value={stageName}
              onChange={(event) => setStageName(event.target.value)}
            />
          </div>

          <div className="form-row">
            <label className="axis-name" htmlFor="invite-service-start">
              Later service start date, if agreed
            </label>
            <input
              id="invite-service-start"
              className="field"
              autoComplete="off"
              placeholder="Optional · e.g. 1 November 2026"
              value={laterServiceStartDate}
              onChange={(event) => setLaterServiceStartDate(event.target.value)}
            />
          </div>

          <p className="hint">
            These fill the Independent Contractor Agreement before she sees it. The
            Effective Date is the date this invite is sent.
          </p>

          <p className="hint">She sets her own password from the email.</p>

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
        </div>

        <footer className="adddialog-foot">
          <button className="adddialog-cancel" onClick={close}>
            Cancel
          </button>
          <button className="adddialog-save" disabled={!ready} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </footer>
      </div>
    </div>
  )
}
