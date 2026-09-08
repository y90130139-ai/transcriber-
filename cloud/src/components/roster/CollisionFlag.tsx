'use client'

import { formatDate } from '@/lib/dates'
import type { Collision } from './types'

/** How many are named before the rest become a count. Two names is enough to
 *  recognise a collision; six is a paragraph nobody reads. */
const NAMED = 2

/**
 * Who else is already carrying this reel.
 *
 * `match.ts` excludes what is already on a plan, but only the plan of the model
 * being looked at. With one model that is complete; with ten, one strong reel
 * is the top suggestion for every one of them in the same week and nothing said
 * so. This says so.
 *
 * It warns and does not block — Geno's decision, 2026-09-06: two creators on
 * one trend is sometimes exactly what is wanted. The flag exists so that when
 * it happens it is a choice rather than an accident.
 *
 * Uses the same `.rosterflag` treatment as the sweep's exception flags rather
 * than a badge of its own, because it is the same kind of statement.
 */
export default function CollisionFlag({ on }: { on: Collision[] }) {
  if (!on || on.length === 0) return null

  const named = on.slice(0, NAMED)
    .map((other) => `${other.name}’s week of ${formatDate(other.week_of)}`)
    .join(', ')
  const rest = Math.max(on.length - NAMED, 0)

  return (
    <span className="rosterflags">
      <span className="rosterflag" data-tone="warn">
        already on {named}{rest > 0 ? ` and ${rest} more` : ''}
      </span>
    </span>
  )
}
