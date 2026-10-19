'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CoverThumb from './CoverThumb'
import { formatDate } from '@/lib/dates'
import { cardForKey, findCards, parseCardQuery, snippetAround, type FindableCard } from '@/lib/card-find'

export { cardForKey }

type Props = {
  modelId: string
  open: boolean
  onClose: () => void
  /** Go to this card: switch the editor to its week and open it. */
  onPick: (card: FindableCard) => void
}

const TTL_MS = 60_000
const cache = new Map<string, { at: number; cards: FindableCard[] }>()
const flight = new Map<string, Promise<FindableCard[]>>()

/** Her card history, one read per model per minute. Exported because the
 *  editor also needs it cold, to resolve a `?card=` link before the panel
 *  has ever been opened. */
export function fetchCards(modelId: string, fresh = false): Promise<FindableCard[]> {
  const held = cache.get(modelId)
  if (!fresh && held && Date.now() - held.at <= TTL_MS) return Promise.resolve(held.cards)
  const inflight = flight.get(modelId)
  if (inflight) return inflight
  const request = fetch(`/api/models/${modelId}/cards`)
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((body: { cards?: FindableCard[] }) => {
      const cards = body.cards ?? []
      cache.set(modelId, { at: Date.now(), cards })
      return cards
    })
    .finally(() => { flight.delete(modelId) })
  flight.set(modelId, request)
  return request
}

/** Forget a model's history after the week changes under it. */
export function dropCards(modelId: string): void {
  cache.delete(modelId)
}

const VERDICT_TEXT: Record<FindableCard['verdict'], string> = {
  open: 'unanswered',
  accepted: 'yes',
  declined: 'no',
}

/**
 * Find a card — the way back from what she said to the video she meant.
 *
 * She answers by label ("V-87") and her labels run past a hundred across a
 * dozen weeks, so the label alone used to mean opening week after week and
 * scrolling (Geno, 2026-10-11). Type the number, a word from the card, the
 * creator's handle, or something she wrote, and the result jumps the editor
 * straight onto that card. Empty, it is her whole history, newest first, with
 * anything she has said and nobody has read at the top.
 */
export default function FindCard({ modelId, open, onClose, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<FindableCard[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const load = useCallback(() => {
    setFailed(false)
    fetchCards(modelId)
      .then(setCards)
      .catch(() => setFailed(true))
  }, [modelId])

  useEffect(() => {
    if (!open) return
    load()
    input.current?.focus()
  }, [open, load])

  // A fresh open is a fresh search; the old query would hide the unread notes
  // that are the usual reason for coming here.
  useEffect(() => { if (!open) { setQuery(''); setCursor(0); setCopied(null) } }, [open])

  const results = useMemo(() => (cards ? findCards(cards, query) : []), [cards, query])
  useEffect(() => { setCursor(0) }, [query])

  const words = useMemo(() => parseCardQuery(query).words, [query])
  const unread = useMemo(() => (cards ?? []).filter((card) => card.unread).length, [cards])

  const go = useCallback((card: FindableCard) => { onPick(card); onClose() }, [onPick, onClose])

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { onClose(); return }
    if (event.key === 'Enter') {
      const card = results[cursor]
      if (card) { event.preventDefault(); go(card) }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    setCursor((at) => {
      const next = event.key === 'ArrowDown' ? at + 1 : at - 1
      const bounded = Math.max(0, Math.min(results.length - 1, next))
      list.current?.children[bounded]?.scrollIntoView({ block: 'nearest' })
      return bounded
    })
  }

  async function copyLink(card: FindableCard) {
    const url = `${window.location.origin}/models?plan=${modelId}&card=${card.item_id}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(card.item_id)
      window.setTimeout(() => setCopied((at) => (at === card.item_id ? null : at)), 1600)
    } catch {
      setCopied(null)
    }
  }

  if (!open) return null

  return (
    <>
      <button className="findcard-scrim" aria-label="Close find a card" onClick={onClose} />
      <div className="findcard" role="dialog" aria-modal="true" aria-label="Find a card" onKeyDown={onKeyDown}>
        <div className="findcard-head">
          <input
            ref={input}
            className="findcard-input"
            type="search"
            value={query}
            placeholder="V-87, a word from the card, a handle, or what they said"
            aria-label="Find a card"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="btn btn-quiet btn-small" onClick={onClose}>Close</button>
        </div>

        <p className="findcard-count" role="status">
          {failed
            ? 'Could not read their cards.'
            : cards === null
              ? 'Reading every card they have had…'
              : query
                ? `${results.length} of ${cards.length} card${cards.length === 1 ? '' : 's'}`
                : `${cards.length} card${cards.length === 1 ? '' : 's'}, newest first${unread > 0 ? ` · ${unread} unread` : ''}`}
          {failed && <button className="btn btn-quiet btn-small" onClick={load}>Try again</button>}
        </p>

        <ul className="findcard-list" ref={list}>
          {results.map((card, index) => {
            const label = card.card_no ? `V-${card.card_no}` : 'No number'
            const name = card.item_title || card.reel_title || (card.author ? `@${card.author}` : 'Untitled card')
            const said = card.model_note ?? card.decline_reason
            return (
              <li key={card.item_id}>
                <button
                  type="button"
                  className="findcard-row"
                  data-on={index === cursor || undefined}
                  data-unread={card.unread || undefined}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(card)}
                >
                  <CoverThumb
                    jobId={card.job_id}
                    hasThumb={card.has_thumb}
                    className="findcard-thumb"
                    blankClassName="findcard-thumb findcard-thumb-blank"
                    width={64}
                    height={80}
                  />
                  <span className="findcard-text">
                    <span className="findcard-line">
                      <b className="findcard-no">{label}</b>
                      <span className="findcard-week">{formatDate(card.week_of)}</span>
                      <span className="findcard-verdict" data-verdict={card.verdict}>
                        {card.filmed ? 'filmed' : VERDICT_TEXT[card.verdict]}
                      </span>
                      {card.unread && <span className="findcard-unread">unread</span>}
                    </span>
                    <span className="findcard-name">{name}</span>
                    {card.author && card.item_title && <span className="findcard-author">@{card.author}</span>}
                    {said && (
                      <span className="findcard-said">
                        “{snippetAround(said, words)}”
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className="findcard-copy"
                  title="Copy a link straight to this card"
                  onClick={() => void copyLink(card)}
                >
                  {copied === card.item_id ? 'Copied' : 'Link'}
                </button>
              </li>
            )
          })}
        </ul>

        {cards !== null && results.length === 0 && !failed && (
          <p className="findcard-empty">
            {cards.length === 0
              ? 'They have never been sent a card.'
              : `Nothing matches “${query}”. Try the number on its own, or a word from what they said.`}
          </p>
        )}
      </div>
    </>
  )
}
