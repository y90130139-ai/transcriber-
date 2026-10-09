/**
 * Deterministic topic detection. No model, no inference, no network — a
 * curated lexicon plus recurring-phrase extraction over post titles.
 *
 * The rules are deliberately simple because they have to be explainable: a
 * topic this engine reports is either a phrase someone wrote a rule for, or
 * a bigram that recurred often enough to count. When a match looks wrong,
 * the `matched` field on every mention names the exact word that fired, so
 * the lexicon can be fixed rather than the results distrusted.
 */

import type { TopicCategory } from './registry'

export type SeedTopic = {
  slug: string
  name: string
  category: TopicCategory
  adult: boolean
  /** Marks creator-specific intelligence in topic results. */
  creator: boolean
  /** Single words or short phrases; matched on word boundaries. */
  keywords: string[]
  /** Multi-word phrases that mean the topic on their own — weighted higher. */
  phrases?: string[]
}

/**
 * The adult-creator seed lexicon. Categories follow the Trending Now
 * filters, covering promotion, growth, pricing, management and safety.
 */
export const SEED_TOPICS: SeedTopic[] = [
  // ---- OnlyFans / Adult Creators -----------------------------------------
  { slug: 'onlyfans-promo', name: 'OnlyFans Promotion', category: 'OnlyFans / Adult Creators', adult: true, creator: true,
    keywords: ['onlyfans', 'of promo', 'sfs', 'promo page', 'reddit promo', 'twitter promo', 'mass dm', 'free trial link', 'l4l'],
    phrases: ['sfs', 'like for like'] },
  { slug: 'onlyfans-growth', name: 'OnlyFans Growth Tactics', category: 'OnlyFans / Adult Creators', adult: true, creator: true,
    keywords: ['subscriber growth', 'sub count', 'fans growth', 'viral post', 'top 1%', 'top 0.1%', 'rebill'] },
  { slug: 'fan-page-pricing', name: 'Fan Page Pricing', category: 'OnlyFans / Adult Creators', adult: true, creator: true,
    keywords: ['subscription price', 'ppv price', 'bundles', 'discount', 'promo price', 'free page', 'paid page'] },
  { slug: 'chatter-management', name: 'Chatter & DM Management', category: 'OnlyFans / Adult Creators', adult: true, creator: true,
    keywords: ['chatter', 'mass message', 'mass msg', 'ppv message', 'dm management', 'chatting', 'sexting script'] },
  { slug: 'creator-safety', name: 'Creator Safety & Leaks', category: 'OnlyFans / Adult Creators', adult: true, creator: true,
    keywords: ['leaks', 'leaked', 'dmca', 'scammer', 'chargeback', 'chargebacks', 'ban', 'banned', 'verify age', 'age verification'] },
]

/** Words too common to be a topic keyword. Kept short on purpose — this is a
 *  stop list for clustering, not a linguistics exercise. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'for', 'of', 'to', 'in', 'on',
  'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us',
  'them', 'my', 'your', 'his', 'their', 'our', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only',
  'same', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'about', 'up', 'out', 'do', 'does',
  'did', 'doing', 'have', 'has', 'had', 'having', 'am', 'get', 'got', 'would', 'could', 'one', 'two',
  'also', 'new', 'like', 'want', 'need', 'help', 'make', 'made', 'use', 'using', 'best', 'good',
  'how', 'im', 'ive', 'youre', 'dont', 'doesnt', 'didnt', 'aint', 'via', 'got', 'let', 'us',
])

/** Lower-cased word tokens with stopwords and pure punctuation removed. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9'\- ]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ''))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
}

/** Escapes a keyword for use inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Word-boundary containment that also works for phrases and for keywords
 * ending in punctuation-free letters. "of" must not match "office", and
 * "onlyfans" must match "onlyfans.com" — both are the same rule.
 */
export function containsKeyword(title: string, keyword: string): boolean {
  const haystack = ` ${title.toLowerCase()} `
  const needle = keyword.toLowerCase().trim()
  if (!needle) return false
  if (needle.includes(' ')) return haystack.includes(` ${needle} `) || haystack.includes(`${needle}'s `)
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, 'i')
  return pattern.test(haystack)
}

export type KeywordHit = { topic_id: string; matched: string; weight: number }

/**
 * Every seed topic whose keywords appear in a title. A phrase hit is worth
 * more than a single word, and a keyword that appears in more than one
 * topic credits each — a title about "onlyfans subscriber growth"
 * genuinely belongs to both promotion and growth.
 */
export function topicsForTitle(title: string, topics: SeedTopic[] = SEED_TOPICS): KeywordHit[] {
  const hits: KeywordHit[] = []
  for (const topic of topics) {
    let best: { matched: string; weight: number } | null = null
    for (const phrase of topic.phrases ?? []) {
      if (containsKeyword(title, phrase)) { best = { matched: phrase, weight: 1.6 }; break }
    }
    if (!best) {
      for (const keyword of topic.keywords) {
        if (containsKeyword(title, keyword)) { best = { matched: keyword, weight: keyword.includes(' ') ? 1.3 : 1 }; break }
      }
    }
    if (best) hits.push({ topic_id: topic.slug, matched: best.matched, weight: best.weight })
  }
  return hits
}

/**
 * Recurring bigrams across a batch of titles, as candidate derived topics.
 * This is the "lightweight keyword extraction" the brief asks for: no model,
 * just frequency with a floor. The caller filters out anything the seed
 * lexicon already knows and anything below its own minimum count.
 */
export function recurringBigrams(titles: string[], minCount = 4, limit = 12): { phrase: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const title of titles) {
    const tokens = tokenize(title)
    const seen = new Set<string>()
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`
      if (seen.has(bigram)) continue
      seen.add(bigram)
      counts.set(bigram, (counts.get(bigram) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([phrase, count]) => ({ phrase, count }))
}

/** `AI Video Tools` → `ai-video-tools`. Stable across runs, so a derived
 *  topic keeps its identity and its history. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&+/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
