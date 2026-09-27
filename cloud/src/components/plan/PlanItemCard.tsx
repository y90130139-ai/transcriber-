'use client'

import { useState } from 'react'
import { DECLINE_CODES, DECLINE_LABEL, isPermanentDecline, needsReason, type DeclineCode } from '@/lib/decline'
import { clock } from '@/lib/format'
import type { PlanItem, PlanMessage, Verdict } from '@/lib/plans'
import { KIND_TEXT, cardKind, REEL_CHECKLIST, copyRuleFor, expressionFor } from '@/lib/card'
import { buildScaffold } from '@/lib/script'
import { DAYS } from '@/lib/schedule'

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

const SAVED_RESET_MS = 2400
const COPIED_RESET_MS = 1600
/** How long the card wears its confirm. Long enough to be seen finishing,
 *  short enough that a run of four ticks does not leave four cards pulsing. */
const CONFIRMED_RESET_MS = 700

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
  folder,
  onFilmed,
  preview = false,
}: {
  token: string
  item: PlanItem
  number: number
  filmed: boolean
  /** Her Drive folder, if she has one. Null renders no drop-off line at all —
   *  a destination-less "send it somewhere" is worse than the silence it
   *  replaces. The note-only case is carried by the block at the foot of the
   *  page rather than restated under all twelve cards. */
  folder: string | null
  onFilmed: (next: boolean) => void
  /**
   * Rendered inside the console as "what she sees", not opened by her.
   *
   * Every control still works and still feels the way it will on her phone —
   * that is the entire point of showing it — but **nothing is written**. Each
   * mutation below returns before its fetch.
   *
   * This is a hard safety requirement, not a nicety. The console renders this
   * against a real creator's live plan; a preview that posted would tick her
   * cards filmed, answer her verdicts and send her messages from Geno's
   * screen, silently, while he was only looking.
   */
  preview?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [state, setState] = useState<SaveState>('idle')
  const [messages, setMessages] = useState<PlanMessage[]>(item.messages)
  const [verdict, setVerdict] = useState<Verdict>(item.verdict)
  const [reason, setReason] = useState(item.decline_reason ?? '')
  const [code, setCode] = useState<DeclineCode | null>(
    (item.decline_code as DeclineCode | null) ?? null,
  )
  const [openThread, setOpenThread] = useState(item.unread > 0)
  const [unread, setUnread] = useState(item.unread)
  const [copied, setCopied] = useState(false)
  /** The DM, once written — on the card already, or written on request. */
  const [dm, setDm] = useState<string | null>(item.brief_short)
  const [dmState, setDmState] = useState<'idle' | 'writing' | 'copied'>('idle')
  const [dmError, setDmError] = useState<string | null>(null)

  /** First press writes it (one model call, this card only); after that the
   *  button copies. Two presses rather than write-then-copy in one, because a
   *  clipboard write after a network wait is refused by some browsers. */
  async function dmAction() {
    if (dm) {
      await navigator.clipboard?.writeText(dm).catch(() => null)
      setDmState('copied')
      setTimeout(() => setDmState('idle'), COPIED_RESET_MS)
      return
    }
    setDmState('writing')
    setDmError(null)
    const response = await fetch(`/api/dm/${item.id}`, { method: 'POST' }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (response?.ok && body?.dm) setDm(String(body.dm))
    else setDmError(body?.error ?? 'Could not write it — try again.')
    setDmState('idle')
  }
  /** Set only by a real tap, never by the card arriving already filmed — a
   *  page that celebrates last week's work every time she opens it is noise. */
  const [justFilmed, setJustFilmed] = useState(false)

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
    // The confirm rides the optimistic update, not the response. It is
    // feedback that the tap landed; waiting on the network to celebrate would
    // put the applause half a second after the thing it applauds.
    if (next) {
      setJustFilmed(true)
      setTimeout(() => setJustFilmed(false), CONFIRMED_RESET_MS)
    }
    if (preview) return
    setBusy(true)
    const response = await fetch(`/api/plan/${token}/filmed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, filmed: next }),
    }).catch(() => null)
    setBusy(false)
    if (!response?.ok) onFilmed(!next) // roll back only on a real refusal
  }

  /**
   * Write one verdict, exactly as given. No toggling — the caller has already
   * decided what the answer is.
   *
   * Split out from `answer` because everything under a decline has to be able
   * to save without re-answering the question. The reason box used to call
   * `answer('declined')` on blur, and since the card was *already* declined the
   * toggle turned that into "open" — so typing why she could not do it silently
   * cleared the decline, and the words she had just written went with it.
   */
  async function save(chosen: Verdict, withCode: DeclineCode | null, why: string) {
    const previous = verdict
    setVerdict(chosen) // optimistic; a decline has to feel instant
    if (preview) return
    const response = await fetch(`/api/plan/${token}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_id: item.id,
        verdict: chosen,
        reason: chosen === 'declined' ? why : null,
        // Beside the words, never instead of them. Tapping the same chip twice
        // clears it — she is allowed to have picked the wrong one.
        code: chosen === 'declined' ? withCode : null,
      }),
    }).catch(() => null)
    if (!response?.ok) setVerdict(previous)
  }

  /** Taking a card on, or turning it down. Tapping the same answer twice puts
   *  it back to unanswered — she is allowed to change her mind. */
  async function answer(next: Verdict) {
    await save(verdict === next ? 'open' : next, code, reason)
  }

  /** Opening the thread is what marks his answers read — not the page load, so
   *  a badge she never looked at is still there when she comes back. */
  async function openAndRead() {
    const next = !openThread
    setOpenThread(next)
    if (!next || unread === 0) return
    setUnread(0)
    setMessages((current) => current.map((message) => ({ ...message, seen: true })))
    // Marking his answers read is a write like any other. In the console this
    // would clear her unread badge because he looked at his own preview.
    if (preview) return
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
    // A message sent from the preview would arrive in Geno's own inbox as if
    // she had written it. The box still types; it just does not post.
    if (preview) {
      setNote('')
      setState('saved')
      setTimeout(() => setState((current) => (current === 'saved' ? 'idle' : current)), SAVED_RESET_MS)
      return
    }
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

  const rule = copyRuleFor(item.bucket, item.axis)
  // The job, in one word, before anything else on the card. A repurpose is
  // posted as it is, so none of the filming directions apply to it.
  const kind = cardKind(item.bucket, item.source_post)
  const filming = kind !== 'repurpose'
  const expression = expressionFor(item.formats)
  const scaffold = buildScaffold({
    hooks: item.hooks,
    formats: item.formats,
    firstLine: item.hook,
    onScreenCaptions: item.on_screen_captions,
    durationSec: item.duration_sec,
  })

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
    /* `data-reveal` is rendered EMPTY on purpose. `useReveal` looks for the
       attribute and is the only thing that ever writes "out" or "in" into it,
       and only after confirming IntersectionObserver exists and reduced motion
       is off. The CSS hides `[data-reveal='out']` and nothing else, so with the
       script broken or absent every card renders visible, exactly as before. */
    <li
      className="plan-item"
      data-reveal=""
      data-filmed={filmed || undefined}
      data-just-filmed={justFilmed || undefined}
      data-verdict={verdict}
    >
      <div className="plan-item-head">
        {/* The card's own id, not its position. The list used to be numbered
            1..N by where each card sat, so moving one renumbered every card
            under it and "video 7" meant something else after any edit. */}
        <span className="plan-no">{cardId}</span>
        {item.title && <span className="plan-item-title">{item.title}</span>}
        {item.duration_sec ? <span className="plan-len">{clock(item.duration_sec)}</span> : null}
      </div>

      {/* When it goes out, and what kind of card it is — in her words. Only on
          cards the 70/20/10 planner drafted; everything older renders as it
          always did. */}
      <div className="plan-kind" data-kind={kind}>
        <b>{KIND_TEXT[kind].label}</b>
        <span>{KIND_TEXT[kind].line}</span>
      </div>

      {item.slot_time && item.slot_day !== null && (
        <p className="plan-when">
          <span>Post {DAYS[item.slot_day % DAYS.length]} at {item.slot_time}</span>
        </p>
      )}

      {/* Why this one is on her week. Plain words, because "8.53×" is a number
          she has no baseline for and would rightly ignore. Nothing is shown
          when the sweep has nothing true to say. */}
      {item.headline && <p className="plan-why">{item.headline}</p>}

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
        {!filming && item.media && (
          <a className="plan-cta" href={item.media.download}>Save video</a>
        )}
        {item.webpage_url && (
          <a className={filming ? 'plan-cta' : 'plan-cta plan-cta-quiet'} href={item.webpage_url} target="_blank" rel="noreferrer">
            Open in Instagram
          </a>
        )}
        {filming && item.media && (
          <a className="plan-cta plan-cta-quiet" href={item.media.download}>Save video</a>
        )}
      </div>

      {filming && (<>
      {/* Step 7's missing half: what she keeps exactly and what she changes.
          The manual is explicit that sending only a caption loses the thing
          that made the reel work. */}
      <div className="plan-rule">
        <span className="plan-label">{rule.label}</span>
        <dl className="plan-spec">
          <div className="plan-spec-row"><dt>Keep</dt><dd>{rule.keep}</dd></div>
          <div className="plan-spec-row"><dt>Change</dt><dd>{rule.change}</dd></div>
          <div className="plan-spec-row"><dt>Your face</dt><dd>{expression}</dd></div>
        </dl>
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

      {/* The beat-by-beat skeleton of the reference. Built for the console and
          never shown to her until now, though it is the richest guidance we
          generate. The reference's words are shown as reference, never as her
          lines. */}
      {scaffold && scaffold.beats.length > 1 && (
        <details className="plan-scaffold">
          <summary>How it is built, beat by beat</summary>
          <p className="plan-quiet">{scaffold.mechanism}</p>
          <ol>
            {scaffold.beats.map((beat, index) => (
              <li key={index}>
                <b>{beat.at !== null ? `${Math.round(beat.at)}s` : `Beat ${index + 1}`}</b>{' '}
                {beat.instruction}
                <span className="plan-quiet"> They put: &ldquo;{beat.reference}&rdquo;</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      </>)}

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

      {/* Real captions from the library, adapted to her. Each one names the
          comment it is built to provoke — the manual's test for whether a
          caption is doing anything at all. */}
      {item.caption_options && item.caption_options.length > 0 && (
        <details className="plan-captions" open>
          <summary>Caption options</summary>
          <ul>
            {item.caption_options.map((option, index) => (
              <li key={index}>
                <p>{option.caption}</p>
                <span className="plan-quiet">Gets people commenting: &ldquo;{option.baits}&rdquo;</span>
                {/* Console only: the real library caption this was adapted
                    from, so Geno can see it was borrowed, not invented. */}
                {preview && option.from && (
                  <span className="plan-quiet">Real caption ({option.formula}): &ldquo;{option.from}&rdquo;</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* The DM version, written only when Geno asks — he sends the portal
          link, not a message per video (2026-09-25). Console only: on her own
          page the card already says all of it. */}
      {preview && (
        <div className="plan-caption">
          <div className="plan-caption-top">
            <span className="plan-label">DM version</span>
            <button type="button" className="plan-copy" disabled={dmState === 'writing'} onClick={() => void dmAction()}>
              {dmState === 'writing' ? 'Writing…' : dmState === 'copied' ? 'Copied' : dm ? 'Copy' : 'Write DM'}
            </button>
          </div>
          {dm && <p>{dm}</p>}
          {dmError && <p className="plan-quiet">{dmError}</p>}
        </div>
      )}

      <details className="plan-checklist">
        <summary>Before you post it</summary>
        <ul>
          {REEL_CHECKLIST.map((check) => <li key={check}>{check}</li>)}
        </ul>
      </details>

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

          {/* One tap answers it most of the time. The box underneath stays,
              because the sentence she writes is usually the useful part and
              five buckets will never hold every way a week goes wrong. */}
          <div className="plan-codes" role="group" aria-label="What got in the way">
            {DECLINE_CODES.map((option) => (
              <button
                key={option}
                type="button"
                className="plan-code"
                aria-pressed={code === option}
                onClick={() => {
                  const next = code === option ? null : option
                  setCode(next)
                  // "Something else" holds until she has written what it was:
                  // the code on its own tells nobody anything, and the save
                  // would be rejected. Every other answer saves on the tap.
                  if (needsReason(next) && !reason.trim()) return
                  void save('declined', next, reason)
                }}
              >
                {DECLINE_LABEL[option]}
              </button>
            ))}
          </div>

          <textarea
            id={`why-${item.id}`}
            value={reason}
            rows={2}
            maxLength={500}
            placeholder={needsReason(code) ? 'Say what it was — this one needs it' : 'Nowhere to film this one…'}
            aria-required={needsReason(code) || undefined}
            onChange={(event) => setReason(event.target.value)}
            // Saves the words. It must not re-answer the question — see `save`.
            onBlur={(event) => void save('declined', code, event.target.value)}
          />

          {/* What her answer actually does, said plainly. "Not comfortable"
              retires the idea for good, and she should know that is what she
              is choosing; the others only move it out of the way. */}
          <span className="plan-why-said">
            {needsReason(code) && !reason.trim()
              ? 'Tell me what it was and this saves.'
              : isPermanentDecline(code)
                ? 'Got it — you will not be sent this one again.'
                : code
                  ? 'Fine. It goes away for now and may come back another week.'
                  : ''}
          </span>
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

      {/* Directly under the tick, because that is the moment the question
          comes up. One line and a real tap target — not the whole delivery
          note again, twelve times down the page. */}
      {folder && (
        <div className="plan-dropoff">
          <span className="plan-dropoff-line">Send {cardId} when it is done.</span>
          <a className="plan-cta plan-cta-quiet" href={folder} target="_blank" rel="noreferrer">
            Your folder
          </a>
        </div>
      )}

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
