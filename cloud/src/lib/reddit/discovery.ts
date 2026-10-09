/**
 * The NSFW discovery sweep — pure planning logic, no I/O.
 *
 * Each pass spends a share of the day's discovery allowance on
 * `/subreddits/search` pages, walking a fixed keyword list with a cursor so
 * every corner of the niche gets revisited over days. A result is accepted
 * only when it is genuinely adult-facing (Reddit's own over-18 flag, or an
 * unmistakably adult name/description) and big enough to matter; everything
 * else is discarded before it can touch the board.
 */

/** The hunt list: adult-creator business, promotion, and discovery niches.
 *  Deliberately avoids terms that would pull in minor-adjacent or
 *  non-consensual corners — the sweep is for promo-legal communities. */
export const NSFW_KEYWORDS: string[] = [
  'onlyfans',
  'onlyfanspromo',
  'onlyfanspromotion',
  'onlyfansadvice',
  'onlyfansgirls',
  'onlyfansmodels',
  'onlyfans101',
  'onlyfanshelp',
  'nsfw',
  'nsfw411',
  'nsfwpromo',
  'nsfwpromotion',
  'nsfwcreators',
  'nsfw_seller',
  'nsfwselfie',
  'nsfw_gifs',
  'adultcreator',
  'adultcontent',
  'adultpromo',
  'creatorpromo',
  'contentcreator',
  'fansly',
  'fanslypromo',
  'chaturbate',
  'stripchat',
  'manyvids',
  'sexting',
  'findom',
  'gonewild',
  'gonewildcurvy',
  'realgirls',
  'amateur',
  'homemade',
  'selfie',
  'selfiepromo',
  'exhibitionist',
  'flashing',
  'publicnsfw',
  'lewd',
  'nudes',
  'nude',
  'naked',
  'nakedgirls',
  'lingerie',
  'bikini',
  'bra',
  'thongs',
  'petite',
  'thicc',
  'curvy',
  'bbw',
  'milf',
  'gilf',
  'ebony',
  'asianbabes',
  'latinas',
  'cosplay',
  'nsfwcosplay',
  'feet',
  'footfetish',
  'thighs',
  'boobs',
  'tits',
  'booty',
  'ass',
  'pussy',
  'masturbation',
  'orgasms',
  'camgirls',
  'camgirlpromo',
  'strippers',
  'stripping',
  'sellingcontent',
  'content_sellers',
]

export type DiscoveryInput = {
  name: string
  subscribers: number | null
  over18: boolean
  description: string | null
}

/** Unmistakably adult tokens, for results Reddit has not flagged 18+ yet
 *  (plenty of promo subs stay unflagged while being entirely adult). */
const ADULT_TEXT = /(?:^|[^a-z])(?:nsfw|onlyfans|fansly|porn|xxx|adult|nude|nudes|naked|gonewild|camgirl|lewd|sexting|findom|erotic|hentai|milf|bbw)(?:[^a-z]|$)/i

/** Rotate through the hunt list from a cursor; wraps, so the sweep never
 *  runs dry and never needs a write to keep going. */
export function nextKeywords(cursor: number, count: number): { keywords: string[]; nextCursor: number } {
  const total = NSFW_KEYWORDS.length
  const take = Math.max(1, Math.min(count, total))
  const start = ((cursor % total) + total) % total
  const keywords: string[] = []
  for (let i = 0; i < take; i += 1) keywords.push(NSFW_KEYWORDS[(start + i) % total])
  return { keywords, nextCursor: (start + take) % total }
}

/** The acceptance rule, in one place so the collector, the tests and the
 *  UI copy cannot drift: adult-facing, big enough, plausible name. */
export function acceptCandidate(input: DiscoveryInput, minSubscribers: number): boolean {
  const name = input.name.trim()
  if (!/^[A-Za-z0-9_]{3,21}$/.test(name)) return false
  if ((input.subscribers ?? 0) < Math.max(0, minSubscribers)) return false
  if (input.over18) return true
  return ADULT_TEXT.test(name) || ADULT_TEXT.test(input.description ?? '')
}
