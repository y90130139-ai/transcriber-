/**
 * The week's content styles — the CD brief's own structure (Geno, 2026-10-12).
 *
 * The brief a creative director sends opens with counted content styles
 * ("12 x Format reels, 1 x Omegle session, 14 x Talking reels, 7 x Picture
 * Posts") and then a section per style. The plan carries the same shape now:
 * a target per style on the week (`plans.style_targets`) and a `style` tag on
 * every card the Add content composer lands (`plan_items.style`).
 *
 * Additive on purpose — every card added before the composer has a null
 * style, counts as none of the lanes, and nothing about the older screens
 * changed.
 */

export type ContentStyle = 'format' | 'talking' | 'omegle' | 'posts'

export type StyleTargets = Partial<Record<ContentStyle, number>>

export const CONTENT_STYLES: {
  id: ContentStyle
  label: string
  /** The doc's own instruction line, shown on the style's tile. */
  line: string
}[] = [
  {
    id: 'format',
    label: 'Format reels',
    line: 'Numbered formats from the playbook — reference video, x2 versions, editor notes.',
  },
  {
    id: 'talking',
    label: 'Talking reels',
    line: 'A reference link or a HOOK + BODY — car or street, like FaceTime to a friend.',
  },
  {
    id: 'omegle',
    label: 'Omegle session',
    line: "One a week — Tom's training, games to play, questions to ask.",
  },
  {
    id: 'posts',
    label: 'Picture posts',
    line: 'IG wall posts from the shoot-day photos — no extra filming.',
  },
]

const IDS = new Set<string>(CONTENT_STYLES.map((style) => style.id))

export function isContentStyle(value: unknown): value is ContentStyle {
  return typeof value === 'string' && IDS.has(value)
}

export const STYLE_LABEL: Record<ContentStyle, string> = Object.fromEntries(
  CONTENT_STYLES.map((style) => [style.id, style.label]),
) as Record<ContentStyle, string>

/** Keep only real styles with sane counts — a stray key from an old client
 *  never lands on the week. Null when the payload was not an object at all. */
export function cleanStyleTargets(raw: unknown): StyleTargets | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const out: StyleTargets = {}
  for (const style of CONTENT_STYLES) {
    const value = record[style.id]
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[style.id] = Math.max(0, Math.min(200, Math.round(value)))
    }
  }
  return out
}

/** The suffix written by the versions tool, plus the shorter `(V2)` labels in
 *  existing plans. Keep both spellings in one parser so card grouping and the
 *  creator-facing version brief agree about which take this is. */
const VERSION_SUFFIX = /(?:\s*·\s*|\s+|\(\s*)(?:version\s*(\d+)|v\s*(\d+))\s*\)?\s*$/i

/** "69 · Black top transition · Version 2" → "69 · Black top transition".
 *  The same suffix the versions tool writes, so a group is one rule. */
export function conceptStem(title: string | null | undefined): string {
  return String(title ?? '').replace(VERSION_SUFFIX, '').trim()
}

/** The version number a title carries, or null — "X · Version 3" → 3. The
 *  plan list groups neighbouring versions of one concept under a single
 *  heading with these (Geno, 2026-10-13). */
export function versionOf(title: string | null | undefined): number | null {
  const match = String(title ?? '').match(VERSION_SUFFIX)
  return match ? Number(match[1] ?? match[2]) : null
}

export const versionTitle = (stem: string, n: number) => `${stem} · Version ${n}`

/** One version of a format card: what changes each time. */
export type CardVersion = { outfit: string; caption: string }

/** How many versions one card may carry. A week, not a catalogue. */
export const MAX_CARD_VERSIONS = 8

/** Versions from a request body, cleaned: strings only, clipped, empty rows
 *  dropped, capped. Null when the payload is not an array at all — callers
 *  treat null as "no change", [] as "clear". */
export function cleanVersions(raw: unknown): CardVersion[] | null {
  if (!Array.isArray(raw)) return null
  const text = (value: unknown, max: number) =>
    typeof value === 'string' ? value.trim().slice(0, max) : ''
  const rows = raw
    .slice(0, MAX_CARD_VERSIONS)
    .map((row) => {
      const entry = (row ?? {}) as { outfit?: unknown; caption?: unknown }
      return { outfit: text(entry.outfit, 300), caption: text(entry.caption, 500) }
    })
    .filter((row) => row.outfit || row.caption)
  return rows
}
