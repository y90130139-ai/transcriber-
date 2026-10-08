/**
 * Where a card came from — the mixed-source plan (Geno, 2026-10-08).
 *
 * The FansLink docs this copies mix four kinds of material in one week:
 * reference reels sent as-is, reskins (a reference plus the one line that
 * changes it), fully hand-written scripts, and blanks filled in on a call.
 * Today every card quietly pretends to be the same kind of thing; the tag
 * names the source on the card — which is also an honest workload plan,
 * because the hand-made cards are the hours the week costs us.
 *
 * Pure on purpose: imported by her page, the console editor and the tests.
 */

export type CardSource = 'reference' | 'reskin' | 'original' | 'ai_draft' | 'blank'

export const CARD_SOURCES: readonly CardSource[] = [
  'reference', 'reskin', 'original', 'ai_draft', 'blank',
]

export function isSource(value: unknown): value is CardSource {
  return (CARD_SOURCES as readonly unknown[]).includes(value)
}

/**
 * The stored tag when someone set one; otherwise read off the bucket, so the
 * whole existing library of cards tags itself without a backfill:
 *
 *   custom              → original   (the team wrote it, no video behind it)
 *   reskin / iteration  → reskin     (her own winner, run again with a twist)
 *   everything else     → reference  (a library reel to copy)
 */
export function sourceOf(stored: unknown, bucket: string | null): CardSource {
  if (isSource(stored)) return stored
  if (bucket === 'custom') return 'original'
  if (bucket === 'reskin' || bucket === 'iteration') return 'reskin'
  return 'reference'
}

/** `chip` is her wording — model-facing, so no jargon. Null chip = the tag is
 *  internal and her card shows nothing. `console` is the team's word. */
export const SOURCE_TEXT: Record<CardSource, { chip: string | null; line: string; console: string }> = {
  reference: {
    chip: 'Copy this one',
    line: 'Copy the idea exactly — your people and reactions never have to match.',
    console: 'Reference',
  },
  reskin: {
    chip: 'Your twist on it',
    line: 'Same video — one thing changes. The twist on the card says what.',
    console: 'Reskin',
  },
  original: {
    chip: 'Made for you',
    line: 'No video to copy — this one was written for you. Say it your way.',
    console: 'Original',
  },
  ai_draft: { chip: null, line: '', console: 'AI draft' },
  blank: { chip: null, line: '', console: 'Blank' },
}

/** An AI draft nobody approved and a blank nobody filled never reach her
 *  phone — the preview hides them too, because the preview IS her page. */
export function hiddenFromModel(source: CardSource): boolean {
  return source === 'ai_draft' || source === 'blank'
}

/** "6 to copy · 4 with a twist · 3 made for you" — the one line under the
 *  plan's contents that says where the week came from. Null when there is
 *  nothing to say (all zero), and zero-count parts are left out. */
export function sourceLine(items: { source: CardSource }[]): string | null {
  let reference = 0
  let reskin = 0
  let original = 0
  for (const item of items) {
    if (item.source === 'reference') reference += 1
    else if (item.source === 'reskin') reskin += 1
    else if (item.source === 'original') original += 1
  }
  const parts = [
    reference > 0 ? `${reference} to copy` : null,
    reskin > 0 ? `${reskin} with a twist` : null,
    original > 0 ? `${original} made for you` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}
