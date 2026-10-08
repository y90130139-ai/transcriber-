'use client'

import { currentWeekOf } from '@/lib/dates'
import type { EditorQueue } from '@/lib/editor'
import { forget, loadJson, prefetch } from '@/lib/live'
import type { Review } from '@/lib/review'

/**
 * Everything the profile sheet reads, in one list.
 *
 * The sheet's reads are spread across its own component and every tab behind
 * it — five on its face and a dozen more behind the tabs — so the only way to
 * have them warm before a tap is to name them in one place. Kept in step with
 * the fetches themselves: a read added to a tab belongs here too, or it is the
 * one thing that still arrives late.
 */
export function profileUrls(modelId: string, week = currentWeekOf()): string[] {
  return [
    // The face of the sheet: her record and declines, her followers, the
    // brief's overrides, and her own posts.
    `/api/models/${modelId}`,
    `/api/models/${modelId}/followers`,
    `/api/models/${modelId}/brief`,
    `/api/models/${modelId}/posts`,
    // The header's priority and revenue chips, and the strip's figures.
    `/api/models/${modelId}/standing`,
    // Behind the tabs, in the order they sit on the bar.
    `/api/models/${modelId}/performance?days=30`,
    `/api/earnings/model/${modelId}?days=30`,
    `/api/models/${modelId}/review?week=${week}`,
    `/api/models/${modelId}/editor`,
    `/api/models/${modelId}/quality`,
    `/api/models/${modelId}/report`,
    `/api/models/${modelId}/messages`,
    `/api/models/${modelId}/insights`,
    // Profile and Week.
    `/api/models/${modelId}/solo`,
    `/api/models/${modelId}/intake`,
    `/api/models/${modelId}/survey`,
    '/api/bot/groups',
  ]
}

/**
 * Warm every read the sheet will make for her — plus the reels' covers and
 * numbers, whose URL is built from what the review and editor payloads name,
 * so it can only start once those two land.
 */
export function warmProfile(modelId: string): void {
  const week = currentWeekOf()
  prefetch(...profileUrls(modelId, week))

  void Promise.all([
    loadJson<Review>(`/api/models/${modelId}/review?week=${week}`),
    loadJson<EditorQueue>(`/api/models/${modelId}/editor`),
  ])
    .then(([review, queue]) => {
      const codes = [
        ...(review?.posts ?? []).filter((post) => post.kind === 'reel').map((post) => post.post_id),
        ...(queue?.tasks ?? []).filter((task) => !task.done).map((task) => task.source_post),
      ]
      if (!codes.length) return
      // The same key `useReelMedia` builds, or the warm is for a URL nobody asks.
      prefetch(`/api/reels/media?codes=${encodeURIComponent([...new Set(codes)].sort().join(','))}`)
    })
    .catch(() => {})
}

/** Her profile just saved: every read above is now a guess, so drop them. */
export function forgetProfile(modelId: string): void {
  for (const url of profileUrls(modelId)) forget(url)
}
