'use client'

import { useState } from 'react'
import { clock } from '@/lib/format'
import type { PlanItem, PlanMessage, Verdict } from '@/lib/plans'

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

const SAVED_RESET_MS = 2400
const COPIED_RESET_MS = 1600

/** The brief as a label/value grid, in the order she works through it: what to
 *  put on, how the phone is held, how many goes, where the sound comes from. */
const SPEC: [keyof Pick<PlanItem, 'wardrobe' | 'camera' | 'takes' | 'sound'>, string][] = [
  ['wardrobe', 'Wardrobe'],
  ['camera', 'Camera'],
  ['takes', 'Takes'],
  ['sound', 'Sound'],
]

export default function PlanItemCard({
  token,
  item,
  number,
  filmed,
  onFilmed,
}: {
  token: string
  item: PlanItem
  number: number
  filmed: boolean
  onFilmed: (next: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [state, setState] = useState<SaveState>('idle')
  const [messages, setMessages] = useState<PlanMessage[]>(item.messages)
  const [verdict, setVerdict] = useState<Verdict>(item.verdict)
  const [reason, setReason] = useState(item.decline_reason ?? '')
  const [openThread, setOpenThread] = useState(item.unread > 0)
  const [unread, setUnread] = useState(item.unread)
  const [copied, setCopied] = useState(false)

  /** The caption is the one thing on this page she has to move somewhere else,
   *  so it gets a button rather than a long-press and a hope. */
  async function copyCaption() {
    if (!item.caption) return
    await navigator.clipboard?.writeText(item.caption).catch(() => null)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }

  async function toggleFilmed() {
    if (busy) return
    const next = !filmed
    onFilmed(next) // optimistic — the counter at the top has to move on tap
    setBusy(true)
    const response = await fetch(`/api/plan/${token}/filmed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, filmed: next }),
    }).catch(() => null)
    setBusy(false)
    if (!response?.ok) onFilmed(!next) // roll back only on a real refusal
  }

  /** Taking a card on, or turning it down. Tapping the same answer twice puts
   *  it back to unanswered — she is allowed to change her mind. */
  async function answer(next: Verdict) {
    const chosen = verdict === next ? 'open' : next
    const previous = verdict
    setVerdict(chosen) // optimistic; a decline has to feel instant
    const response = await fetch(`/api/plan/${token}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_id: item.id,
        verdict: chosen,
        reason: chosen === 'declined' ? reason : null,
      }),
    }).catch(() => null)
    if (!response?.ok) setVerdict(previous)
  }

  /** Opening the thread is what marks his answers read — not the page load, so
   *  a badge she never looked at is still there when she comes back. */
  async function openAndRead() {
    const next = !openThread
    setOpenThread(next)
    if (!next || unread === 0) return
    setUnread(0)
    setMessages((current) => current.map((message) => ({ ...message, seen: true })))
    await fetch(`/api/plan/${token}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, seen: true }),
    }).catch(() => null)
  }

  /** Send what she typed. This box is the only thing on the page she authors,
   *  so a failure must never quietly swallow it — the text stays put. */
  async function send() {
    const body = note.trim()
    if (!body || state === 'saving') return
    setState('saving')
    const response = await fetch(`/api/plan/${token}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, note: body }),
    }).catch(() => null)

    if (!response?.ok) {
      setState('failed')
      return
    }
    const payload = await response.json().catch(() => null)
    if (payload?.message) setMessages((current) => [...current, payload.message])
    setNote('')
    setState('saved')
    setTimeout(() => setState((current) => (current === 'saved' ? 'idle' : current)), SAVED_RESET_MS)
  }

  // Only rows that actually say something. An empty label on a grid reads as a
  // field that failed to load rather than as one nobody filled in.
  const spec = SPEC.filter(([key]) => Boolean(item[key]))

  // `V-7` once the card has been given a number, and the old positional label
  // for anything the phase-4 backfill has not reached — never nothing.
  const cardId = item.card_no ? `V-${item.card_no}` : `Video ${number}`

  const words = item.blocks.length > 0
    ? item.blocks.map((block, index) => (
        <p key={index}>
          {block.speaker && <b>{block.speaker}: </b>}
          {block.text}
        </p>
      ))
    : item.transcript
      ? <p>{item.transcript}</p>
      : <p className="plan-quiet">No words in this one.</p>

  return (
    <li className="plan-item" data-filmed={filmed || undefined} data-verdict={verdict}>
      <div className="plan-item-head">
        {/* The card's own id, not its position. The list used to be numbered
            1..N by where each card sat, so moving one renumbered every card
            under it and "video 7" meant something else after any edit. */}
        <span className="plan-no">{cardId}</span>
        {item.title && <span className="plan-item-title">{item.title}</span>}
        {item.duration_sec ? <span className="plan-len">{clock(item.duration_sec)}</span> : null}
      </div>

      {item.media ? (
        <video
          className="plan-player"
          controls
          playsInline
          preload="metadata"
          src={item.media.video}
        />
      ) : (
        <p className="plan-nofile">
          The video is not ready on this device yet — open it in Instagram below.
        </p>
      )}

      {/* Two buttons, not a button and a sentence. The long explainer that used
          to sit here read as instructions rather than as something to tap; how
          the sound works is already beat four of "How your plan works". */}
      <div className="plan-links">
        {item.webpage_url && (
          <a className="plan-cta" href={item.webpage_url} target="_blank" rel="noreferrer">
            Open in Instagram
          </a>
        )}
        {item.media && (
          <a className="plan-cta plan-cta-quiet" href={item.media.download}>Save video</a>
        )}
      </div>

      {(item.notes || spec.length > 0) && (
        <div className="plan-direction">
          <span className="plan-label">Direction</span>
          {/* The prose. On anything written before phase 3 this is the whole
              brief, which is why it is never dropped when the grid is there. */}
          {item.notes && <p className="plan-notes">{item.notes}</p>}

          {spec.length > 0 && (
            <dl className="plan-spec">
              {spec.map(([key, label]) => (
                <div key={key} className="plan-spec-row">
                  <dt>{label}</dt>
                  <dd>{item[key]}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {/* The opening line of the reference, quoted. It is the one part of the
          brief she has to write her own version of, so it gets its own box. */}
      {item.hook && (
        <div className="plan-hook">
          <span className="plan-label">Hook</span>
          <p>&ldquo;{item.hook}&rdquo;</p>
          <span className="plan-hook-note">Write your own version of that line.</span>
        </div>
      )}

      {item.editing_notes && (
        <p className="plan-editing">
          <span className="plan-label">Editing</span>
          {item.editing_notes}
        </p>
      )}

      {/* Drafted, not decided. Nothing used to write what she actually posts
          under the video, so this was hers to invent every single time. */}
      {item.caption && (
        <div className="plan-caption">
          <div className="plan-caption-top">
            <span className="plan-label">Caption</span>
            <button type="button" className="plan-copy" onClick={copyCaption}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p>{item.caption}</p>
        </div>
      )}

      <details className="plan-transcript">
        <summary>What they say, word for word</summary>
        <div>{words}</div>
      </details>

      {/* Hers to answer. A card nobody has answered is a card nobody has
          decided about, which is different from one she has turned down. */}
      <div className="plan-verdict" role="group" aria-label={`Will you do ${cardId}`}>
        <button
          type="button"
          className="plan-yes"
          aria-pressed={verdict === 'accepted'}
          onClick={() => answer('accepted')}
        >
          I&rsquo;ll do this
        </button>
        <button
          type="button"
          className="plan-no"
          aria-pressed={verdict === 'declined'}
          onClick={() => answer('declined')}
        >
          Can&rsquo;t do this
        </button>
      </div>

      {verdict === 'declined' && (
        <div className="plan-why">
          <label className="plan-label" htmlFor={`why-${item.id}`}>
            What got in the way? — it helps me swap it for something better
          </label>
          <textarea
            id={`why-${item.id}`}
            value={reason}
            rows={2}
            maxLength={500}
            placeholder="Nowhere to film this one…"
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => answer('declined')}
          />
        </div>
      )}

      <button
        type="button"
        className="plan-filmed"
        onClick={toggleFilmed}
        aria-pressed={filmed}
        disabled={busy}
      >
        {filmed ? `Filmed — ${cardId}` : `Mark ${cardId} filmed`}
      </button>

      {/* The conversation about this card. It used to be one box she could
          write in and nothing that could come back. */}
      <div className="plan-say">
        <button
          type="button"
          className="plan-ask"
          aria-expanded={openThread}
          onClick={openAndRead}
        >
          <span>
            {messages.length === 0
              ? 'Ask about this one'
              : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
          </span>
          {unread > 0 && <span className="plan-ask-badge">{unread}</span>}
        </button>

        {openThread && (
          <div className="plan-thread">
            {messages.map((message) => (
              <div key={message.id} className="plan-msg" data-from={message.author}>
                <span className="plan-label">{message.author === 'model' ? 'You' : 'Me'}</span>
                <p>{message.body}</p>
              </div>
            ))}

            <textarea
              id={`note-${item.id}`}
              value={note}
              rows={2}
              maxLength={2000}
              placeholder="Couldn't do this one, need a different outfit…"
              onChange={(event) => {
                setNote(event.target.value)
                setState('idle')
              }}
            />
            <button
              type="button"
              className="plan-send"
              onClick={send}
              disabled={!note.trim() || state === 'saving'}
            >
              {state === 'saving' ? 'Sending…' : 'Send'}
            </button>
            <p className="plan-saystate" role="status" data-tone={state === 'failed' ? 'bad' : undefined}>
              {state === 'saved' && 'Sent.'}
              {state === 'failed' && 'That did not send — your words are still here, tap Send again.'}
            </p>
          </div>
        )}
      </div>
    </li>
  )
}
