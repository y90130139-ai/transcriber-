'use client'

/**
 * Messages — her questions, found at last (Geno, 2026-10-07: the roster
 * said "3 unread" and there was no way to see where). Every thread she has
 * ever had on a card, across every week: when she wrote, which video it
 * was about, what was said both ways — with the reply box right here,
 * because answering where you read beats hunting the card down.
 *
 * ANSWERED is worked out, not ticked: the last word was ours. Replying is
 * what marks her messages read (same rule as the plan editor) — so the
 * check appears exactly when the answer exists, never before.
 */
import { useState } from 'react'
import { useLive } from '@/lib/live'

type Thread = {
  item_id: string
  plan_id: string
  week_of: string
  card: string
  title: string | null
  messages: { id: string; author: string; body: string; at: string }[]
  unread: number
  answered: boolean
  last_at: string
}

export default function MessagesTab({ modelId }: { modelId: string }) {
  // Cached: the roster warms this on hover, so the tab is drawn, not loaded.
  const messages = useLive<{ threads: Thread[] }>(`/api/models/${modelId}/messages`)
  const threads = messages.data?.threads ?? null
  const [failed, setFailed] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [sending, setSending] = useState<string | null>(null)

  async function reply(thread: Thread) {
    const text = (draft[thread.item_id] ?? '').trim()
    if (!text || sending) return
    setSending(thread.item_id)
    const response = await fetch(`/api/plans/${thread.plan_id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: thread.item_id, reply: text }),
    }).catch(() => null)
    if (response?.ok) {
      setDraft((current) => ({ ...current, [thread.item_id]: '' }))
      setFailed(null)
      messages.reload()
    } else {
      setFailed('The reply did not send. Nothing was lost — try again.')
    }
    setSending(null)
  }

  const error = failed ?? (messages.error ? 'Her messages did not load. Try again in a moment.' : null)
  if (error && !threads) return <p className="dash-error" role="alert">{error}</p>
  if (!threads) return <p className="dash-empty" aria-busy="true">Reading her messages…</p>
  if (threads.length === 0) {
    return <p className="dash-empty">She has never written on a card. Questions she asks on her plan land here.</p>
  }

  const open = threads.filter((t) => !t.answered).length

  return (
    <div className="msgs">
      <p className="msgs-standfirst">
        {open === 0
          ? 'Every question has an answer.'
          : `${open} waiting on an answer — newest first.`}
      </p>
      {error && <p className="dash-error" role="alert">{error}</p>}

      {threads.map((thread) => (
        <section key={thread.item_id} className="msgs-thread" data-open={!thread.answered || undefined}>
          <header className="msgs-head">
            <b>{thread.card}</b>
            <span>Week of {thread.week_of.slice(0, 10)}</span>
            {thread.title && <span className="msgs-title">{thread.title}</span>}
            <span className="msgs-state" data-answered={thread.answered || undefined}>
              {thread.answered ? '✓ Answered' : `Waiting${thread.unread ? ` · ${thread.unread} unread` : ''}`}
            </span>
          </header>
          <ol className="msgs-list">
            {thread.messages.map((message) => (
              <li key={message.id} data-who={message.author}>
                <span className="msgs-when">{message.at.slice(0, 10)}</span>
                <p>{message.body}</p>
              </li>
            ))}
          </ol>
          <div className="msgs-reply">
            <input
              type="text"
              value={draft[thread.item_id] ?? ''}
              placeholder="Answer her here — it lands on her card, with an unread badge her side"
              onChange={(event) => setDraft((current) => ({ ...current, [thread.item_id]: event.target.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') void reply(thread) }}
            />
            <button
              type="button"
              className="chip"
              disabled={sending === thread.item_id || !(draft[thread.item_id] ?? '').trim()}
              onClick={() => void reply(thread)}
            >
              {sending === thread.item_id ? 'Sending…' : 'Reply'}
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
