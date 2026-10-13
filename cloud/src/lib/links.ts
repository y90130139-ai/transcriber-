/** Pulling usable post URLs out of whatever got pasted in.
 *
 * People paste from Notes, from a share sheet, from a chat thread — the text
 * arrives with commentary, line breaks and tracking junk around the links. This
 * mirrors the CLI's normalisation so a share link and a clean link dedupe to
 * the same job instead of transcribing the same reel twice.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g

// Share links carry tracking junk that makes one post look like two.
const TRACKING_PARAMS = new Set([
  // 'igsh' is the one the Instagram share sheet actually appends today, and it
  // is a fresh value on every share — without it here the same reel shared
  // twice from the app becomes two jobs and two library entries. 'igsi' was a
  // typo for it; both are kept so nothing that once worked stops working.
  'igsh', 'igsi', 'igshid', 'si', 'fbclid', 'utm_source', 'utm_medium',
  'utm_campaign', 'utm_content', 'utm_term', 'ig_mid', 'img_index',
])

const SUPPORTED_HOSTS = /(instagram\.|tiktok\.|youtube\.|youtu\.be|facebook\.|twitter\.|x\.com|vimeo\.|threads\.)/i

// Instagram serves one post at several paths — /reel/, /reels/, /p/ and /tv/ —
// and a shortcode belongs to exactly one post, so they all collapse to /reel/.
const IG_POST = /^\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/
// A profile-scoped reel link, which is the same post again: /<handle>/reel/<id>.
const IG_PROFILE_POST = /^\/[^/]+\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/
const YT_WATCH = /^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]+)/

/** One post, one string — whatever shape it was pasted in.
 *
 * This is the dedupe key, so every cosmetic difference that leaves the post
 * identical has to be flattened here or the same reel is fetched twice and the
 * library gains a phantom post that skews its creator's median.
 */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw.replace(/[.,;]+$/, ''))
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key)
    }
    url.hash = ''
    // A link copied out of a phone browser is http and/or m., one copied from
    // the desktop site is https and www. Same post.
    url.protocol = 'https:'
    url.hostname = url.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, '')
    // Trailing slashes are cosmetic on these platforms but split the dedupe key.
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'

    if (url.hostname.endsWith('instagram.com')) {
      const shortcode = url.pathname.match(IG_POST)?.[1]
        ?? url.pathname.match(IG_PROFILE_POST)?.[1]
      if (shortcode) {
        url.pathname = `/reel/${shortcode}`
        url.search = ''
      }
    } else if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1)
      if (id) return `https://youtube.com/watch?v=${id}`
    } else if (url.hostname.endsWith('youtube.com')) {
      const id = url.pathname.match(YT_WATCH)?.[1] ?? url.searchParams.get('v')
      if (id) return `https://youtube.com/watch?v=${id}`
    }
    return url.toString()
  } catch {
    return raw.trim()
  }
}

export function platformOf(url: string): string {
  const lowered = url.toLowerCase()
  if (lowered.includes('instagram.')) return 'instagram'
  if (lowered.includes('tiktok.')) return 'tiktok'
  if (lowered.includes('youtube.') || lowered.includes('youtu.be')) return 'youtube'
  if (lowered.includes('facebook.')) return 'facebook'
  if (lowered.includes('threads.')) return 'threads'
  if (lowered.includes('x.com') || lowered.includes('twitter.')) return 'x'
  return 'web'
}

/** Deduped, normalised links in paste order. */
export function extractLinks(text: string): string[] {
  const seen = new Set<string>()
  const found: string[] = []
  for (const match of text.match(URL_PATTERN) ?? []) {
    const url = normalizeUrl(match)
    if (!SUPPORTED_HOSTS.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    found.push(url)
  }
  return found
}

/** A short human label for a link before the platform tells us the real title. */
export function labelFor(url: string): string {
  try {
    const { hostname, pathname } = new URL(url)
    return `${hostname.replace(/^www\./, '')}${pathname}`.slice(0, 80)
  } catch {
    return url.slice(0, 80)
  }
}
