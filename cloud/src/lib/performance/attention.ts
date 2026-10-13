/**
 * One card per creator, per division (Geno, 2026-10-11).
 *
 * The rule he set: everything the team needs to know about ONE creator arrives
 * in ONE message, not a message per signal. The only thing that splits a
 * creator across two cards is the division, because different people act on
 * them — her Instagram goes to Geno and Iona, her OnlyFans money to Geno,
 * Paige and Marinko. So this builds the Instagram half; the earnings job packs
 * the money half the same way.
 *
 * What puts a creator on a card:
 *
 *   needs attention   the dashboard's own tag — quiet 14+ days, trending down,
 *                     or posting under a quarter of her weekly target
 *   slipped           she was a Top performer last week and is not any more,
 *                     which no single week's numbers can show
 *   stories           a story on under half the days we looked
 *
 * A creator who is fine appears nowhere. Her reasons are the dashboard's own
 * words, so the card and the portal can never disagree about why she is on it.
 */
import { TAG_LABEL, type Direction, type TagKey } from './math'

/** Everything the card can say about one creator. */
export type IgStanding = {
  name: string
  tag: TagKey | null
  /** Her tag the last time this ran, or null if she was not seen. */
  wasTag: TagKey | null
  trend: Direction | null
  reasons: string[]
  followersGain: number | null
  viewsChange: number | null
  reelsPerWeek: number
  storyDays: number
  storyObserved: number
  lastPostedAt: string | null
}

export const STORY = {
  /** At or above this share of days looked at: she is keeping it up. */
  strong: 0.8,
  /** Below this: it belongs on her card. */
  slipping: 0.5,
  /** Fewer readings than this says nothing about her either way. */
  minObserved: 3,
}

/** Her story share, or null when too few days have been looked at. Pure. */
export function storyShare(s: Pick<IgStanding, 'storyDays' | 'storyObserved'>): number | null {
  const observed = Math.max(0, Number(s.storyObserved) || 0)
  if (observed < STORY.minObserved) return null
  return Math.max(0, Number(s.storyDays) || 0) / observed
}

/** She was a Top performer and is not any more. Pure. */
export const slipped = (s: IgStanding): boolean => s.wasTag === 'top' && s.tag !== 'top'

/** Does she belong on a card at all? Pure. */
export function needsCard(s: IgStanding): boolean {
  const share = storyShare(s)
  return s.tag === 'attention' || slipped(s) || s.trend === 'down' || (share !== null && share < STORY.slipping)
}

const pct = (share: number) => `${Math.round(share * 100)}%`
const days = (iso: string | null, now: number) =>
  iso ? Math.floor((now - Date.parse(iso)) / 86_400_000) : null

/**
 * Her card, or null if she does not need one. Every line is one thing someone
 * can act on; nothing is repeated between lines. Pure.
 */
export function igCard(s: IgStanding, now = Date.now()): string | null {
  if (!needsCard(s)) return null
  const fell = slipped(s)
  const head = fell
    ? `⬇️ ${s.name} — slipped from Top performer`
    : `📉 ${s.name} — Instagram needs attention`

  const lines: string[] = []
  // The slip is the news, and the headline alone does not say what she is now.
  // It leads, because nothing in this week's numbers would reveal it.
  if (fell) lines.push(`   • Was Top performer last week, now ${(s.tag ? TAG_LABEL[s.tag] : 'too quiet to judge').toLowerCase()}.`)
  // Then the dashboard's own words, so the card and the portal agree.
  for (const reason of s.reasons) lines.push(`   • ${reason}`)
  // Trending down is already one of those reasons when it holds; say it here
  // only when it does not (she slipped, or stories put her on the card).
  if (s.trend === 'down' && !s.reasons.some((r) => /trending down/i.test(r))) {
    lines.push('   • Trending down on views and followers.')
  }
  const share = storyShare(s)
  if (share !== null && share < STORY.slipping) {
    lines.push(s.storyDays === 0
      ? `   • No stories at all — 0 of ${s.storyObserved} days looked at.`
      : `   • Stories on ${s.storyDays} of ${s.storyObserved} days (${pct(share)}).`)
  }
  const quiet = days(s.lastPostedAt, now)
  if (quiet !== null && quiet >= 7 && !s.reasons.some((r) => /nothing posted/i.test(r))) {
    lines.push(`   • Last posted ${quiet} days ago.`)
  }
  if (!lines.length) return null
  return [head, ...lines].join('\n')
}

/**
 * The whole Instagram half of a week: her cards, worst first, plus the short
 * good-news line. Returns the body, or null when nobody needs anything. Pure.
 */
export function igDigest(standings: IgStanding[], now = Date.now()): string | null {
  const cards = standings
    .filter((s) => needsCard(s))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((s) => igCard(s, now))
    .filter((c): c is string => c !== null)
  if (!cards.length) return null
  return cards.join('\n\n')
}

// Slipped from the top first — it is the one nobody would otherwise notice —
// then needs attention, then the rest.
const rank = (s: IgStanding) => (slipped(s) ? 0 : s.tag === 'attention' ? 1 : 2)

/** Who kept stories up, as one line. Good news, nobody to chase. Pure. */
export function storyGoodNews(standings: IgStanding[]): string | null {
  const strong = standings
    .filter((s) => (storyShare(s) ?? 0) >= STORY.strong)
    .sort((a, b) => (storyShare(b) ?? 0) - (storyShare(a) ?? 0) || a.name.localeCompare(b.name))
  if (!strong.length) return null
  const named = strong.map((s) => `${s.name} ${s.storyDays}/${s.storyObserved}`).join(' · ')
  return `🟢 Stories kept up (${pct(STORY.strong)}+): ${named}`
}
