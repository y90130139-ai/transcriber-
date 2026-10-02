'use client'

import { useState } from 'react'

/** "Send the questionnaire to everyone who hasn't answered" — one tap for the
 *  whole roster. Skips anyone who already answered or has one waiting. */
export default function SendSurveys() {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function sendAll() {
    if (!window.confirm('Send the creator questionnaire to every active model who has not answered it yet? The bot posts it in each MARKETING topic.')) return
    setBusy(true)
    setNote(null)
    try {
      const response = await fetch('/api/surveys', { method: 'POST' })
      if (!response.ok) throw new Error()
      const { queued } = await response.json()
      setNote(queued ? `Queued for ${queued} model${queued === 1 ? '' : 's'}.` : 'Everyone has it already.')
    } catch {
      setNote('Could not queue them. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {note && <span className="hint">{note}</span>}
      <button className="btn btn-quiet" disabled={busy} onClick={() => void sendAll()}>
        {busy ? 'Queuing…' : 'Send questionnaire'}
      </button>
    </>
  )
}
