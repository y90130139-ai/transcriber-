/**
 * The weekly Instagram story cadence read (Geno, 2026-10-10).
 *
 * Scout's daily pass is the only thing that can see stories at all — a story
 * is gone in 24 hours, so `creator_snapshots` records once a day whether one
 * was up. That gives days-with-a-story out of days-looked-at, and this turns
 * it into one message in MODEL PERFORMANCE every Monday so Geno and Iona can
 * tell a model personally that she is slipping, rather than finding out a
 * month later.
 *
 *   keeping it up   a story on 80%+ of the days we looked
 *   slipping        under 50%, with "nothing at all" called out separately
 *   in between      nothing said - 50-79% is not worth a message either way
 *
 * Two guards keep it honest. A model with no Instagram handle on her profile
 * is left out entirely: there is nothing to measure and it is a portal gap,
 * not a story habit. A model we have looked at fewer than 3 days gets one
 * short "too new to say" line instead of a confident 0%, the same floor the
 * scorecard's story target uses.
 *
 * The body is written here; the Gosian bot appends the tag line from
 * `model_performance.social` in its calendar, so changing who is told is an
 * edit there and no deploy here.
 */
export const STORY_CADENCE = {
  windowDays: 7 as const,
  /** At or above this share of looked-at days: she is keeping it up. */
  strong: 0.8,
  /** Below this share: she is slipping and someone should tell her. */
  slipping: 0.5,
  /** Fewer readings than this says nothing at all about her. */
  minObserved: 3,
}

export type StoryStanding = {
  name: string
  days: number
  observed: number
  /** Days with a story over days looked at, or null when too new to say. */
  share: number | null
  bucket: 'strong' | 'slipping' | 'silent' | 'steady' | 'unknown'
}

const pct = (share: number) => `${Math.round(share * 100)}%`

/** Where one model stands. Pure. */
export function standingFor(m: { name: string; handles: string[]; story_days: number; story_days_observed: number }): StoryStanding | null {
  if (!m.handles.length) return null
  const days = Math.max(0, Number(m.story_days) || 0)
  const observed = Math.max(0, Number(m.story_days_observed) || 0)
  if (observed < STORY_CADENCE.minObserved) {
    return { name: m.name, days, observed, share: null, bucket: 'unknown' }
  }
  const share = days / observed
  const bucket = days === 0
    ? 'silent'
    : share < STORY_CADENCE.slipping
      ? 'slipping'
      : share >= STORY_CADENCE.strong
        ? 'strong'
        : 'steady'
  return { name: m.name, days, observed, share, bucket }
}

const worstFirst = (a: StoryStanding, b: StoryStanding) => (a.share ?? 0) - (b.share ?? 0) || a.name.localeCompare(b.name)
const bestFirst = (a: StoryStanding, b: StoryStanding) => (b.share ?? 0) - (a.share ?? 0) || a.name.localeCompare(b.name)

/**
 * The message, or null when there is nothing worth sending. Pure: hand it the
 * standings and the label for the week it covers.
 */
export function composeStoryCadence(standings: StoryStanding[], weekLabel: string): string | null {
  const silent = standings.filter((s) => s.bucket === 'silent').sort(worstFirst)
  const slipping = standings.filter((s) => s.bucket === 'slipping').sort(worstFirst)
  const strong = standings.filter((s) => s.bucket === 'strong').sort(bestFirst)
  const unknown = standings.filter((s) => s.bucket === 'unknown')
  if (!silent.length && !slipping.length && !strong.length) return null

  const lines = [`📱 INSTAGRAM STORIES — ${weekLabel}`]
  if (silent.length || slipping.length) {
    lines.push('', `🔴 Slipping (under ${pct(STORY_CADENCE.slipping)})`)
    for (const s of silent) lines.push(`   ${s.name} — nothing at all, 0 of ${s.observed} days`)
    for (const s of slipping) lines.push(`   ${s.name} — ${s.days} of ${s.observed} days (${pct(s.share as number)})`)
  }
  if (strong.length) {
    lines.push('', `🟢 Keeping it up (${pct(STORY_CADENCE.strong)}+)`)
    for (const s of strong) lines.push(`   ${s.name} — ${s.days} of ${s.observed} days (${pct(s.share as number)})`);
  }
  // Said once, in one line: without it a model nobody has looked at reads as
  // fine, and that is the one way this message could mislead.
  if (unknown.length) lines.push('', `⏳ Too new to say: ${unknown.map((s) => s.name).join(', ')}`);
  return lines.join('\n')
}
