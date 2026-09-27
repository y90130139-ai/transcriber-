'use client'

import { useState } from 'react'
import { DECLINE_LABEL, isDeclineCode, isPermanentDecline } from '@/lib/decline'
import type { PlanItem } from '@/lib/plans'

/** Why she said no, as the page last knew it — from the server, or from the
 *  tap that just moved the card here. */
export type CantDoReason = { code: string | null; reason: string | null }

export const cardIdOf = (item: Pick<PlanItem, 'card_no'>, fallback: number) =>
  item.card_no ? `V-${item.card_no}` : `Video ${fallback}`

/**
 * "Videos you can't do" — the cards she turned down, out of her feed.
 *
 * Geno, 2026-09-27: the feed is what she has to film, so a "no" should leave
 * it; and a no tapped by accident, or one she changes her mind about, needs a
 * way back. Folded at the foot of the page, one compact row each, with "Add
 * back to plan".
 */
export function CantDoSection({
  items,
  reasons,
  onAddBack,
}: {
  items: PlanItem[]
  reasons: Map<string, CantDoReason>
  /** Resolves false when the change did not save — the row stays and says so. */
  onAddBack: (id: string) => Promise<boolean>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  if (items.length === 0) return null

  async function addBack(id: string) {
    setBusy(id)
    setFailed(null)
    const ok = await onAddBack(id)
    setBusy(null)
    if (!ok) setFailed(id)
  }

  return (
    <section className="plan-cantdo" aria-labelledby="plan-cantdo-head">
      <details className="plan-cantdo-fold">
        <summary>
          <span id="plan-cantdo-head">Videos you can&rsquo;t do</span>
          <span className="plan-cantdo-count">{items.length}</span>
        </summary>
        <p className="plan-cantdo-note">
          Out of your plan. Tapped one by mistake, or changed your mind? Add it back.
        </p>
        <ul className="plan-cantdo-list">
          {items.map((item, index) => {
            const why = reasons.get(item.id)
            const code = why?.code ?? null
            return (
              <li key={item.id} className="plan-cantdo-row">
                <div className="plan-cantdo-what">
                  <b>{cardIdOf(item, index + 1)}</b>
                  {item.title && <span>{item.title}</span>}
                  <span className="plan-quiet">
                    {/* Her own words stand alone when she typed them without
                        picking a chip — "No reason given" beside them is wrong. */}
                    {isDeclineCode(code)
                      ? `${DECLINE_LABEL[code]}${why?.reason ? ` — “${why.reason}”` : ''}`
                      : why?.reason ? `“${why.reason}”` : 'No reason given'}
                    {' · '}
                    {isPermanentDecline(code) ? 'won’t be sent again' : 'may come back another week'}
                  </span>
                  {failed === item.id && (
                    <span className="plan-cantdo-failed" role="status">That did not save — tap it again.</span>
                  )}
                </div>
                <button
                  type="button"
                  className="plan-cantdo-back"
                  disabled={busy === item.id}
                  onClick={() => void addBack(item.id)}
                >
                  {busy === item.id ? 'Adding…' : 'Add back to plan'}
                </button>
              </li>
            )
          })}
        </ul>
      </details>
    </section>
  )
}

/** The moment a card leaves her feed: says where it went, with Undo for the
 *  accidental tap. */
export function CantDoNotice({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div className="plan-cantdo-notice" role="status">
      <span>{label} moved to &ldquo;Videos you can&rsquo;t do&rdquo;</span>
      <button type="button" onClick={onUndo}>Undo</button>
    </div>
  )
}
