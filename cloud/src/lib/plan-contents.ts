/**
 * "In this plan" — what the week actually contains, counted.
 *
 * Grouped by the card's title, so "BODY BASED #4" and "BODY BASED REEL #6"
 * are one line, "Body based", and "TALKING HEAD #3" is "Talking head".
 * A card with no title still counts by its format tag, and one with
 * neither is "Videos". Pure, so the shape is tested.
 */
import { labelOf } from './taxonomy'

export type ContentLine = { count: number; label: string }

/** A card as this needs it: the title she reads, and the format tags behind it. */
export type ContentCard = { formats: string[]; title?: string | null }

/** "BODY BASED REEL #6" → "Body based". The number and a trailing "reel"
 *  are the same family, not a different kind of card. */
function familyOf(title: string): string | null {
  const stem = title
    .replace(/\s+#\d+\b.*$/, '')
    .replace(/\s+\d+\s*$/, '')
    .replace(/\s+reel\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!stem) return null
  const lower = stem.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function contentLines(cards: ContentCard[]): ContentLine[] {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const fromTitle = card.title ? familyOf(card.title) : null
    const tag = card.formats[0]
    const key = fromTitle ?? (tag ? labelOf('format', tag) : 'Videos')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ count, label }))
}
