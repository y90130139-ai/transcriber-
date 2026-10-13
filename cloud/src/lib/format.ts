import type { Axis } from './taxonomy'

export type TagRow = { axis: Axis; tag: string; origin: 'auto' | 'human'; score: number | null }

export type LibraryItem = {
  id: string
  /** Set once it left the library at 90 days (lib/expiry.ts). */
  archived_at?: string | null
  /** Days before it leaves; null for a model's own reel, which never does. */
  expires_in?: number | null
  /** Kept past 90 days because a card that uses it is still open. */
  on_open_card?: boolean
  kind: 'link' | 'file'
  source: string
  label: string
  status: 'queued' | 'running' | 'done' | 'failed'
  stage: string | null
  error: string | null
  created_at: string
  /** Whether a speech pass was asked for. Now true on everything new — the
   *  pass costs about a second, so the label comes from listening. */
  transcribe: boolean
  /** What the pass heard. Null means no pass has run, which is not the same
   *  statement as "nobody talked". */
  has_speech: boolean | null
  /** Voiced seconds over duration, 0-1. Descriptive; nothing keys off it. */
  speech_ratio: number | null
  /** A human overruling the pass. Null means nobody has. */
  speech_override: boolean | null
  platform: string | null
  author: string | null
  author_name: string | null
  title: string | null
  webpage_url: string | null
  duration_sec: number | null
  language: string | null
  speaker_count: number | null
  word_count: number | null
  upload_date: string | null
  transcribed_at: string | null
  folder: string | null
  like_count: number | null
  comment_count: number | null
  confirmed_at: string | null
  has_thumb: boolean
  preview: string | null
  engagement_score?: number | null
  creator_posts?: number | null
  outperformance?: number | null
  /** Plain-language reasons this reel is worth making — see lib/appeal.ts.
   *  Absent on rows the sweep has never seen. */
  badges?: { label: string; detail: string; tone: 'hot' | 'warm' | 'cool' }[]
  /** Plays, when the sweep has them. */
  sig_plays?: number | string | null
  is_hot?: boolean | null
  tags?: TagRow[]
  /** Queue rows only: how many times the viewer has opened this reel. */
  view_tries?: number
}

export type Block = { speaker: string | null; start: number; text: string }

export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

/** 110125 -> 110k. Engagement figures are scanned, not read. */
export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value < 1000) return String(value)
  if (value < 1_000_000) {
    const thousands = value / 1000
    return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`
  }
  return `${(value / 1_000_000).toFixed(1)}m`
}

/** "6h ago" / "2d ago" — scanned, not read, like every other figure here. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '—'
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** A playbook label — the German doc's own row name, "German #12 · Shock +
 *  Stretch". These are written for humans and beat any filename or handle
 *  (Geno, 2026-10-13); everything else's label is URL-derived and does not. */
export function playbookLabel(label: string | null | undefined): string | null {
  return label && /^German #\d/.test(label) ? label : null
}

/** The name to put on the card: a playbook label when there is one, the
 *  @handle next, else the filename. A German reference is never "Main.mov". */
export function displayName(item: Pick<LibraryItem, 'author' | 'author_name' | 'title' | 'label'>): string {
  return playbookLabel(item.label) ?? item.author ?? item.author_name ?? item.title ?? item.label
}

export function metaBits(item: LibraryItem): string[] {
  const bits: string[] = []
  if (item.upload_date) bits.push(item.upload_date)
  if (item.like_count !== null) bits.push(`${compact(item.like_count)} likes`)
  if (item.comment_count !== null) bits.push(`${compact(item.comment_count)} comments`)
  if (item.speaker_count) bits.push(`${item.speaker_count} voice${item.speaker_count > 1 ? 's' : ''}`)
  return bits
}

export const thumbUrl = (id: string) => `/api/thumb/${id}`

/** Does anyone talk in this? A human's answer wins; otherwise the pass's.
 *  Null while nothing has listened yet and nobody has said. */
export function speaks(
  item: Pick<LibraryItem, 'has_speech' | 'speech_override'>,
): boolean | null {
  return item.speech_override ?? item.has_speech
}

/** Plain text with speaker labels, the format that pastes cleanly anywhere. */
export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((block) => (block.speaker ? `${block.speaker}: ${block.text}` : block.text))
    .join('\n\n')
}

/** The markdown a research note actually wants: source, numbers, tags, words. */
export function toMarkdown(item: LibraryItem, blocks: Block[], plain: string, tags: TagRow[]): string {
  const axes = (['persona', 'format', 'hook'] as Axis[])
    .map((axis) => {
      const chosen = tags.filter((tag) => tag.axis === axis).map((tag) => tag.tag)
      return chosen.length ? `- **${axis}:** ${chosen.join(', ')}` : null
    })
    .filter(Boolean)

  const facts = [
    item.upload_date ? `- **posted:** ${item.upload_date}` : null,
    item.like_count !== null ? `- **likes:** ${item.like_count.toLocaleString()}` : null,
    item.comment_count !== null ? `- **comments:** ${item.comment_count.toLocaleString()}` : null,
    item.outperformance ? `- **vs own median:** ${item.outperformance}×` : null,
    item.duration_sec ? `- **length:** ${clock(item.duration_sec)}` : null,
  ].filter(Boolean)

  return [
    `# ${displayName(item)}`,
    item.webpage_url ?? item.source,
    '',
    ...facts,
    ...axes,
    '',
    '## Transcript',
    '',
    blocks.length > 0 ? blocksToText(blocks) : plain,
  ].join('\n')
}
