/**
 * The one place that talks to Reddit.
 *
 * Rules this file exists to enforce (feature brief §7):
 *   - OAuth, client-credentials, read scope only. No password grants, no
 *     account rotation, no proxies, no scraping.
 *   - One request at a time, paced by what Reddit's own headers say is left
 *     — the documented default quota is never assumed to be ours.
 *   - Exponential backoff with jitter for transient failures; Retry-After
 *     honoured for 429s; a circuit breaker that stops the run after
 *     repeated 429/403 instead of hammering.
 *   - Every request is reported to a usage callback, so the budget
 *     dashboard reads measured numbers rather than our intentions.
 *
 * Tokens and secrets never leave this module and never reach the browser:
 * the client is only ever constructed inside route handlers and the cron.
 */

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'
const API_BASE = 'https://oauth.reddit.com'

export class RedditNotConfiguredError extends Error {
  constructor() {
    super('Reddit credentials are not configured (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET)')
    this.name = 'RedditNotConfiguredError'
  }
}

export class RedditAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedditAuthError'
  }
}

export class RedditHttpError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(`Reddit responded ${status}${body ? `: ${body.slice(0, 180)}` : ''}`)
    this.name = 'RedditHttpError'
    this.status = status
    this.body = body
  }
}

export class RedditCircuitError extends Error {
  constructor() {
    super('Collector stopped by the circuit breaker after repeated rate-limit or forbidden responses')
    this.name = 'RedditCircuitError'
  }
}

export class RedditBudgetError extends Error {
  constructor(budget: number) {
    super(`Collector stopped: the per-run request budget (${budget}) is spent`)
    this.name = 'RedditBudgetError'
  }
}

export class RedditQuotaError extends Error {
  constructor(remaining: number) {
    super(`Collector stopped: Reddit's reported quota is nearly spent (${remaining} left in this window)`)
    this.name = 'RedditQuotaError'
  }
}

export class RedditCapError extends Error {
  constructor(used: number, cap: number) {
    super(`Collector stopped: the daily cap is reached (${used}/${cap} requests)`)
    this.name = 'RedditCapError'
  }
}

export type RateLimitState = {
  /** Seconds of quota left in the current window, as reported. */
  remaining: number | null
  /** Requests used in the window, as reported. */
  used: number | null
  /** Seconds until the window resets, as reported. */
  resetSeconds: number | null
  at: number
}

export type RequestUsage = {
  endpoint: string
  method: string
  status: number
  remaining: number | null
  used: number | null
  resetSeconds: number | null
  durationMs: number
}

export type ClientOptions = {
  /** Hard ceiling on requests this run may make. */
  budget: number
  /** Floor between requests, whatever the headers say. */
  minIntervalMs?: number
  /** The normal throttle in requests per minute — a second floor the
   *  header pacing can only slow further, never speed past. */
  maxRequestsPerMinute?: number
  /** 0–1: the fraction of the reported quota we allow ourselves. 0.5 means
   *  "call at half the rate Reddit says is possible". */
  safetyRatio?: number
  /** The last rate-limit reading from a previous run (persisted in
   *  api_usage). Seeding the pacing from it means a fresh process inherits
   *  the window instead of starting blind. */
  initialState?: RateLimitState | null
  /** Called after every request so the caller can persist usage. */
  onUsage?: (usage: RequestUsage) => void | Promise<void>
  /** A pre-flight check run before every single request (retries included).
   *  The collector uses it to re-read the real daily counter, which is what
   *  makes the cap unbreakable by overlapping runs — each request is
   *  checked against actual usage, not an estimate taken at run start.
   *  Throwing here stops the client; failing to read fails closed. */
  guard?: () => void | Promise<void>
  /** Injected for tests. */
  fetchImpl?: typeof fetch
}

export type RedditClient = {
  get: <T = unknown>(path: string, params?: Record<string, string | number | undefined>) => Promise<T>
  stats: () => { requests: number; budget: number; remaining: number | null; resetSeconds: number | null; circuitOpen: boolean }
}

export function redditConfigured(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET)
}

/** A User-Agent that says what this is, per Reddit's API rules. */
export function userAgent(): string {
  return (
    process.env.REDDIT_USER_AGENT?.trim() ||
    `web:social-transcriber-reddit-trends:v1.0.0 (analytics dashboard; contact ${process.env.REDDIT_CONTACT ?? 'ops@gosian.media'})`
  )
}

/* ------------------------------------------------------------------ pure
   helpers, exported so the rules above can be tested without a network. */

/** Jittered exponential backoff: 2^attempt * base, ±25%, capped. */
export function backoffDelay(attempt: number, baseMs = 500, capMs = 15_000, random = Math.random): number {
  const raw = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt))
  const jitter = raw * 0.25 * (random() * 2 - 1)
  return Math.max(100, Math.round(raw + jitter))
}

/** Parse the three rate-limit headers into a state reading. */
export function parseRateLimitHeaders(get: (name: string) => string | null, at = Date.now()): RateLimitState {
  const number = (name: string) => {
    const value = get(name)
    if (value === null || value === undefined || value.trim() === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return {
    remaining: number('x-ratelimit-remaining'),
    used: number('x-ratelimit-used'),
    resetSeconds: number('x-ratelimit-reset'),
    at,
  }
}

/** Seconds to wait per Retry-After, capped — never a long passive block. */
export function retryAfterSeconds(header: string | null, now = Date.now(), cap = 60): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(cap, Math.max(0, seconds))
  const date = Date.parse(header)
  if (Number.isNaN(date)) return null
  return Math.min(cap, Math.max(0, (date - now) / 1000))
}

/**
 * How long to wait before the next request, given the last header reading.
 * The pace is `resetMs / remaining` — Reddit's own arithmetic — slowed by
 * the safety ratio. When the window is nearly spent, wait it out (capped).
 */
export function nextDelayMs(
  state: RateLimitState,
  options: { minIntervalMs: number; safetyRatio: number; now?: number },
): number {
  const now = options.now ?? Date.now()
  const min = Math.max(0, options.minIntervalMs)
  const ratio = Math.min(1, Math.max(0.05, options.safetyRatio))
  const { remaining, resetSeconds } = state
  if (remaining === null || resetSeconds === null) return min
  const graceMs = Math.max(0, state.at + resetSeconds * 1000 - now)
  if (remaining <= 2) return Math.min(120_000, Math.max(min, graceMs))
  const pace = graceMs / Math.max(1, remaining)
  return Math.max(min, Math.round(pace / ratio))
}

/** The breaker opens after this many consecutive 429/403 responses. */
export const CIRCUIT_THRESHOLD = 3

/** Retries before giving up on one request; 429/403 are never retried
 *  aggressively — one more attempt, because Reddit says so via Retry-After,
 *  and then it is counted against the breaker. */
export const MAX_ATTEMPTS = 3

/* --------------------------------------------------------------- runtime */

let tokenCache: { key: string; token: string; expiresAt: number } | null = null

async function accessToken(fetchImpl: typeof fetch): Promise<string> {
  const id = process.env.REDDIT_CLIENT_ID
  const secret = process.env.REDDIT_CLIENT_SECRET
  if (!id || !secret) throw new RedditNotConfiguredError()
  const key = `${id}:${secret.slice(0, 4)}`
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.token
  }
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent(),
    },
    body: 'grant_type=client_credentials&scope=read',
  })
  const body = await response.text()
  if (!response.ok) {
    throw new RedditAuthError(`Reddit rejected the credentials (${response.status}). ${body.slice(0, 160)}`)
  }
  let parsed: { access_token?: string; expires_in?: number }
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new RedditAuthError('Reddit returned a token response that was not JSON')
  }
  if (!parsed.access_token) throw new RedditAuthError('Reddit returned no access token')
  tokenCache = {
    key,
    token: parsed.access_token,
    expiresAt: Date.now() + Math.max(60, (parsed.expires_in ?? 3600) - 60) * 1000,
  }
  return tokenCache.token
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Build a request client for one collection run. One timer decides when each
 * request may fire; requests are serialized through it, which is the
 * "conservative concurrency of one" the brief asks for.
 */
export function createRedditClient(options: ClientOptions): RedditClient {
  const fetchImpl = options.fetchImpl ?? fetch
  // The configured throttle and the interval floor are the same rule: the
  // slower of the two wins, and Reddit's headers can only slow it further.
  const throttleMs = options.maxRequestsPerMinute && options.maxRequestsPerMinute > 0
    ? 60_000 / options.maxRequestsPerMinute
    : 0
  const minIntervalMs = Math.max(options.minIntervalMs ?? 1000, throttleMs)
  const safetyRatio = options.safetyRatio ?? 0.5
  let requests = 0
  let circuitOpen = false
  let consecutiveBlocked = 0
  let lastState: RateLimitState = options.initialState ?? { remaining: null, used: null, resetSeconds: null, at: Date.now() }
  // A seeded window already sets the first gap; a blind start waits only the
  // floor.
  let nextAllowedAt = options.initialState
    ? Date.now() + nextDelayMs(options.initialState, { minIntervalMs, safetyRatio })
    : 0
  const inflight = new Map<string, Promise<unknown>>()

  async function once<T>(url: string, endpoint: string): Promise<T> {
    const wait = Math.max(0, nextAllowedAt - Date.now())
    if (wait > 0) await sleep(wait)
    const started = Date.now()
    const token = await accessToken(fetchImpl)
    let attempt = 0
    for (;;) {
      try {
        // The per-request guard: the daily cap is re-checked against the
        // database immediately before the request goes out.
        await options.guard?.()
        const response = await fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': userAgent(),
            Accept: 'application/json',
          },
        })
        lastState = parseRateLimitHeaders((name) => response.headers.get(name))
        // Schedule before reading the body, so the pace holds even if the
        // body is slow.
        nextAllowedAt = Date.now() + nextDelayMs(lastState, { minIntervalMs, safetyRatio })
        const text = await response.text()
        await report({ endpoint, method: 'GET', status: response.status, durationMs: Date.now() - started })

        if (response.status === 429 || response.status === 401) {
          // A 401 mid-run usually means the token expired; one forced
          // refresh is allowed, counted.
          if (response.status === 401 && attempt === 0) {
            tokenCache = null
            attempt += 1
            continue
          }
        }
        if (response.status === 429 || response.status === 403) {
          consecutiveBlocked += 1
          if (consecutiveBlocked >= CIRCUIT_THRESHOLD) {
            circuitOpen = true
            throw new RedditCircuitError()
          }
          if (response.status === 429) {
            // Aggressive retry is exactly what the brief forbids. The
            // Retry-After window becomes the pace for the *next* request;
            // this one fails so the run can stop cleanly and requeue.
            const after = retryAfterSeconds(response.headers.get('retry-after')) ?? 2
            nextAllowedAt = Date.now() + Math.min(120_000, after * 1000)
          }
          throw new RedditHttpError(response.status, text)
        }
        if (response.status >= 500 && attempt < MAX_ATTEMPTS - 1) {
          attempt += 1
          await sleep(backoffDelay(attempt))
          continue
        }
        if (!response.ok) throw new RedditHttpError(response.status, text)
        consecutiveBlocked = 0
        return JSON.parse(text) as T
      } catch (error) {
        if (error instanceof RedditHttpError || error instanceof RedditCircuitError) throw error
        if (attempt >= MAX_ATTEMPTS - 1) throw error
        attempt += 1
        await sleep(backoffDelay(attempt))
      }
    }
  }

  async function report(partial: Omit<RequestUsage, 'remaining' | 'used' | 'resetSeconds'>) {
    requests += 1
    const usage: RequestUsage = {
      ...partial,
      remaining: lastState.remaining,
      used: lastState.used,
      resetSeconds: lastState.resetSeconds,
    }
    try {
      await options.onUsage?.(usage)
    } catch {
      // A failed usage row must never fail a collection.
    }
  }

  return {
    async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
      if (circuitOpen) throw new RedditCircuitError()
      if (requests >= options.budget) throw new RedditBudgetError(options.budget)
      // The last thing the headers said: if the window is nearly spent and
      // the reset is not imminent, stop rather than eat the last drops.
      if (lastState.remaining !== null && lastState.remaining <= 1 && lastState.resetSeconds !== null) {
        const graceMs = lastState.at + lastState.resetSeconds * 1000 - Date.now()
        if (graceMs > 10_000) throw new RedditQuotaError(lastState.remaining)
      }
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') query.set(key, String(value))
      }
      const url = `${API_BASE}${path}${query.size ? `?${query}` : ''}`
      const key = url
      // De-duplication: the same URL requested twice in one run is one call.
      const existing = inflight.get(key)
      if (existing) return existing as Promise<T>
      const promise = once<T>(url, path)
      inflight.set(key, promise)
      try {
        return await promise
      } finally {
        inflight.delete(key)
      }
    },
    stats: () => ({
      requests,
      budget: options.budget,
      remaining: lastState.remaining,
      resetSeconds: lastState.resetSeconds,
      circuitOpen,
    }),
  }
}

/** Map an HTTP failure on /about to the status the UI should record. */
export function classifyAboutFailure(status: number, body = ''): {
  status: 'unavailable' | 'restricted' | 'quarantined' | 'error'
  note: string
} {
  if (status === 404) return { status: 'unavailable', note: 'Reddit says this community does not exist (404)' }
  if (status === 403) {
    if (/quarantin/i.test(body)) return { status: 'quarantined', note: 'Quarantined community — collection disabled' }
    return { status: 'restricted', note: 'Reddit denied access (private, banned or forbidden)' }
  }
  if (status === 451) return { status: 'unavailable', note: 'Unavailable for legal reasons (451)' }
  return { status: 'error', note: `Validation failed with HTTP ${status}` }
}
