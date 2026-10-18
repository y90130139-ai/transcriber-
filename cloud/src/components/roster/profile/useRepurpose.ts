'use client'

import { formatDate } from '@/lib/dates'

/** Put one of her reels on her week as a Repurpose card and queue the studio
 *  render (docs/REPURPOSE.md). Resolves to what to tell the operator. Shared
 *  by the Analytics and Reels tabs. */
export function useRepurpose(modelId: string) {
  return async function repurpose(reel: { post_id: string }): Promise<string> {
    const response = await fetch(`/api/models/${modelId}/repurpose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: reel.post_id }),
    }).catch(() => null)
    const body = await response?.json().catch(() => ({})) ?? {}
    if (!response?.ok) {
      const said = body.error ?? 'That did not go through.'
      return body.render === 'queued'
        ? `${said} The fresh file is still being rendered — it lands under Reels → Repurposed.`
        : said
    }
    const week = formatDate(body.week_of)
    const where = body.added ? `On the week of ${week} as a Repurpose card.` : `Already on the week of ${week}.`
    if (body.render === 'queued') {
      return `${where} Rendering a fresh copy — it appears under Reels → Repurposed when it is done.`
    }
    return `${where} ${body.note ?? ''}`.trim()
  }
}
