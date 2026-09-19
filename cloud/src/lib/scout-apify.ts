/**
 * Scout's logged-out reader, run from the cloud instead of the Mac.
 *
 * The actor itself always ran on Apify's machines; the Mac was only starting
 * it and carrying the results back. Starting it from here removes the Mac from
 * the open half of the sweep entirely, so discovery keeps running when the Mac
 * is asleep, unplugged or dead.
 *
 * The shape: start the run with an ad-hoc webhook, return immediately, and let
 * Apify call `/api/scout/apify-hook` when it finishes. Nothing waits — which
 * matters on a 60-second serverless function where a sweep takes minutes.
 *
 * The gated half cannot move here: it needs a residential address and a
 * signed-in session, so it stays on the Mac (`src/scout_ig.py`).
 */
import type { Sighting } from './scout'
import { parseSighting } from './scout'

const ACTOR = 'apify~instagram-reel-scraper'
const API = 'https://api.apify.com/v2'
const PAGE = 1_000
export const MAX_ITEMS_PER_HOOK = 8_000

/** Deep enough to take a median from on a first sweep, and the cap the Mac
 *  reader uses too. */
export const BACKFILL_REELS = 30
export const REFRESH_REELS = 30
/** The pick window plus slack, so a reel's climbing plays are re-read. */
export const REFRESH_DAYS = 17

const GATED_HINTS = ['restrict', 'age', '21 years', '18 years', 'private', 'login']
const MISSING_HINTS = ['not found', 'not exist', "doesn't exist", 'does not exist', 'no such']

function token(): string {
  const value = process.env.APIFY_TOKEN
  if (!value) throw new Error('APIFY_TOKEN is not set')
  return value
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Apify ${method} ${path.split('?')[0]} → ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  return response.json()
}

/** Start one actor run and hand Apify the address to call when it is done. */
export async function startRun(opts: {
  handles: string[]
  limit: number
  newerThan?: string
  maxUsd: number
  hookUrl: string
}): Promise<{ id: string; datasetId: string }> {
  // The webhook rides on the start request, so nothing has to be registered on
  // the Apify account by hand and a redeploy cannot leave a stale hook behind.
  const webhooks = Buffer.from(
    JSON.stringify([
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.ABORTED', 'ACTOR.RUN.TIMED_OUT'],
        requestUrl: opts.hookUrl,
      },
    ]),
  ).toString('base64')

  const input: Record<string, unknown> = {
    username: opts.handles,
    resultsLimit: opts.limit,
    skipPinnedPosts: true,
  }
  if (opts.newerThan) input.onlyPostsNewerThan = opts.newerThan

  const query = new URLSearchParams({
    maxTotalChargeUsd: opts.maxUsd.toFixed(2),
    webhooks,
  })
  const started = (await call('POST', `/acts/${ACTOR}/runs?${query}`, input)) as {
    data?: { id?: string; defaultDatasetId?: string }
  }
  const id = started.data?.id
  const datasetId = started.data?.defaultDatasetId
  if (!id || !datasetId) throw new Error('Apify did not return a run id')
  return { id, datasetId }
}

export async function runInfo(runId: string): Promise<{ status: string; costUsd: number; datasetId?: string }> {
  const polled = (await call('GET', `/actor-runs/${runId}`)) as {
    data?: { status?: string; usageTotalUsd?: number; defaultDatasetId?: string }
  }
  return {
    status: String(polled.data?.status ?? 'UNKNOWN'),
    costUsd: Number(polled.data?.usageTotalUsd ?? 0),
    datasetId: polled.data?.defaultDatasetId,
  }
}

/** Every row the run wrote, in pages. Capped so one enormous run cannot run a
 *  60-second function out of time; the cap is reported, never silent. */
export async function datasetItems(datasetId: string): Promise<{ items: Record<string, unknown>[]; truncated: boolean }> {
  const items: Record<string, unknown>[] = []
  for (let offset = 0; offset < MAX_ITEMS_PER_HOOK; offset += PAGE) {
    const page = (await call(
      'GET',
      `/datasets/${datasetId}/items?clean=true&format=json&offset=${offset}&limit=${PAGE}`,
    )) as Record<string, unknown>[]
    if (!Array.isArray(page) || page.length === 0) return { items, truncated: false }
    items.push(...page)
    if (page.length < PAGE) return { items, truncated: false }
  }
  return { items, truncated: true }
}

function first(...values: unknown[]): unknown {
  return values.find((v) => v !== null && v !== undefined && v !== '' && v !== -1)
}

function names(entries: unknown): string[] {
  if (!Array.isArray(entries)) return []
  const out: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') out.push(entry)
    else if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      const user = (record.user ?? {}) as Record<string, unknown>
      const name = record.username ?? user.username
      if (typeof name === 'string') out.push(name)
    }
  }
  return out
}

function audio(item: Record<string, unknown>) {
  const music = (item.musicInfo ?? {}) as Record<string, unknown>
  const asset = (music.music_asset_info ?? {}) as Record<string, unknown>
  const original = (music.original_sound_info ?? {}) as Record<string, unknown>
  const usesOriginal = first(music.uses_original_audio, Object.keys(original).length > 0 ? true : undefined)
  return {
    audio_id: first(music.audio_id, music.audio_cluster_id, asset.audio_cluster_id, music.music_asset_id, original.audio_asset_id, music.id),
    audio_title: first(music.song_name, music.title, asset.title, original.original_audio_title),
    audio_artist: first(music.artist_name, music.display_artist, asset.display_artist),
    original_audio: typeof usesOriginal === 'boolean' ? usesOriginal : null,
  }
}

/** One actor row → a validated sighting, or null. Mirrors `to_sighting` in
 *  `src/scout_apify.py`; both feed the same validator. */
export function toSighting(item: Record<string, unknown>): Sighting | null {
  if (item.error) return null
  return parseSighting({
    post_id: item.shortCode,
    handle: typeof item.ownerUsername === 'string' ? item.ownerUsername.toLowerCase() : '',
    via: 'apify',
    posted_at: item.timestamp,
    // `videoPlayCount` is THE field: sampled 200 rows of the first real sweep
    // and igPlayCount/videoViewCount were empty in every one, while the two
    // never disagreed where both existed. Pinning one keeps every creator's
    // baseline on the same measure; the others are fallbacks that should
    // never fire.
    plays: first(item.videoPlayCount, item.igPlayCount, item.videoViewCount),
    likes: item.likesCount,
    comments: item.commentsCount,
    duration_sec: item.videoDuration,
    caption: item.caption,
    collaborators: names(item.coauthorProducers),
    tagged: names(item.taggedUsers),
    pinned: item.isPinned === true,
    ...audio(item),
  })
}

/** What the run learned about reading each account. */
export function accessFrom(items: Record<string, unknown>[], handles: string[]): { handle: string; access: 'open' | 'gated' | 'missing' }[] {
  const wanted = new Set(handles.map((h) => h.toLowerCase()))
  const seen = new Map<string, 'open' | 'gated' | 'missing'>()
  for (const item of items) {
    let handle = typeof item.ownerUsername === 'string' ? item.ownerUsername.toLowerCase() : ''
    if (!handle) {
      const source = String(item.inputUrl ?? item.username ?? '')
      handle = source.replace(/\/+$/, '').split('/').pop()?.toLowerCase() ?? ''
    }
    if (!wanted.has(handle)) continue
    if (!item.error) {
      seen.set(handle, 'open')
      continue
    }
    if (seen.get(handle) === 'open') continue
    const message = [item.error, item.errorDescription, item.requestErrorMessages].join(' ').toLowerCase()
    if (item.isRestrictedProfile || GATED_HINTS.some((hint) => message.includes(hint))) seen.set(handle, 'gated')
    else if (MISSING_HINTS.some((hint) => message.includes(hint))) seen.set(handle, 'missing')
  }
  return [...seen].map(([handle, access]) => ({ handle, access }))
}
