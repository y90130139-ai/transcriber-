/** Reading Instagram handles out of whatever someone pasted.
 *
 * A list of accounts arrives as handles, @handles, profile links, or a mess of
 * all three separated by commas or newlines. Everything that is not a handle
 * is dropped rather than guessed at: a watchlist entry that does not resolve
 * costs a sweep and returns nothing. */
const HANDLE = /^[a-z0-9._]{1,30}$/

export function handlesIn(value: unknown): string[] {
  const text = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : ''
  const found = new Set<string>()
  for (const raw of text.split(/[\s,]+/)) {
    if (!raw) continue
    let candidate = raw.trim().toLowerCase()
    if (candidate.includes('instagram.com')) {
      // A profile link, not a post: /p/, /reel/ and /reels/ carry no handle
      // worth watching in their first segment.
      const path = candidate.split('instagram.com/')[1] ?? ''
      const first = path.split(/[/?#]/)[0]
      if (['p', 'reel', 'reels', 'tv', 'explore', 'stories'].includes(first)) continue
      candidate = first
    }
    candidate = candidate.replace(/^@/, '').replace(/\/$/, '')
    if (HANDLE.test(candidate)) found.add(candidate)
  }
  return [...found].slice(0, 200)
}
