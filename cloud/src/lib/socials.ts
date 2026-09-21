/**
 * Where a model is online, and how to open it.
 *
 * The point of this file is that reviewing someone's content should be a tap.
 * Everything here exists to turn whatever got pasted into the box — a full URL,
 * a bare handle, an `@handle`, a share link with three tracking parameters —
 * into a row that renders as a button and opens the right page.
 *
 * Deliberately not a brand-colour palette. Per the house identity the console
 * is bone, ink and ember; a row of platform colours would put blue back on the
 * page, which is the one thing the brand spec rules out outright. The chips are
 * told apart by a short mono label, the way every other label in this app is.
 */

export const PLATFORMS = [
  'instagram', 'tiktok', 'onlyfans', 'fansly', 'x', 'reddit', 'threads',
  'snapchat', 'youtube', 'twitch', 'telegram', 'facebook', 'linktree', 'other',
] as const

export type Platform = (typeof PLATFORMS)[number]

export type Social = {
  platform: Platform
  /** Without the leading @, and without the r/ on Reddit. May be empty when
   *  the URL is a deep link that no handle can be recovered from. */
  handle: string
  /** What a tap opens. Always absolute, always http(s) — see `readSocials`. */
  url: string
}

type Spec = {
  label: string
  /** Two or three characters for the button. Uppercase mono, so it reads as a
   *  label rather than as a logo. */
  short: string
  /** Matched against the hostname, longest first, so `x.com` does not swallow
   *  a `fx.com` and `music.youtube.com` still reads as YouTube. */
  hosts: string[]
  /** The profile page for a handle. Null where a handle means nothing on its
   *  own, which is only `other`: an arbitrary link has no route to build. */
  profile: ((handle: string) => string) | null
  /** How the handle is written when it is shown to a human. */
  display?: (handle: string) => string
}

const SPEC: Record<Platform, Spec> = {
  instagram: {
    label: 'Instagram', short: 'IG',
    hosts: ['instagram.com', 'instagr.am'],
    profile: (handle) => `https://www.instagram.com/${handle}/`,
  },
  tiktok: {
    label: 'TikTok', short: 'TT',
    hosts: ['tiktok.com'],
    profile: (handle) => `https://www.tiktok.com/@${handle}`,
  },
  onlyfans: {
    label: 'OnlyFans', short: 'OF',
    hosts: ['onlyfans.com'],
    profile: (handle) => `https://onlyfans.com/${handle}`,
  },
  fansly: {
    label: 'Fansly', short: 'FN',
    hosts: ['fansly.com'],
    profile: (handle) => `https://fansly.com/${handle}`,
  },
  x: {
    label: 'X', short: 'X',
    hosts: ['x.com', 'twitter.com'],
    profile: (handle) => `https://x.com/${handle}`,
  },
  reddit: {
    label: 'Reddit', short: 'RD',
    hosts: ['reddit.com'],
    profile: (handle) => `https://www.reddit.com/user/${handle}`,
    display: (handle) => `u/${handle}`,
  },
  threads: {
    label: 'Threads', short: 'TH',
    hosts: ['threads.net', 'threads.com'],
    profile: (handle) => `https://www.threads.net/@${handle}`,
  },
  snapchat: {
    label: 'Snapchat', short: 'SC',
    hosts: ['snapchat.com'],
    profile: (handle) => `https://www.snapchat.com/add/${handle}`,
  },
  youtube: {
    label: 'YouTube', short: 'YT',
    hosts: ['youtube.com', 'youtu.be'],
    profile: (handle) => `https://www.youtube.com/@${handle}`,
  },
  twitch: {
    label: 'Twitch', short: 'TW',
    hosts: ['twitch.tv'],
    profile: (handle) => `https://www.twitch.tv/${handle}`,
  },
  telegram: {
    label: 'Telegram', short: 'TG',
    hosts: ['t.me', 'telegram.me'],
    profile: (handle) => `https://t.me/${handle}`,
  },
  facebook: {
    label: 'Facebook', short: 'FB',
    hosts: ['facebook.com', 'fb.com'],
    profile: (handle) => `https://www.facebook.com/${handle}`,
  },
  linktree: {
    label: 'Linktree', short: 'LT',
    hosts: ['linktr.ee', 'beacons.ai', 'allmylinks.com'],
    profile: (handle) => `https://linktr.ee/${handle}`,
  },
  other: {
    label: 'Link', short: '↗',
    hosts: [],
    profile: null,
  },
}

export const isPlatform = (value: unknown): value is Platform =>
  typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)

export const labelOfPlatform = (platform: Platform): string => SPEC[platform].label
export const shortOfPlatform = (platform: Platform): string => SPEC[platform].short

/** How the handle reads on the button — `u/` on Reddit, `@` nowhere else,
 *  because the chip already says which platform it is. */
export function displayHandle(social: Social): string {
  if (!social.handle) return hostOf(social.url) ?? SPEC[social.platform].label
  const spec = SPEC[social.platform]
  return spec.display ? spec.display(social.handle) : social.handle
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Which platform a URL belongs to. Longest host match wins so `threads.net`
 *  is not decided by whichever key the object happened to iterate first. */
export function platformOfUrl(url: string): Platform {
  const host = hostOf(url)
  if (!host) return 'other'
  let best: { platform: Platform; length: number } | null = null
  for (const platform of PLATFORMS) {
    for (const candidate of SPEC[platform].hosts) {
      const hit = host === candidate || host.endsWith(`.${candidate}`)
      if (hit && (!best || candidate.length > best.length)) {
        best = { platform, length: candidate.length }
      }
    }
  }
  return best?.platform ?? 'other'
}

/** The handle inside a profile URL, where one can be recovered.
 *
 *  Only the first path segment is ever read, and only when it is not one of the
 *  platform's own routes — `instagram.com/reel/abc` is a post, not somebody
 *  called "reel", and storing it would produce a button that opens a 404. */
const NOT_A_HANDLE = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct',
  'video', 'watch', 'share', 'shorts', 'channel', 'c', 'u', 'i', 'home',
])

export function handleOfUrl(url: string, platform: Platform): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return ''
  }
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length === 0) return ''

  // Reddit writes the owner in the second segment, after `user` or `u`.
  if (platform === 'reddit') {
    const at = parts.findIndex((part) => part === 'user' || part === 'u')
    return at >= 0 && parts[at + 1] ? strip(parts[at + 1]) : ''
  }
  // Snapchat's profile route is /add/<handle>.
  if (platform === 'snapchat' && parts[0] === 'add' && parts[1]) return strip(parts[1])

  const first = strip(parts[0])
  if (!first || NOT_A_HANDLE.has(first.toLowerCase())) return ''
  return first
}

const strip = (value: string) => value.replace(/^@+/, '').trim()

/**
 * Turn whatever was typed into a row, or into nothing.
 *
 * Three shapes arrive here: a full URL, a bare handle with a platform already
 * chosen beside it, and an `@handle`. A URL always wins over the chosen
 * platform — pasting a TikTok link into a row marked Instagram means the row
 * was marked wrong, not that the link was.
 *
 * Returns null rather than throwing. An unparseable row is dropped on save,
 * which is the same thing `readModelInput` does with a bad Drive URL and for
 * the same reason: a dead tap target she cannot tell from a live one.
 */
export function readSocial(platform: Platform, raw: string): Social | null {
  const value = raw.trim()
  if (!value) return null

  const looksLikeUrl = /^https?:\/\//i.test(value) || /^[\w.-]+\.[a-z]{2,}\//i.test(value)
  if (looksLikeUrl) {
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    const found = platformOfUrl(url)
    // A pasted link that matches no known host keeps the row's own platform
    // when one was chosen, so a site this file has never heard of still opens.
    const settled = found === 'other' && platform !== 'other' ? platform : found
    const handle = handleOfUrl(url, settled)
    const build = SPEC[settled].profile

    // Where a handle was recovered, the canonical profile URL is stored rather
    // than the pasted one. Links arrive off a share sheet carrying `?hl=en`,
    // `?utm_source=…`, a fragment, sometimes a trailing `/reels/` — none of
    // which change where the button goes, all of which make the same account
    // look like two. This is what makes the duplicate check below mean
    // anything. A link no handle could be read from — a post rather than a
    // profile — is kept exactly as pasted, because there is nothing to
    // rebuild it from and it still opens something real.
    if (handle && build) return { platform: settled, handle, url: build(handle) }
    return { platform: settled, handle, url: parsed.toString() }
  }

  const handle = strip(value)
  if (!handle) return null
  const build = SPEC[platform].profile
  // No handle route — Linktree needs the whole address, not a name.
  if (!build) return null
  return { platform, handle, url: build(handle) }
}

/** Validate a whole set on the way into the database. Order is preserved: it
 *  is the order the buttons render in, and it is Geno's to decide. */
export function readSocials(value: unknown, limit = 20): Social[] {
  if (!Array.isArray(value)) return []
  const clean: Social[] = []
  const seen = new Set<string>()
  for (const row of value) {
    if (typeof row !== 'object' || row === null) continue
    const entry = row as Record<string, unknown>
    const platform = isPlatform(entry.platform) ? entry.platform : 'other'
    const source = typeof entry.url === 'string' && entry.url.trim()
      ? entry.url
      : typeof entry.handle === 'string' ? entry.handle : ''
    const social = readSocial(platform, String(source).slice(0, 500))
    if (!social) continue
    // Two buttons to the same page is a mis-paste, not a preference. Keyed on
    // the account rather than on the address: the same profile reaches here
    // written several ways, and `readSocial` canonicalises only the ones it can
    // recover a handle from.
    const key = social.handle
      ? `${social.platform}:${social.handle.toLowerCase()}`
      : social.url.toLowerCase().replace(/\/+$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    clean.push(social)
    if (clean.length >= limit) break
  }
  return clean
}

/**
 * The Instagram row implied by `models.handle`.
 *
 * Every model already has a handle — it is what `/api/models/[id]/posts` joins
 * her own posts on — so a roster that has never been touched since this file
 * landed still shows one working button. Merged in rather than written to the
 * column, so the two never drift and nothing has to be backfilled.
 */
export function withImpliedInstagram(socials: Social[], handle: string | null): Social[] {
  if (!handle) return socials
  if (socials.some((social) => social.platform === 'instagram')) return socials
  const implied = readSocial('instagram', handle)
  return implied ? [implied, ...socials] : socials
}

/**
 * Every Instagram account a model has, main first.
 *
 * `models.handle` is one column and several of the roster run two or three
 * accounts — a main, a backup, a niche one. Measuring only the column asks
 * "how is she doing" of a third of her output and calls it the answer, and
 * the whole point of the roster pass is to find which account is winning.
 *
 * Deduped case-insensitively, because the same account reaches here typed
 * both ways, and `handle` leads: it is what her library rows are filed under.
 */
export function instagramAccounts(handle: string | null, socials: Social[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: string | null | undefined) => {
    const clean = (value ?? '').replace(/^@+/, '').trim().toLowerCase()
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    out.push(clean)
  }
  add(handle)
  for (const social of socials) {
    if (social.platform === 'instagram') add(social.handle)
  }
  return out
}

/** A count above this is a typo — nobody on this roster has a billion
 *  followers, and a fat-fingered paste would flatten every real reading in the
 *  chart it is drawn into. */
const MAX_FOLLOWERS = 1_000_000_000

/**
 * `128.4k`, `1.2m`, `1,284`, `1284` — all of them the same figure.
 *
 * Read rather than rejected because retyping a number you can already see on a
 * phone screen is exactly the friction that stops the reading being taken at
 * all, and a follower count nobody records is worth less than an approximate
 * one somebody does. Lives here rather than beside the route that uses it:
 * an App Router `route.ts` may only export HTTP methods.
 */
export function readCount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= MAX_FOLLOWERS
      ? Math.round(value)
      : null
  }
  if (typeof value !== 'string') return null

  const raw = value.trim().toLowerCase().replace(/[,\s]/g, '')
  const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(raw)
  if (!match) return null

  const scale = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1
  const count = Math.round(Number(match[1]) * scale)
  return Number.isFinite(count) && count >= 0 && count <= MAX_FOLLOWERS ? count : null
}

/** How a count reads back on a card: 128.4k, 1.2m, 940. */
export function showCount(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}m`
  if (value >= 10_000) return `${trim(value / 1_000)}k`
  return value.toLocaleString('en-US')
}

const trim = (value: number) =>
  (Math.round(value * 10) / 10).toString()
