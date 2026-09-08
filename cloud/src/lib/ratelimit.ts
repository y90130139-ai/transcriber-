/** A cheap ceiling on the token-authenticated write endpoints.
 *
 * Best-effort and per-instance: serverless spreads requests across lambdas, so
 * this is a speed bump for a single hot instance, not a distributed limiter.
 * That is the right trade here — the alternative is a database round trip on
 * every tap of a Filmed toggle, which costs more than the abuse it prevents.
 */
const WINDOW_MS = 60_000
const buckets = new Map<string, { count: number; resetAt: number }>()
const MAX_KEYS = 5000

export function rateLimit(key: string, limit: number, windowMs = WINDOW_MS): boolean {
  const now = Date.now()

  // Bound the map rather than let a stream of unknown tokens grow it forever.
  if (buckets.size > MAX_KEYS) {
    for (const [existing, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(existing)
    }
    if (buckets.size > MAX_KEYS) buckets.clear()
  }

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  bucket.count += 1
  return bucket.count <= limit
}
