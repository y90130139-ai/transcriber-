/**
 * The adult-space starter registry: 20 candidate communities in two
 * categories, covering creator business and discovery/promotion.
 *
 * These are *candidates*, not a claim that every community exists or is
 * readable through the authorized API. Validation is what turns one into a
 * tracked, collectable community; anything missing, private, quarantined or
 * forbidden is marked unavailable and never blocks the rest of onboarding.
 *
 * Two pairs in the requested list differ only by case
 * (onlyfansadvice/OnlyFansAdvice, onlyfanspromotions/OnlyFansPromotions), so
 * the seed contains 20 candidates and 18 unique communities. The registry
 * keeps both facts: the starter candidate count, and the smaller
 * set of communities the collector should actually fetch.
 *
 * The two adult categories are flagged here and arrive disabled, per the
 * brief: enabling them is a deliberate admin action in Settings that also
 * confirms authorization.
 */

export const REGISTRY_CATEGORIES = [
  'OnlyFans and Adult Creator Business',
  'Adult Creator Discovery and Promotion',
] as const

export type RegistryCategory = (typeof REGISTRY_CATEGORIES)[number]

export type RegistryCandidate = {
  /** As requested; the canonical key is always lower-cased. */
  name: string
  category: RegistryCategory
  /** Adult-facing categories are gated behind an explicit admin enable. */
  adult: boolean
}

const ADULT_CATEGORIES: ReadonlySet<string> = new Set(REGISTRY_CATEGORIES)

/** Whether a category is adult-facing. Manual adds use the same rule the
 *  registry does, so the gate cannot be side-stepped by typing a name. */
export function isAdultCategory(category: string): category is RegistryCategory {
  return ADULT_CATEGORIES.has(category)
}

const RAW: [RegistryCategory, string[]][] = [
  ['OnlyFans and Adult Creator Business', [
    'onlyfansadvice', 'CreatorsAdvice', 'onlyfansgirls101', 'onlyfans',
    'onlyfanspromotions', 'OnlyFans101', 'CamGirlProblems', 'SexWorkers',
    'SexWorkerSupport', 'NSFW411',
  ]],
  ['Adult Creator Discovery and Promotion', [
    'OnlyFansPromotions', 'onlyfansgirls', 'onlyfansmodels', 'OnlyFansPromo',
    'onlyfansnewbies', 'OnlyFansAdvice', 'NSFWCreators', 'NSFWPromotion',
    'CreatorsPromote', 'OnlyFansSupport',
  ]],
]

/** Adult-space candidates with category and adult flag attached. */
export const REGISTRY: RegistryCandidate[] = RAW.flatMap(([category, names]) =>
  names.map((name) => ({ name, category, adult: ADULT_CATEGORIES.has(category) })),
)

export const REGISTRY_CANDIDATE_COUNT = REGISTRY.length

/** The canonical key a community is stored and deduplicated under. */
export function subredditKey(name: string): string {
  return name.trim().replace(/^\/?r\//i, '').replace(/\/+$/, '').toLowerCase()
}

/**
 * The candidates with case-insensitive duplicates collapsed. The first
 * occurrence wins, so the collector fetches each community exactly once
 * while the registry still counts all twenty candidates.
 */
export function uniqueCandidates(): RegistryCandidate[] {
  const seen = new Set<string>()
  const out: RegistryCandidate[] = []
  for (const candidate of REGISTRY) {
    const key = subredditKey(candidate.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

export function uniqueCandidateCount(): number {
  return uniqueCandidates().length
}

/** `r/Name` as the UI writes it. */
export function displayName(name: string): string {
  return `r/${name.trim().replace(/^\/?r\//i, '').replace(/\/+$/, '')}`
}

/**
 * Turn anything a human pastes — a name, `r/name`, a full URL with or
 * without a comment/query tail — into a canonical key. Returns null when
 * there is no plausible community in the input.
 */
export function parseSubredditInput(input: string): { key: string; display: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const fromUrl = trimmed.match(/reddit\.com\/r\/([A-Za-z0-9_]{2,21})(?:[/?#]|$)/i)
  // A URL that is not a Reddit community URL is not a community; without
  // this, "https://example.com/about" parses as a community called "https".
  if (!fromUrl && /:\/\/|^www\.|\.com|\.org|\.net|\.io/i.test(trimmed)) return null
  const raw = fromUrl ? fromUrl[1] : trimmed.replace(/^\/?r\//i, '').split(/[/?#]/)[0]
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '')
  if (cleaned.length < 2 || cleaned.length > 21) return null
  return { key: cleaned.toLowerCase(), display: cleaned }
}

/** Default intervals by priority (the brief's 15–30 / 60 / 120–240 targets). */
export const PRIORITY_INTERVAL_MINUTES: Record<'high' | 'medium' | 'low', number> = {
  high: 30,
  medium: 60,
  low: 120,
}

/** The topic categories the Trending Now filters offer, plus what the topic
 *  lexicon uses. Kept apart from the subreddit registry categories on
 *  purpose: a community has a subject area, a topic has a trend category. */
export const TOPIC_CATEGORIES = [
  'OnlyFans / Adult Creators',
] as const

export type TopicCategory = (typeof TOPIC_CATEGORIES)[number]
