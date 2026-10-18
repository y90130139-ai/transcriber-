/**
 * Autoposter, from the console (Geno, 2026-10-15).
 *
 * The scheduling backend for the Scheduler workspace: accounts, media, posts
 * and tags over the documented REST API
 * (`autoposter.typamanagement.com/api`). The access token is bound to the
 * user, not a workspace, so the workspace UUID rides in every path — both
 * come from the environment (`AUTOPOSTER_TOKEN`, `AUTOPOSTER_WORKSPACES`).
 *
 * Reads are shaped for the calendar and the composer, not passed through:
 * the API's ids are integers, its dates and times are separate strings, and
 * its post payloads are version trees. `normalizePost` flattens one into
 * what a card needs, tolerant about which of the plausible field names the
 * API actually used.
 *
 * The unified calendar fans out over every workspace. Autoposter rate-limits
 * hard and paginates lists (`data` + `meta.last_page`), so reads walk every
 * page and the fan-out runs through a small concurrency pool with 429
 * backoff — silent empty catches used to drop whole workspaces.
 *
 * Server only — the token must never reach a browser.
 */

const BASE = 'https://autoposter.typamanagement.com/api'
const TIMEOUT_MS = 25_000
/** How many workspaces we hit at once — Autoposter 429s hard above 2. */
const FANOUT = 2
/** Autoposter's token-wide API budget is 60 requests/minute. Keep a little room
 *  for other clients using the same token. This gate covers the whole process. */
const MIN_REQUEST_INTERVAL_MS = 1_100
/** One retry after the provider's rate-limit window, never a retry storm. */
const RATE_RETRIES = 1
const FALLBACK_RETRY_AFTER_MS = 15_000
const GET_CACHE_LIMIT = 2_000

type CachedGet = { value: unknown; expiresAt: number; generation: number }
const getCache = new Map<string, CachedGet>()
const inFlightGets = new Map<string, Promise<unknown>>()
const workspaceGenerations = new Map<string, number>()

let nextRequestAt = 0
let rateLimitedUntil = 0
let requestSlots = Promise.resolve()

function readCacheTtl(path: string): number {
  if (path.startsWith('/accounts')) return 10 * 60_000
  if (path.startsWith('/posts')) return 2 * 60_000
  if (path.startsWith('/media')) return 2 * 60_000
  return 30_000
}

function getCacheKey(workspace: string, path: string): string {
  return `${workspace}\u0000${path}`
}

function invalidateWorkspaceReads(workspace: string): void {
  workspaceGenerations.set(workspace, (workspaceGenerations.get(workspace) ?? 0) + 1)
  const prefix = `${workspace}\u0000`
  for (const key of getCache.keys()) if (key.startsWith(prefix)) getCache.delete(key)
  for (const key of inFlightGets.keys()) if (key.startsWith(prefix)) inFlightGets.delete(key)
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

/**
 * Every workspace the token may act on (Geno, 2026-10-14). One token reaches
 * every workspace its user belongs to, so the scheduler keeps a list and
 * scopes each call to one of them — `AUTOPOSTER_WORKSPACES` holds all of
 * them comma-separated; the older single `AUTOPOSTER_WORKSPACE` still works
 * as a list of one.
 */
export function workspaces(): string[] {
  const list = (process.env.AUTOPOSTER_WORKSPACES ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (list.length > 0) return [...new Set(list)]
  const single = (process.env.AUTOPOSTER_WORKSPACE ?? '').trim()
  return single ? [single] : []
}

export function autoposterConfigured(): boolean {
  return Boolean(process.env.AUTOPOSTER_TOKEN) && workspaces().length > 0
}

/** The workspace a call runs against — the requested one when it is ours,
 *  otherwise the first, otherwise an honest 503/400 instead of Autoposter's
 *  403. */
export function resolveWorkspace(input?: string | null): string {
  const list = workspaces()
  if (typeof input === 'string' && input.trim()) {
    if (list.includes(input.trim())) return input.trim()
    throw new AutoposterError('Unknown workspace.', 400)
  }
  const first = list[0]
  if (!first) throw new AutoposterError('The scheduler is not connected yet.', 503)
  return first
}

export class AutoposterError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AutoposterError'
    this.status = status
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Reserve requests globally: the 60/minute limit is shared across workspaces
 *  and would otherwise be blown through by parallel page components. */
function waitForRequestSlot(): Promise<void> {
  const reservation = requestSlots.then(async () => {
    while (true) {
      const delay = Math.max(nextRequestAt, rateLimitedUntil) - Date.now()
      if (delay <= 0) break
      await sleep(delay)
    }
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS
  })
  requestSlots = reservation.catch(() => {})
  return reservation
}

async function apUncached<T>(workspace: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.AUTOPOSTER_TOKEN
  if (!token) throw new AutoposterError('The scheduler is not connected yet.', 503)

  const once = async () => {
    await waitForRequestSlot()
    const response = await fetch(`${BASE}/${workspace}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => {
      throw new AutoposterError('Autoposter did not answer — try again.', 502)
    })
    if (response.status === 429) {
      const wait = retryAfterMs(response) ?? FALLBACK_RETRY_AFTER_MS
      rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + wait)
    }
    return response
  }

  let response = await once()
  // Respect the provider's token-wide reset window. The request gate also
  // pauses other scheduler calls while this cooldown is active.
  for (let attempt = 0; response.status === 429 && attempt < RATE_RETRIES; attempt += 1) {
    response = await once()
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    const wait = retryAfterMs(response)
    const message = response.status === 429
      ? wait && wait > 0
        ? `Autoposter is rate-limiting — try again in ${Math.ceil(wait / 1000)} seconds.`
        : 'Autoposter is rate-limiting — try again shortly.'
      : (typeof body?.message === 'string' && body.message) ||
        (typeof body?.error === 'string' && body.error) ||
        (response.status === 403
          ? 'That workspace is not open to this token.'
          : `Autoposter refused (${response.status}).`)
    throw new AutoposterError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json().catch(() => ({}))) as T
}

async function ap<T>(workspace: string, path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET') {
    const result = await apUncached<T>(workspace, path, init)
    invalidateWorkspaceReads(workspace)
    return result
  }

  const key = getCacheKey(workspace, path)
  const cached = getCache.get(key)
  const generation = workspaceGenerations.get(workspace) ?? 0
  if (cached && cached.expiresAt > Date.now() && cached.generation === generation) {
    return cached.value as T
  }
  if (cached) getCache.delete(key)

  const pending = inFlightGets.get(key)
  if (pending) return (await pending) as T

  const request = apUncached<T>(workspace, path, init)
  inFlightGets.set(key, request)
  try {
    const value = await request
    if (generation === (workspaceGenerations.get(workspace) ?? 0)) {
      getCache.set(key, { value, expiresAt: Date.now() + readCacheTtl(path), generation })
      if (getCache.size > GET_CACHE_LIMIT) {
        const oldest = getCache.keys().next().value
        if (oldest) getCache.delete(oldest)
      }
    }
    return value
  } finally {
    if (inFlightGets.get(key) === request) inFlightGets.delete(key)
  }
}

/** A list response is an array, or an object with one array inside. */
function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (Array.isArray(record.data)) return record.data as T[]
    for (const value of Object.values(record)) if (Array.isArray(value)) return value as T[]
  }
  return []
}

function lastPageOf(data: unknown): number {
  if (!data || typeof data !== 'object') return 1
  const meta = (data as Record<string, unknown>).meta
  if (!meta || typeof meta !== 'object') return 1
  const last = num((meta as Record<string, unknown>).last_page)
  return last && last > 0 ? last : 1
}

/** Walk every Laravel-style page (`?page=N`) so a busy month is not clipped
 *  at the first fifty rows. */
async function apPages(workspace: string, path: string): Promise<unknown[]> {
  const joiner = path.includes('?') ? '&' : '?'
  const first = await ap<unknown>(workspace, `${path}${joiner}page=1`)
  const rows = [...listOf<unknown>(first)]
  const last = lastPageOf(first)
  if (last <= 1) return rows

  for (let page = 2; page <= last; page += 1) {
    const next = await ap<unknown>(workspace, `${path}${joiner}page=${page}`)
    rows.push(...listOf<unknown>(next))
  }
  return rows
}

/** Bounded parallel map — keeps Autoposter under its rate ceiling while
 *  still finishing every workspace. */
async function mapPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run())
  await Promise.all(workers)
  return results
}

export type WorkspaceLoad<T> = {
  id: string
  ok: boolean
  value: T | null
  error?: string
  status?: number | null
}

export type WorkspaceFailure = { workspaceId: string; message: string; status: number | null }

function failuresOf<T>(report: WorkspaceLoad<T>[]): WorkspaceFailure[] {
  return report.flatMap((one) => one.ok ? [] : [{
    workspaceId: one.id,
    message: one.error ?? 'Autoposter did not answer — try again.',
    status: one.status ?? null,
  }])
}

/** Load every workspace with retries; a single membership failure does not
 *  blank the calendar, but the report says which ones missed. */
async function loadEveryWorkspace<T>(
  worker: (id: string) => Promise<T>,
): Promise<{ report: WorkspaceLoad<T>[] }> {
  const ids = workspaces()
  const report = await mapPool(ids, FANOUT, async (id) => {
    let lastError = 'unknown'
    let lastStatus: number | null = null
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const value = await worker(id)
        return { id, ok: true, value } satisfies WorkspaceLoad<T>
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        lastStatus = error instanceof AutoposterError ? error.status : null
        // ap() already waits once for the provider's Retry-After. Repeating a
        // whole workspace after 429 would consume more of the exhausted
        // request budget; auth and other client errors are not transient.
        if (lastStatus !== null && lastStatus < 500) break
        await sleep(2000 * (attempt + 1))
      }
    }
    return { id, ok: false, value: null, error: lastError, status: lastStatus } satisfies WorkspaceLoad<T>
  })
  return { report }
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
const num = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

// ------------------------------------------------------------------ accounts

export type ApAccount = {
  id: number
  uuid: string | null
  name: string
  platform: string
  avatar: string | null
}

export function normalizeAccount(raw: unknown): ApAccount | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = num(value.id)
  if (id === null) return null
  const platform = (str(value.platform) ?? str(value.provider) ?? str(value.type) ?? 'other').toLowerCase()
  return {
    id,
    uuid: str(value.uuid),
    name: str(value.username) ?? str(value.name) ?? str(value.handle) ?? `Account ${id}`,
    // The API names some providers with a suffix (`facebook_page`) — the
    // console draws the base mark and posts with the documented options.
    platform: platform === 'facebook_page' ? 'facebook' : platform,
    avatar: str(value.image) ?? str(value.avatar) ?? str(value.avatar_url) ?? str(value.picture),
  }
}

export async function listAccounts(workspace?: string | null): Promise<ApAccount[]> {
  const resolved = resolveWorkspace(workspace)
  const rows = await apPages(resolved, '/accounts')
  return rows.map(normalizeAccount).filter((one): one is ApAccount => one !== null)
}

// --------------------------------------------------------------------- posts

/** Content shape the calendar filters on — Instagram's post/reel/story, or
 *  video for YouTube/TikTok when the API does not say otherwise. */
export type PostKind = 'post' | 'story' | 'reel' | 'video'

export type ApPost = {
  /** The uuid when the API offers one — it is what the URLs take. */
  id: string
  /** Workspace this post was read from — required for approve/delete and for
   *  the all-workspaces calendar. Empty only when a raw normalize has no
   *  workspace stamped yet. */
  workspaceId: string
  status: string
  date: string | null
  time: string | null
  timezone: string | null
  body: string
  mediaCount: number
  accountIds: number[]
  title: string | null
  kind: PostKind
  /** Platforms named on the post's accounts, when the API includes them. */
  platforms: string[]
}

/** Captions arrive as the editor's HTML (`<div>…</div>`) — the calendar and
 *  the composer read plain text, so tags become line breaks and entities
 *  become themselves. */
function plainText(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  return value
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000)
}

function kindFromOptions(versions: Record<string, unknown>[]): PostKind | null {
  for (const version of versions) {
    const options = version?.options
    if (!options || typeof options !== 'object') continue
    const bag = options as Record<string, unknown>
    for (const key of ['instagram', 'tiktok', 'facebook', 'threads'] as const) {
      const block = bag[key]
      if (!block || typeof block !== 'object') continue
      const type = str((block as Record<string, unknown>).type)?.toLowerCase()
      if (type === 'story' || type === 'reel' || type === 'post' || type === 'video') return type
      if (type === 'shorts' || type === 'short') return 'video'
    }
  }
  return null
}

function inferKind(platforms: string[], explicit: PostKind | null): PostKind {
  if (explicit) return explicit
  if (platforms.some((p) => p === 'youtube' || p === 'tiktok')) return 'video'
  return 'post'
}

export function normalizePost(raw: unknown, workspaceId = ''): ApPost | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = str(value.uuid) ?? (num(value.id) !== null ? String(num(value.id)) : null)
  if (!id) return null

  const versions = Array.isArray(value.versions) ? (value.versions as Record<string, unknown>[]) : []
  const original =
    versions.find((version) => version?.is_original === true || num(version?.account_id) === 0) ?? versions[0] ?? null
  const content = original && Array.isArray(original.content) ? (original.content as Record<string, unknown>[])[0] ?? null : null
  const media = content && Array.isArray(content.media) ? content.media : []

  const scheduledAt = str(value.scheduled_at) ?? str(value.publish_at)
  const date = str(value.date) ?? str(value.scheduled_date) ?? (scheduledAt ? scheduledAt.slice(0, 10) : null)
  const time = str(value.time) ?? (scheduledAt ? scheduledAt.slice(11, 16) : null)

  const accounts = Array.isArray(value.accounts) ? value.accounts : []
  const accountIds = accounts
    .map((entry) => (entry && typeof entry === 'object' ? num((entry as Record<string, unknown>).id) : num(entry)))
    .filter((one): one is number => one !== null)
  const platforms = [
    ...new Set(
      accounts
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const row = entry as Record<string, unknown>
          const platform = (str(row.platform) ?? str(row.provider) ?? str(row.type) ?? '').toLowerCase()
          return platform === 'facebook_page' ? 'facebook' : platform || null
        })
        .filter((one): one is string => Boolean(one)),
    ),
  ]

  return {
    id,
    workspaceId,
    status: (str(value.status) ?? str(value.state) ?? 'draft').toLowerCase(),
    date,
    time,
    timezone: str(value.timezone),
    body: plainText(content?.body) || plainText(value.body),
    mediaCount: media.length,
    accountIds,
    title: plainText(content?.title) || plainText(value.title) || null,
    kind: inferKind(platforms, kindFromOptions(versions)),
    platforms,
  }
}

export type PostFilters = { status?: string; account?: string; from?: string; to?: string }

export async function listPosts(workspace?: string | null, filters: PostFilters = {}): Promise<ApPost[]> {
  const resolved = resolveWorkspace(workspace)
  const query = new URLSearchParams()
  if (filters.status) query.set('status', filters.status)
  if (filters.account) query.set('account', filters.account)
  // This tenant ignores from/to. Filter locally after normalizing, so calendar
  // months can reuse the same cached pages instead of refetching all history.
  const suffix = query.toString() ? `?${query}` : ''
  const rows = await apPages(resolved, `/posts${suffix}`)
  let posts = rows.map((raw) => normalizePost(raw, resolved)).filter((one): one is ApPost => one !== null)
  if (filters.from || filters.to) {
    posts = posts.filter((post) => {
      if (!post.date) return false
      if (filters.from && post.date < filters.from) return false
      if (filters.to && post.date > filters.to) return false
      return true
    })
  }
  return posts
}

export type AllLoadResult<T> = {
  items: T[]
  /** Workspaces that answered. */
  loaded: number
  /** Workspaces that still failed after retries. */
  failed: string[]
  total: number
  errors: WorkspaceFailure[]
}

export type ApAccountScoped = ApAccount & { workspaceId: string }

export type CalendarBundle = {
  accounts: ApAccountScoped[]
  posts: ApPost[]
  loaded: number
  failed: string[]
  total: number
  errors: WorkspaceFailure[]
}

/**
 * One fan-out over every workspace: accounts then posts for that workspace,
 * pool of FANOUT. Running accounts-all and posts-all in parallel used to
 * double the concurrency and 429 half the roster — this keeps one queue.
 */
export async function listCalendarAll(filters: PostFilters = {}): Promise<CalendarBundle> {
  type Bag = { accounts: ApAccountScoped[]; posts: ApPost[] }
  const { report } = await loadEveryWorkspace<Bag>(async (id) => {
    const accounts = (await listAccounts(id)).map((account) => ({ ...account, workspaceId: id }))
    const posts = await listPosts(id, filters)
    return { accounts, posts }
  })
  return {
    accounts: report.flatMap((one) => one.value?.accounts ?? []),
    posts: report.flatMap((one) => one.value?.posts ?? []),
    loaded: report.filter((one) => one.ok).length,
    failed: report.filter((one) => !one.ok).map((one) => one.id),
    total: report.length,
    errors: failuresOf(report),
  }
}

/** Every workspace the token reaches, posts for a date window — the unified
 *  calendar's read. Paginates each workspace and rate-limits the fan-out so
 *  the month is complete instead of the first fifty rows of a lucky few. */
export async function listPostsAll(filters: PostFilters = {}): Promise<ApPost[]> {
  const result = await listPostsAllDetailed(filters)
  return result.items
}

export async function listPostsAllDetailed(filters: PostFilters = {}): Promise<AllLoadResult<ApPost>> {
  const { report } = await loadEveryWorkspace((id) => listPosts(id, filters))
  return {
    items: report.flatMap((one) => one.value ?? []),
    loaded: report.filter((one) => one.ok).length,
    failed: report.filter((one) => !one.ok).map((one) => one.id),
    total: report.length,
    errors: failuresOf(report),
  }
}

/** Accounts across every workspace, stamped so the calendar can filter
 *  without colliding on Autoposter's per-workspace integer ids. */
export async function listAccountsAll(): Promise<ApAccountScoped[]> {
  const result = await listAccountsAllDetailed()
  return result.items
}

export async function listAccountsAllDetailed(): Promise<AllLoadResult<ApAccountScoped>> {
  const { report } = await loadEveryWorkspace(async (id) => {
    const accounts = await listAccounts(id)
    return accounts.map((account) => ({ ...account, workspaceId: id }))
  })
  return {
    items: report.flatMap((one) => one.value ?? []),
    loaded: report.filter((one) => one.ok).length,
    failed: report.filter((one) => !one.ok).map((one) => one.id),
    total: report.length,
    errors: failuresOf(report),
  }
}

/** The composer's create — draft, scheduled, queued or now, per the docs. */
export type CreatePostInput = {
  accounts: number[]
  body: string
  media: number[]
  instagramType?: 'post' | 'reel' | 'story'
  youtubeTitle?: string
  when: { mode: 'now' } | { mode: 'queue' } | { mode: 'schedule'; date: string; time: string; timezone: string }
}

export async function createPost(workspace: string | null | undefined, input: CreatePostInput): Promise<ApPost | null> {
  const options: Record<string, unknown> = {}
  if (input.instagramType) options.instagram = { type: input.instagramType }
  if (input.youtubeTitle) options.youtube = { title: input.youtubeTitle }

  const payload: Record<string, unknown> = {
    accounts: input.accounts,
    versions: [
      {
        account_id: 0,
        is_original: true,
        content: [{ body: input.body, media: input.media }],
        ...(Object.keys(options).length ? { options } : {}),
      },
    ],
  }
  if (input.when.mode === 'now') payload.schedule_now = true
  else if (input.when.mode === 'queue') payload.queue = true
  else {
    payload.date = input.when.date
    payload.time = input.when.time
    payload.timezone = input.when.timezone
    payload.schedule = true
  }

  const resolved = resolveWorkspace(workspace)
  const data = await ap<unknown>(resolved, '/posts', { method: 'POST', body: JSON.stringify(payload) })
  const created =
    data && typeof data === 'object' && 'post' in data ? (data as Record<string, unknown>).post : data
  return normalizePost(created, resolved)
}

export async function deletePost(workspace: string | null | undefined, id: string): Promise<void> {
  await ap(resolveWorkspace(workspace), `/posts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Approve a post awaiting team review, or drop a draft into the queue. */
export async function postAction(workspace: string | null | undefined, id: string, action: 'approve' | 'queue'): Promise<void> {
  const path = action === 'approve' ? `/posts/approve/${encodeURIComponent(id)}` : `/posts/add-to-queue/${encodeURIComponent(id)}`
  await ap(resolveWorkspace(workspace), path, { method: 'POST' })
}

// --------------------------------------------------------------------- media

export type ApMedia = { id: number; url: string | null; name: string | null; kind: string | null }

export function normalizeMedia(raw: unknown): ApMedia | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = num(value.id)
  if (id === null) return null
  return {
    id,
    url: str(value.url) ?? str(value.thumbnail_url) ?? str(value.preview_url),
    name: str(value.name) ?? str(value.filename),
    kind: str(value.type) ?? str(value.mime_type),
  }
}

export async function listMedia(workspace?: string | null): Promise<ApMedia[]> {
  const resolved = resolveWorkspace(workspace)
  const rows = await apPages(resolved, '/media')
  return rows.map(normalizeMedia).filter((one): one is ApMedia => one !== null)
}

/** Direct upload of one file — the docs' small-file multipart door. */
export async function uploadMedia(workspace: string | null | undefined, file: File): Promise<ApMedia> {
  const form = new FormData()
  form.append('files[]', file, file.name || 'upload')
  const data = await ap<unknown>(resolveWorkspace(workspace), '/media', { method: 'POST', body: form })
  const created =
    data && typeof data === 'object' && 'media' in data ? (data as Record<string, unknown>).media : data
  const media = Array.isArray(created) ? normalizeMedia(created[0]) : normalizeMedia(created)
  if (!media) throw new AutoposterError('The upload went through but no media id came back.', 502)
  return media
}
