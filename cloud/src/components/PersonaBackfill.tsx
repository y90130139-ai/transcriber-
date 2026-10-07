'use client'

import { useEffect, useState } from 'react'
import { labelOf, taxonomy, toneOf } from '@/lib/taxonomy'

/** One creator's shelf, and what the lexicon makes of it. */
type Proposal = {
  handle: string
  posts: number
  /** How many of their items already carry any persona tag. */
  tagged: number
  /** What a human has already stood behind for this creator. */
  persona: string[]
  proposed: {
    tag: string
    score: number
    /** The lexicon phrases that fired across everything they have said. */
    phrases: string[]
    /** How many of their posts already carry this tag, and how many of those a
     *  human put there. Usually the stronger of the two kinds of evidence:
     *  most of this library is short and half of it barely spoken. */
    onPosts: number
    byHand: number
  }[]
}

/** How many creators a sitting is. Ten covers most of the library by volume. */
export const BATCH = 10

/** How many of the matched phrases to show before the rest become a count.
 *  The evidence has to be readable at a glance or it stops being read. */
const PHRASES_SHOWN = 6

/**
 * Persona backfill — draft, then approve.
 *
 * Only 44 of 166 items carry a persona tag. That is not primarily a FIT
 * problem: format tags author the brief, so an untagged item briefs generically
 * and hands a creator a card with four default lines on it.
 *
 * Deliberately not a bulk auto-tagger. A persona is a claim about a person and
 * must not be written by a machine unreviewed — so this proposes per creator,
 * shows the words that fired, and writes nothing until somebody approves it.
 * Approving one carries it to every item that creator has ever posted, which is
 * the level a persona is actually true at.
 *
 * The point is to make approving ten creators take ten minutes, not to guess
 * 166 times.
 */
/** Why this tag is being offered, in one line. Tag evidence first: it is the
 *  stronger claim, and on this library it is usually the only one there is. */
function why(one: Proposal['proposed'][number], posts: number): string {
  const parts: string[] = []
  if (one.onPosts > 0) {
    parts.push(
      `already on ${one.onPosts} of ${posts} post${posts === 1 ? '' : 's'}` +
      (one.byHand > 0
        ? one.byHand === one.onPosts ? ', every one of them by hand' : `, ${one.byHand} by hand`
        : ', all of them guessed'),
    )
  }
  if (one.phrases.length > 0) {
    parts.push(
      one.phrases.slice(0, PHRASES_SHOWN).map((phrase) => `“${phrase}”`).join(', ') +
      (one.phrases.length > PHRASES_SHOWN ? ` and ${one.phrases.length - PHRASES_SHOWN} more` : ''),
    )
  }
  return parts.join(' · ')
}

export default function PersonaBackfill({ onApplied, open, onOpenChange }: {
  onApplied: () => void
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const [rows, setRows] = useState<Proposal[] | null>(null)
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function load() {
    setNote(null)
    const response = await fetch(`/api/creators?propose=${BATCH}`)
    if (!response.ok) { setNote('Could not read the proposals.'); return }
    const body = await response.json()
    const proposals: Proposal[] = body.proposals ?? []
    setRows(proposals)
    // Pre-selected with whatever is already stood behind, falling back to the
    // proposal. Approving is then one tap when the guess is right and a
    // correction when it is not — never a blank form.
    setChosen(Object.fromEntries(proposals.map((row) => [
      row.handle,
      row.persona.length > 0 ? row.persona : row.proposed.map((one) => one.tag),
    ])))
  }

  // The trigger lives in the tab header now; opening it is what asks for the
  // proposals, once.
  useEffect(() => {
    if (open && rows === null) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function toggle(handle: string, tag: string) {
    setChosen((current) => {
      const held = current[handle] ?? []
      return {
        ...current,
        [handle]: held.includes(tag) ? held.filter((one) => one !== tag) : [...held, tag],
      }
    })
  }

  /** Approve one creator. This is the only thing here that writes. */
  async function approve(row: Proposal) {
    setBusy(row.handle)
    setNote(null)
    const response = await fetch(`/api/creators/${encodeURIComponent(row.handle)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: chosen[row.handle] ?? [], apply: true }),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(null)
    if (!response.ok) { setNote(body.error ?? `Could not save ${row.handle}.`); return }
    setDone((current) => ({
      ...current,
      [row.handle]: (chosen[row.handle] ?? []).length === 0
        ? `Cleared across ${body.posts ?? row.posts} posts`
        : `On all ${body.posts ?? row.posts} posts`,
    }))
    onApplied()
  }

  if (!open) return null

  return (
    <section className="backfill" aria-label="Persona backfill">
      <div className="section-head">
        <h2 style={{ fontSize: 'var(--sc-text-lg)' }}>Persona backfill</h2>
        <button className="pill" onClick={() => onOpenChange(false)}>Close</button>
      </div>
      <p className="hint">
        Proposed from their own shelf, with the words that suggested it. Carries
        to every post of theirs once approved.
      </p>

      {rows === null ? (
        <p className="hint">Reading their shelves…</p>
      ) : rows.length === 0 ? (
        <p className="hint">No creators held yet.</p>
      ) : (
        <ul className="backfill-rows">
          {rows.map((row) => {
            const picked = chosen[row.handle] ?? []
            return (
              <li key={row.handle} className="backfill-row" data-done={row.handle in done || undefined}>
                <div className="backfill-who">
                  <b>{row.handle}</b>
                  <span className="planrow-meta">
                    {row.posts} post{row.posts === 1 ? '' : 's'} · {row.tagged} already tagged
                  </span>
                </div>

                {row.proposed.length === 0 && picked.length === 0 ? (
                  <p className="hint">Nothing points anywhere — pick by hand or leave them.</p>
                ) : (
                  <div className="chips">
                    {[...new Set([...picked, ...row.proposed.map((one) => one.tag)])].map((tag) => (
                      <button
                        key={tag}
                        className="chip"
                        data-on={picked.includes(tag)}
                        data-tone={toneOf('persona', tag)}
                        onClick={() => toggle(row.handle, tag)}
                      >
                        {labelOf('persona', tag)}
                      </button>
                    ))}
                  </div>
                )}

                {/* Stood behind on the creator, but never carried down onto
                    what they have already posted — which is the exact gap this
                    panel exists to close, so it is worth naming. */}
                {row.persona.length > 0 && row.tagged === 0 && (
                  <p className="hint">Set on them, on none of their {row.posts} posts yet.</p>
                )}

                {/* The evidence. Approving a claim about a person without it is
                    a rubber stamp, not a decision. */}
                {row.proposed.length > 0 && (
                  <p className="backfill-why">
                    {row.proposed.map((one) => (
                      <span key={one.tag}>
                        <b>{labelOf('persona', one.tag)}</b>
                        {' — '}
                        {why(one, row.posts)}
                      </span>
                    ))}
                  </p>
                )}

                {editing === row.handle && (
                  <div className="filter-tags">
                    {taxonomy.persona.tags.map((tag) => (
                      <button
                        key={tag.id}
                        className="chip"
                        data-on={picked.includes(tag.id)}
                        data-tone={toneOf('persona', tag.id)}
                        onClick={() => toggle(row.handle, tag.id)}
                      >
                        {tag.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="backfill-actions">
                  <button
                    className="pill"
                    disabled={busy === row.handle}
                    onClick={() => void approve(row)}
                  >
                    {busy === row.handle ? 'Saving' : 'Approve'}
                  </button>
                  <button
                    className="pill"
                    onClick={() => setEditing(editing === row.handle ? null : row.handle)}
                  >
                    {editing === row.handle ? 'Done' : 'Correct it'}
                  </button>
                  {done[row.handle] && <span className="hint">{done[row.handle]}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {note && <p className="hint" data-tone="bad">{note}</p>}
    </section>
  )
}
