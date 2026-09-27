'use client'

import { formatDate } from '@/lib/dates'

/** Put one of her reels on her week as a Repurpose card and open the file
 *  for the batcher. Resolves to what to tell the operator. Shared by the
 *  Analytics and Reels tabs. */
export function useRepurpose(modelId: string) {
  return async function repurpose(reel: { post_id: string }): Promise<string> {
    const response = await fetch(`/api/models/${modelId}/repurpose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: reel.post_id }),
    }).catch(() => null)
    const body = await response?.json().catch(() => ({})) ?? {}
    if (!response?.ok) return body.error ?? 'That did not go through.'
    if (body.download) window.open(body.download, '_blank', 'noopener')
    const week = formatDate(body.week_of)
    const where = body.added ? `On the week of ${week} — needs repurposing.` : `Already on the week of ${week}.`
    return body.download ? `${where} Download opened for the batcher.` : `${where} ${body.note ?? ''}`.trim()
  }
}
