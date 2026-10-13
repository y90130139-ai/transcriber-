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
  // creator platforms and promo
  'onlyfans',
  'onlyfanspromo',
  'onlyfanspromos',
  'onlyfanspromotion',
  'onlyfansadvice',
  'onlyfansgirls',
  'onlyfansmodels',
  'onlyfans101',
  'onlyfanshelp',
  'onlyfansvip',
  'onlyfansshare',
  'onlyfansdaily',
  'onlyfansuk',
  'onlyfanscanada',
  'onlyfansgermany',
  'onlyfansbrasil',
  'onlyfans_es',
  'onlyfansitalia',
  'onlyfansaus',
  'onlyfansdeutsch',
  'ofpromo',
  'ofmodel',
  'ofcreator',
  'ofgirls',
  'fansly',
  'fanslypromo',
  'fanslygirls',
  'fanslycreator',
  'fanslymodel',
  'chaturbate',
  'chaturbategirls',
  'stripchat',
  'stripchatgirls',
  'manyvids',
  'sexting',
  'findom',
  'usedpanties',
  // nsfw naming conventions
  'nsfw',
  'nsfw411',
  'nsfwpromo',
  'nsfwpromotion',
  'nsfwpromotions',
  'nsfwcreators',
  'nsfw_seller',
  'nsfwselfie',
  'nsfwselfies',
  'nsfw_gifs',
  'nsfw_gif',
  'nsfwart',
  'nsfwcosplay',
  'nsfwasmr',
  'nsfwmemes',
  'nsfwphotos',
  'nsfw_porn',
  'nsfwvideos',
  'nsfwcouples',
  'nsfw_creators',
  'nsfwselling',
  'nsfwhardcore',
  // adult business and marketplaces
  'adultcreator',
  'adultcreators',
  'adultcontent',
  'adultcontentcreators',
  'adultpromo',
  'adultpromoters',
  'adultmodels',
  'creatorpromo',
  'contentcreator',
  'contentmarket',
  'contentmarketplace',
  'customcontent',
  'sellingcontent',
  'sellingnudes',
  'sellingnsfw',
  'content_sellers',
  'sexworkers',
  'sexworkersonly',
  // discovery classics
  'gonewild',
  'gonewildcurvy',
  'gonewildplus',
  'gonewildaudio',
  'gonewildstories',
  'gonewild30plus',
  'gonewildchubby',
  'gonemild',
  'couplesgonewild',
  'realgirls',
  'amateur',
  'amateurs',
  'amateurporn',
  'amateurgirls',
  'homemade',
  'homemadeporn',
  'realsex',
  // presentation and niches
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
  'panties',
  'underwear',
  'stockings',
  'latex',
  'leather',
  'petite',
  'thicc',
  'curvy',
  'chubby',
  'plussize',
  'thickgirls',
  'bbw',
  'milf',
  'gilf',
  'ebony',
  'asianbabes',
  'latinas',
  'pornstars',
  'cosplay',
  'feet',
  'footfetish',
  'feetporn',
  'footworship',
  'thighs',
  'boobs',
  'tits',
  'booty',
  'ass',
  'pussy',
  'masturbation',
  'orgasms',
  'bondage',
  'bdsm',
  'kinky',
  'fetish',
  'femdom',
  'domme',
  'hotwife',
  'hotwives',
  'cuckold',
  'swingers',
  // cam and live
  'camgirls',
  'camgirlpromo',
  'camgirlproblems',
  'strippers',
  'stripping',
]

export type DiscoveryInput = {
  name: string
  subscribers: number | null
  over18: boolean
  description: string | null
}

/** Unmistakably adult tokens, for results Reddit has not flagged 18+ yet
 *  (plenty of promo subs stay unflagged while being entirely adult). Matched
 *  from a word boundary, so `gonewildcurvy` counts and `sassafras` does not. */
const ADULT_TEXT = /(?:^|[^a-z])(?:nsfw|onlyfans|fansly|porn|xxx|adult|nude|nudes|naked|gonewild|camgirl|lewd|sexting|findom|erotic|hentai|milf|bbw)/i

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

/** How one sweep's budget splits between hunting for new communities and
 *  scanning the ones already on the board for topics and trends.
 *
 *  While the board is below `maxCommunities`, `contentPercent` of the pass
 *  goes to content scans and the rest to subreddit searches. Once the board
 *  reaches the cap — the point the operator set to stop hunting — every
 *  request goes to scanning, so the budget turns into trend fuel on its
 *  own. A cap of 0 or less means "no cap, keep splitting". */
export function splitDiscoveryBudget(
  budget: number,
  boardCount: number,
  maxCommunities: number,
  contentPercent: number,
): { content: number; search: number } {
  const total = Math.max(0, Math.floor(budget))
  if (total === 0) return { content: 0, search: 0 }
  const capped = maxCommunities > 0 && boardCount >= maxCommunities
  const share = capped ? 100 : Math.min(100, Math.max(0, contentPercent))
  const content = Math.min(total, Math.round((total * share) / 100))
  return { content, search: total - content }
}
