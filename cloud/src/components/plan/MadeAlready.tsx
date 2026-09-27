'use client'

import { useState } from 'react'
import { formatDate } from '@/lib/dates'
import type { PlanItem } from '@/lib/plans'

/**
 * "I've made this one already" on a new-idea card.
 *
 * Some references on a model's week are videos she has already made her own
 * version of, and the library cannot always tell (Susanna, 2026-09-27). Saying
 * so turns the card into a Repurpose job: no filming for her, the team
 * refreshes her video and sends it back in her group chat. Her link is
 * optional — it saves the team finding the post. Undo until the refreshed
 * file has gone out.
 */
export default function MadeAlready({
  token,
  item,
  made,
  preview,
  onChange,
}: {
  token: string
  item: Pick<PlanItem, 'id' | 'made_url' | 'sound_used_on' | 'repurposed_at'>
  made: boolean
  preview: boolean
  onChange: (made: boolean, url: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [state, setState] = useState<'idle' | 'sending'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(item.made_url)

  async function send(next: boolean) {
    setState('sending')
    setError(null)
    const clean = url.trim() || null
    if (!preview) {
      const response = await fetch(`/api/plan/${token}/made`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, made: next, url: next ? clean : null }),
      }).catch(() => null)
      const body = await response?.json().catch(() => null)
      if (!response?.ok) {
        setState('idle')
        setError(body?.error && body.error.length > 20 ? body.error
          : body?.error === 'already_sent_back' ? 'We already sent the refreshed video back.'
            : 'That did not save — try again.')
        return
      }
    }
    setState('idle')
    setOpen(false)
    setLink(next ? clean : null)
    onChange(next, next ? clean : null)
  }

  if (made) {
    return (
      <div className="plan-made" data-done="true">
        <p>You&rsquo;ve made this one — we&rsquo;ll refresh your video and send it to you in your group chat to post again.</p>
        <div className="plan-made-actions">
          {link && <a className="plan-made-link" href={link} target="_blank" rel="noreferrer">Your post</a>}
          {!item.repurposed_at && (
            <button type="button" className="plan-made-undo" disabled={state === 'sending'} onClick={() => void send(false)}>
              Not made yet — undo
            </button>
          )}
        </div>
        {error && <p className="plan-made-error" role="status">{error}</p>}
      </div>
    )
  }

  return (
    <div className="plan-made">
      {item.sound_used_on && (
        <p className="plan-made-hint">
          You used this sound on {formatDate(item.sound_used_on)}. Made this one already?
        </p>
      )}
      {!open ? (
        <button type="button" className="plan-made-open" onClick={() => setOpen(true)}>
          I&rsquo;ve made this one already
        </button>
      ) : (
        <form
          className="plan-made-form"
          onSubmit={(event) => {
            event.preventDefault()
            void send(true)
          }}
        >
          <label className="plan-label" htmlFor={`made-${item.id}`}>Link to your post (optional)</label>
          <input
            id={`made-${item.id}`}
            type="url"
            inputMode="url"
            value={url}
            placeholder="https://www.instagram.com/reel/…"
            onChange={(event) => setUrl(event.target.value)}
          />
          <p className="plan-quiet">No filming — we refresh your video and send it back in your group chat to post again.</p>
          <div className="plan-made-actions">
            <button type="submit" className="plan-made-send" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Send to the team'}
            </button>
            <button type="button" className="plan-made-cancel" onClick={() => { setOpen(false); setError(null) }}>
              Cancel
            </button>
          </div>
          {error && <p className="plan-made-error" role="status">{error}</p>}
        </form>
      )}
    </div>
  )
}
