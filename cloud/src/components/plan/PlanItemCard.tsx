'use client'

import { useState, type ReactNode } from 'react'
import { DECLINE_CODES, DECLINE_LABEL, needsReason, type DeclineCode } from '@/lib/decline'
import { clock } from '@/lib/format'
import type { PlanItem, PlanMessage, Verdict } from '@/lib/plans'
import { KIND_TEXT, REPURPOSE_READY, cardKind, FILM_CHECKLIST, copyRuleFor, expressionFor } from '@/lib/card'
import { buildScaffold } from '@/lib/script'
import { DAYS } from '@/lib/schedule'
import MadeAlready from './MadeAlready'
import ShotListView from './ShotListView'
import { buildShotList } from '@/lib/shotlist'
import { effortFor } from '@/lib/effort'
import { SOURCE_TEXT } from '@/lib/source'

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
  inGroup = false,
  onDeclined,
  onVerdict,
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
  /** Her questions are also posted in her Telegram group (the Gosian bot). */
  inGroup?: boolean
  /** The decline is complete — a reason picked, and the words when "Something
   *  else" needs them. The page moves the card to "Videos you can't do". */
  onDeclined?: (code: DeclineCode, reason: string) => void
  /** Every verdict change, as the card itself now believes it — the page
   *  files the card under "To review" or "My reels" from this. Fired on the
   *  optimistic set AND on a rollback, so the page never disagrees with the
   *  card about where it belongs. */
  onVerdict?: (next: Verdict) => void
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
  /** Which caption option was just copied, so only its button says so. */
  const [copiedOption, setCopiedOption] = useState<number | null>(null)
  /** Her thumbs on this reference, and whether the last tap failed to save. */
  const [rating, setRating] = useState<1 | -1 | null>(item.rating)
  const [rateFailed, setRateFailed] = useState(false)
  /** She has made her own version already — the card is a Repurpose job now. */
  const [made, setMade] = useState(Boolean(item.made_at))
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

  /** One button per caption option: pick one, tap, paste it under the video. */
  async function copyOption(index: number, text: string) {
    await navigator.clipboard?.writeText(text).catch(() => null)
    setCopiedOption(index)
    setTimeout(() => setCopiedOption((current) => (current === index ? null : current)), COPIED_RESET_MS)
  }

  /** 👍/👎: is this a good reference for her? Tapping the same thumb again
   *  takes it back. Saved at once; it steers what she is sent next. */
  async function rate(next: 1 | -1) {
    const previous = rating
    const chosen = rating === next ? null : next
    setRating(chosen) // optimistic — a thumb has to feel instant
    setRateFailed(false)
    if (preview) return
    const response = await fetch(`/api/plan/${token}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, rating: chosen ?? 0 }),
    }).catch(() => null)
    if (!response?.ok) {
      setRating(previous)
      setRateFailed(true)
    }
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
    onVerdict?.(chosen)
    // Out of her feed only once the "no" is whole: tapping "Can't do this"
    // opens the reasons, and the card must stay put while she picks one.
    const complete = chosen === 'declined' && withCode !== null && (!needsReason(withCode) || Boolean(why.trim()))
    if (preview) {
      if (complete) onDeclined?.(withCode!, why.trim())
      return
    }
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
    if (!response?.ok) {
      setVerdict(previous)
      onVerdict?.(previous)
    } else if (complete) onDeclined?.(withCode!, why.trim())
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
  // How much work it is, read off the measured video (Geno, 2026-10-06:
  // "let the model know exactly how difficult it is"). Shown only on cards
  // she actually films — a repurpose or her own reel is posted, not shot.
  const effort = effortFor(item)
  // The job, in one word, before anything else on the card. A repurpose is
  // posted as it is, so none of the filming directions apply to it.
  // "I've made this one already" turns a new idea into a Repurpose card on the
  // spot; taking it back returns it to a plain card.
  const bucket = made ? 'repurpose' : item.made_at ? null : item.bucket
  const kind = cardKind(bucket, item.source_post, item.mine)
  // A repurpose is posted as it is, and one of her own reels is hers to
  // repost or not — neither gets filming directions.
  const filming = kind !== 'repurpose' && kind !== 'yours'
  const expression = expressionFor(item.formats)
  // Written from the reference's measured picture when the Mac has looked;
  // until then the card keeps its old directions.
  const shotList = filming
    ? buildShotList({
        measured: item.shots,
        screen: item.on_screen_captions,
        speech: item.blocks.map((block) => ({ start: block.start, text: block.text })),
        sound: { title: item.sound_title, original: item.original_audio },
      })
    : null
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

  const captions = item.caption_options ?? []
  let step = 0

  return (
    /* `data-reveal` is rendered EMPTY on purpose. `useReveal` looks for the
       attribute and is the only thing that ever writes "out" or "in" into it,
       and only after confirming IntersectionObserver exists and reduced motion
       is off. The CSS hides `[data-reveal='out']` and nothing else, so with the
       script broken or absent every card renders visible, exactly as before. */
    <li
      /* The card's address on the page (#v-12, or #card-<id> before the
         backfill reaches it). A question relayed to Telegram deep-links here,
         so the team lands on the exact video instead of scrolling for the
         number. */
      id={item.card_no ? `v-${item.card_no}` : `card-${item.id}`}
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
        {/* The work it asks of her, read off the measured video. `title`
            carries the why ("2 shots · prop the phone · no lines") where
            hover exists; the chip alone has to carry phones. */}
        {filming && <span className="plan-effort" data-tier={effort.tier} title={effort.why || undefined}>{effort.label}</span>}
        {item.duration_sec ? <span className="plan-len">{clock(item.duration_sec)}</span> : null}
        {/* Where the card came from, in her words (2026-10-08): a reference
            to copy, a twist on one, or something written for her. Only on
            cards she films — a repurpose is posted, not sourced. */}
        {filming && SOURCE_TEXT[item.source].chip && (
          <span className="plan-source" data-source={item.source}>
            {SOURCE_TEXT[item.source].chip}
          </span>
        )}
      </div>

      {/* When it goes out, and what kind of card it is — in her words. Only on
          cards the 70/20/10 planner drafted; everything older renders as it
          always did. */}
      <div className="plan-kind" data-kind={kind}>
        <b>{KIND_TEXT[kind].label}</b>
        <span>{kind === 'repurpose' && item.repurposed_at ? REPURPOSE_READY : KIND_TEXT[kind].line}</span>
      </div>

      {/* A reskin's one line: what changes from the reference. Its own block
          rather than a line in the direction, because it is the whole card. */}
      {filming && item.twist && (
        <div className="plan-twist">
          <b>The twist</b>
          <span>{item.twist}</span>
        </div>
      )}

      {item.slot_time && item.slot_day !== null && (
        <p className="plan-when">
          <span>Post {DAYS[item.slot_day % DAYS.length]} at {item.slot_time}</span>
        </p>
      )}

      {/* Why this one is on her week. Plain words, because "8.53×" is a number
          she has no baseline for and would rightly ignore. Nothing is shown
          when the sweep has nothing true to say. */}
      {item.headline && <p className="plan-why">{item.headline}</p>}

      {/* The card as steps, in the order she works through it (Susanna,
          2026-09-27: "what to do, what to say, what to write", like the OF
          scripts). Numbered by what is actually on this card. */}
      {/* A custom card has no reference video at all — the directions ARE
          the card, so there is nothing to watch and the step says nothing. */}
      {(item.media || item.webpage_url) && (
      <Step no={++step} title="Watch it">
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

        {/* Two buttons, not a button and a sentence. */}
        <div className="plan-links">
          {item.webpage_url && (
            <a className={filming ? 'plan-cta' : 'plan-cta plan-cta-quiet'} href={item.webpage_url} target="_blank" rel="noreferrer">
              Open in Instagram
            </a>
          )}
          {(filming || kind === 'yours') && item.media && (
            <a className="plan-cta plan-cta-quiet" href={item.media.download}>Save video</a>
          )}
        </div>

        {/* Is this a good reference for her? Not "will you film it" — that is
            the Yes/No below. Her thumbs steer which reels she is sent next. */}
        <div className="plan-rate" role="group" aria-label={`Is ${cardId} a good reference for you?`}>
          <span className="plan-rate-q">Good reference for you?</span>
          <button
            type="button"
            className="plan-thumb"
            data-way="up"
            aria-pressed={rating === 1}
            aria-label="Yes — send me more like this"
            onClick={() => void rate(1)}
          >
            <span aria-hidden="true">👍</span>
          </button>
          <button
            type="button"
            className="plan-thumb"
            data-way="down"
            aria-pressed={rating === -1}
            aria-label="No — send me fewer like this"
            onClick={() => void rate(-1)}
          >
            <span aria-hidden="true">👎</span>
          </button>
          <span className="plan-rate-said" role="status">
            {rateFailed
              ? 'That did not save — tap it again.'
              : rating === 1 ? 'Got it — more like this.' : rating === -1 ? 'Got it — fewer like this.' : ''}
          </span>
        </div>
      </Step>
      )}

      {/* Editing notes are in-house now (Geno, 2026-10-07) — they live on
          the editing team's page, never on hers. The payload strips them
          too; this comment marks where they used to render. */}

      {/* Checked before she presses record, not after she has posted — the
          only moment any of it can still change the video. Folded (Geno,
          2026-10-06: "so many words") — the same eight lines on every card
          read as wallpaper by card three; a button she opens when she wants
          them keeps the card short and the list useful. */}
      {filming && (
        <Step no={++step} title="Before you film">
          <details className="plan-transcript plan-film-fold">
            <summary><span aria-hidden>&#128161;</span> Things you should know</summary>
            <ul className="plan-film-check">
              {FILM_CHECKLIST.map((check) => <li key={check}>{check}</li>)}
            </ul>
          </details>
        </Step>
      )}

      {filming && shotList && (
        <Step no={++step} title="Film it">
          {/* A planner card on her own winner still says what must not
              change — that is the whole test. A new idea says it once, at
              the top of the page. */}
          {item.bucket && (
            <div className="plan-rule">
              <span className="plan-label">{rule.label}</span>
              <dl className="plan-spec">
                <div className="plan-spec-row"><dt>Keep</dt><dd>{rule.keep}</dd></div>
                <div className="plan-spec-row"><dt>Change</dt><dd>{rule.change}</dd></div>
              </dl>
            </div>
          )}
          <ShotListView list={shotList} face={expression} />
          {item.bucket && item.wardrobe && (
            <p className="plan-shot-line"><span>Wardrobe</span>{item.wardrobe}</p>
          )}
          {item.blocks.length > 0 && (
            <details className="plan-transcript">
              <summary><span aria-hidden>🗣️</span> What they say, word for word</summary>
              <div>{words}</div>
            </details>
          )}
        </Step>
      )}

      {filming && !shotList && (
        <Step no={++step} title="Film it">
          {/* What she keeps exactly and what she changes. */}
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

          {item.editing_notes && (
            <p className="plan-editing">
              <span className="plan-label">Editing</span>
              {item.editing_notes}
            </p>
          )}
        </Step>
      )}

      {filming && !shotList && (
        <Step no={++step} title="What to say">
          {/* The reference's opening, only when it can be read — the screen
              reader's misreads ("Bal al") are filtered out on load. */}
          {item.hook ? (
            <div className="plan-hook">
              <span className="plan-label">It opens with</span>
              <p>&ldquo;{item.hook}&rdquo;</p>
              <span className="plan-hook-note">Say or show your own version of that line.</span>
            </div>
          ) : (
            <p className="plan-quiet">No opening line to copy — open on the idea straight away.</p>
          )}

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

          <details className="plan-transcript">
            <summary><span aria-hidden>🗣️</span> What they say, word for word</summary>
            <div>{words}</div>
          </details>
        </Step>
      )}

      {(captions.length > 0 || item.caption) && (
        <Step no={++step} title="What to write">
          <p className="plan-quiet">Pick one, tap Copy, and paste it under your video on Instagram.</p>
          <ul className="plan-options">
            {item.caption && (
              <li className="plan-option">
                <p>{item.caption}</p>
                <button type="button" className="plan-copy" onClick={copyCaption}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </li>
            )}
            {captions.map((option, index) => (
              <li key={index} className="plan-option">
                <p>{option.caption}</p>
                <button type="button" className="plan-copy" onClick={() => void copyOption(index, option.caption)}>
                  {copiedOption === index ? 'Copied' : 'Copy'}
                </button>
                {option.baits && (
                  <span className="plan-quiet plan-option-note">Gets comments like: &ldquo;{option.baits}&rdquo;</span>
                )}
                {/* Console only: where the caption came from. */}
                {preview && (
                  <span className="plan-quiet plan-option-note">
                    {option.from ? `Adapted from (${option.formula}): “${option.from}”` : `Real caption — ${option.formula}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Step>
      )}


      {/* The DM version, written only when Geno asks — he sends the portal
          link, not a message per video (2026-09-25). Console only. */}
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

      {/* Only on someone else's reel: her own reels and repurpose cards are
          hers already. Also on a card she marked, so she can take it back. */}
      {((kind === 'new' && verdict !== 'declined') || made) && (
        <MadeAlready
          token={token}
          item={item}
          made={made}
          preview={preview}
          onChange={(next) => {
            setMade(next)
            if (next) {
              setVerdict('accepted')
              onVerdict?.('accepted')
            }
          }}
        />
      )}

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
              : code
                ? ''
                : 'Pick what got in the way — then it moves to “Videos you can’t do” at the bottom.'}
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
              {state === 'saved' && (inGroup
                ? 'Sent — it is in your Telegram group chat too. We will answer there.'
                : 'Sent. We will answer here on this card.')}
              {state === 'failed' && 'That did not send — your words are still here, tap Send again.'}
            </p>
          </div>
        )}
      </div>
    </li>
  )
}

/** One numbered step of the card. */
function Step({ no, title, children }: { no: number; title: string; children: ReactNode }) {
  return (
    <section className="plan-step" aria-label={`Step ${no}: ${title}`}>
      <h3 className="plan-step-head">
        <span className="plan-step-num" aria-hidden="true">{no}</span>
        {title}
      </h3>
      {children}
    </section>
  )
}
