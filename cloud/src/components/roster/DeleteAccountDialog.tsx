'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AppAccountRow } from '@/lib/app-accounts'
import Avatar from '../dashboard/Avatar'

/**
 * Delete an app account (Geno, 2026-10-19): the confirm before the drop.
 *
 * The dialog names who is going and what survives, because the table's row
 * is only an email until it is read — the sign-in and any invite or reset
 * link still out are deleted with the account; her model page, her plans
 * and everything she has made in the app live in other tables and stay.
 * Same card voice and fade as the invite popup beside it.
 */

const CLOSE_MS = 180

export default function DeleteAccountDialog({ row, onClose, onDeleted }: {
  row: AppAccountRow | null
  onClose: () => void
  onDeleted: (row: AppAccountRow) => void
}) {
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const open = row !== null

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

  // A fresh open is a fresh question; the last failure never rides along.
  useEffect(() => {
    if (!open) return
    setClosing(false)
    setBusy(false)
    setNote(null)
  }, [open, row?.id])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  async function remove() {
    if (!row || busy) return
    setBusy(true)
    setNote(null)
    try {
      const response = await fetch('/api/app-accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: row.id }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setNote({ text: data?.error ?? 'Something went wrong — try again.', bad: true })
        return
      }
      onDeleted(row)
      close()
    } finally {
      setBusy(false)
    }
  }

  if (!row) return null

  return (
    <div className="aa-modal-veil" data-closing={closing || undefined} onClick={close}>
      <div
        className="adddialog aa-dialog aa-modal-card"
        data-closing={closing || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="aa-delete-title"
        onClick={(event) => event.stopPropagation()}>
        <header className="adddialog-head">
          <div>
            <p className="adddialog-kicker">The app</p>
            <h2 id="aa-delete-title">Delete this account?</h2>
          </div>
          <button className="adddialog-x" onClick={close} aria-label="Close">
            ×
          </button>
        </header>

        <div className="adddialog-body">
          <div className="aa-linked">
            <Avatar name={row.modelName ?? row.email} src={row.modelPhoto} size={38} />
            <div className="aa-linked-copy">
              <span className="aa-linked-name">{row.modelName ?? row.email}</span>
              <span className="aa-linked-meta">
                {row.email}
                {row.modelHandle ? ` · @${row.modelHandle}` : ''}
              </span>
            </div>
          </div>

          <p className="hint">
            Her sign-in is deleted for good, and any invite or reset link still
            out stops working.
          </p>
          <p className="hint">
            Her model page, her plans and everything she has done in the app
            are not touched.
          </p>

          {note ? (
            <p className="hint" data-tone={note.bad ? 'bad' : undefined}>
              {note.text}
            </p>
          ) : null}
        </div>

        <footer className="adddialog-foot">
          <button className="adddialog-cancel" onClick={close} autoFocus>
            Cancel
          </button>
          <button className="adddialog-danger" disabled={busy} onClick={() => void remove()}>
            {busy ? 'Deleting…' : 'Delete account'}
          </button>
        </footer>
      </div>
    </div>
  )
}
