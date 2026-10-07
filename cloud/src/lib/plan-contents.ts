/**
 * "In this plan" — what the week actually contains, counted (Geno,
 * 2026-10-06, off a competitor's sheet: "14 x Skits, 7 x Talking heads…").
 * Replaces the free-text intro, which he cut the same day: a written
 * paragraph says less than the counts do.
 *
 * Counts come from each card's primary format tag, named with the
 * taxonomy's own labels. Cards whose reference carries no format tag are
 * counted honestly as "Videos". Pure, so the shape is tested.
 */
import { labelOf } from './taxonomy'

export type ContentLine = { count: number; label: string }

/** A card as this needs it: its format tags, nothing else. */
export type ContentCard = { formats: string[] }

export function contentLines(cards: ContentCard[]): ContentLine[] {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const key = card.formats[0] ?? ''
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({
      count,
      label: tag ? labelOf('format', tag) : 'Videos',
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
