/**
 * Which reels were followed by money — internal only (Geno, 2026-09-30).
 *
 * For each New York day she posted reels: how those reels did against her
 * usual views, and what she made that day and the next against her usual two
 * days. That is a coincidence in time, not proof a reel caused a sale, which is
 * why it never reaches a creator; across many days it does show whether her
 * hits tend to bring money, and that is the question.
 *
 *   usual views   median plays of her reels 8–60 days old (as shout-outs)
 *   usual 2 days  2 × her median day over the 28 days before the post
 *   hit           best reel that day at ≥ 2× her usual views
 *   moved money   the two days at ≥ 1.5× her usual two days
 */
import { addDays, dayOf, type Day } from './days'
import { dense, median } from './report'

export const REELS = { hit: 2, moved: 1.5, medianDays: 28, window: 2 } as const

export type ReelPost = { post_id: string; handle: string; posted_at: number; plays: number; caption: string | null }

export type ReelDay = {
  day: string
  reels: { post_id: string; handle: string; plays: number; multiple: number | null; caption: string | null; url: string }[]
  best: number | null // best reel multiple that day
  net: number // her net over the day and the next, cents
  usualNet: number // her usual two days, cents
  moneyMultiple: number | null
  subs: number
  usualSubs: number
  complete: boolean // the second day has ended
  hit: boolean
  moved: boolean
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** `history` must reach 28 days before the earliest post. `today` is the New
 *  York date now. Pure. */
export function reelDays(posts: ReelPost[], history: Day[], usualPlays: number | null, today: string): ReelDay[] {
  const byDay = new Map<string, ReelPost[]>()
  for (const p of posts) {
    const d = dayOf(p.posted_at)
    byDay.set(d, [...(byDay.get(d) ?? []), p])
  }
  const out: ReelDay[] = []
  for (const [day, list] of byDay) {
    if (day >= today) continue
    const window = dense(history, day, addDays(day, REELS.window - 1))
    const before = dense(history, addDays(day, -REELS.medianDays), addDays(day, -1))
    const usualNet = median(before.map((d) => d.net)) * REELS.window
    const usualSubs = median(before.map((d) => d.subs)) * REELS.window
    const net = window.reduce((n, d) => n + d.net, 0)
    const reels = [...list]
      .sort((a, b) => b.plays - a.plays)
      .map((p) => ({
        post_id: p.post_id, handle: p.handle, plays: p.plays, caption: p.caption,
        multiple: usualPlays ? round1(p.plays / usualPlays) : null,
        url: `https://www.instagram.com/reel/${p.post_id}/`,
      }))
    const best = reels[0]?.multiple ?? null
    const moneyMultiple = usualNet > 0 ? round1(net / usualNet) : null
    out.push({
      day, reels, best, net, usualNet, moneyMultiple,
      subs: window.reduce((n, d) => n + d.subs, 0), usualSubs,
      complete: addDays(day, REELS.window - 1) < today,
      hit: best !== null && best >= REELS.hit,
      moved: moneyMultiple !== null && moneyMultiple >= REELS.moved,
    })
  }
  return out.sort((a, b) => b.day.localeCompare(a.day))
}

export type ReelSummary = { hitDays: number; hitAvg: number | null; otherDays: number; otherAvg: number | null }

/** After her hit reels vs after her other reels: the average money multiple
 *  of each, over complete days only. The one line that answers "do her hits
 *  bring money". */
export function summarize(days: ReelDay[]): ReelSummary {
  const done = days.filter((d) => d.complete && d.moneyMultiple !== null)
  const avg = (xs: ReelDay[]) => (xs.length ? round1(xs.reduce((n, d) => n + d.moneyMultiple!, 0) / xs.length) : null)
  const hits = done.filter((d) => d.hit)
  const others = done.filter((d) => !d.hit)
  return { hitDays: hits.length, hitAvg: avg(hits), otherDays: others.length, otherAvg: avg(others) }
}
