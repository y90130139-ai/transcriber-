/**
 * Performance, worked out from the rows Scout leaves behind — pure, so the
 * rules can be checked without a database.
 *
 * Two traps shape every rule here:
 *
 *  - Follower history only exists from the day Scout started reading an
 *    account (2026-09-20 for most). A period longer than that is measured from
 *    the first reading, and says so, rather than inventing a flat line.
 *  - A reel's plays keep climbing for days. "This month's reels vs last
 *    month's" would make every account look like it was crashing, because the
 *    newest reels have not had time. Trends compare reels that have *settled*
 *    (a week old or more) against the reels before them.
 */

export type TagKey = 'top' | 'average' | 'attention'
export type Direction = 'up' | 'down' | 'flat'

export const TAG_LABEL: Record<TagKey, string> = {
  top: 'Top performer',
  average: 'Average',
  attention: 'Needs attention',
}

/** Every threshold in one place (Geno, 2026-09-27: auto, with override). */
export const RULES = {
  /** A reel counts toward a trend once it is this old — plays have settled. */
  settledDays: 7,
  /** Reels on each side of a views comparison, and the least that will do. */
  compareReels: 10,
  minCompareReels: 5,
  /** Views move this much (median, settled reels) before it counts. */
  viewsMove: 0.2,
  /** Followers: gaining this share is up; losing this share is down. */
  followersUp: 0.01,
  followersDown: 0.005,
  /** Silent this long, and she needs attention whatever else is true. */
  quietDays: 14,
  /** Share of her weekly target: under the first needs attention, the second
   *  is the least a top performer posts. */
  attentionShare: 0.25,
  topShare: 1 / 3,
  /** Fewer reels than this ever seen, and there is nothing to judge. */
  minReels: 3,
} as const

const DAY = 86_400_000

export type Snapshot = { handle: string; day: string; followers: number; story: boolean }
export type Post = {
  handle: string
  post_id: string
  kind: string | null
  posted_at: string | null
  plays: number | null
  likes: number | null
  comments: number | null
}

export const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Every day from `from` to `to`, inclusive, as YYYY-MM-DD. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/**
 * Followers per day across a set of accounts, summed. Each account carries its
 * last reading forward, and before its first reading it is held at that first
 * reading — so adding a second account on day five is not a jump of her
 * whole following. Days before *any* reading are left out entirely.
 */
export function followerSeries(snaps: Snapshot[], days: string[]): { day: string; value: number }[] {
  const byHandle = new Map<string, Map<string, number>>()
  for (const s of snaps) {
    const one = byHandle.get(s.handle) ?? new Map<string, number>()
    one.set(s.day, Math.max(one.get(s.day) ?? 0, s.followers))
    byHandle.set(s.handle, one)
  }
  const firstSeen = Math.min(...snaps.map((s) => Date.parse(`${s.day}T00:00:00Z`)))
  const series: { day: string; value: number }[] = []
  const last = new Map<string, number>()
  for (const [handle, readings] of byHandle) {
    const first = [...readings.keys()].sort()[0]
    last.set(handle, readings.get(first) ?? 0)
  }
  for (const day of days) {
    if (!Number.isFinite(firstSeen) || Date.parse(`${day}T00:00:00Z`) < firstSeen) continue
    let total = 0
    for (const [handle, readings] of byHandle) {
      const today = readings.get(day)
      if (today !== undefined) last.set(handle, today)
      total += last.get(handle) ?? 0
    }
    series.push({ day, value: total })
  }
  return series
}

/** Plays on reels posted each day (a day with none is 0). */
export function viewsByDay(posts: Post[], days: string[]): { day: string; value: number }[] {
  const byDay = new Map<string, number>()
  for (const p of posts) {
    if (!p.posted_at || p.plays === null) continue
    const day = p.posted_at.slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + p.plays)
  }
  return days.map((day) => ({ day, value: byDay.get(day) ?? 0 }))
}

/**
 * Views direction from settled reels: the median of her newest settled reels
 * against the median of the ones before them. Null when there are not enough
 * on either side to say.
 */
export function viewsChange(posts: Post[], now = Date.now()): { change: number | null; recent: number | null; before: number | null } {
  const settled = posts
    .filter((p) => p.kind === 'reel' && p.plays !== null && p.posted_at && now - Date.parse(p.posted_at) >= RULES.settledDays * DAY)
    .sort((a, b) => Date.parse(b.posted_at as string) - Date.parse(a.posted_at as string))
  const size = Math.min(RULES.compareReels, Math.floor(settled.length / 2))
  if (size < RULES.minCompareReels) return { change: null, recent: null, before: null }
  const recent = median(settled.slice(0, size).map((p) => p.plays as number))
  const before = median(settled.slice(size, size * 2).map((p) => p.plays as number))
  if (recent === null || !before) return { change: null, recent, before }
  return { change: (recent - before) / before, recent, before }
}

export function direction(views: number | null, followersPct: number | null): Direction | null {
  const v = views === null ? null : views >= RULES.viewsMove ? 1 : views <= -RULES.viewsMove ? -1 : 0
  const f = followersPct === null ? null : followersPct >= RULES.followersUp ? 1 : followersPct <= -RULES.followersDown ? -1 : 0
  if (v === null && f === null) return null
  const score = (v ?? 0) + (f ?? 0)
  return score > 0 ? 'up' : score < 0 ? 'down' : 'flat'
}

/**
 * The automatic tag. Needs attention: quiet for two weeks, trending down, or
 * posting under a quarter of her weekly target. Top performer: moving up and
 * posting at least a third of her target. Everyone else is average. Null when
 * there is too little to judge.
 */
export function autoTag(input: {
  reelsSeen: number
  daysSinceLastPost: number | null
  reelsPerWeek: number
  weeklyTarget: number
  trend: Direction | null
}): TagKey | null {
  if (input.reelsSeen < RULES.minReels) return null
  const target = input.weeklyTarget > 0 ? input.weeklyTarget : 21
  if (input.daysSinceLastPost === null || input.daysSinceLastPost >= RULES.quietDays) return 'attention'
  // Falling views count only when the whole picture is down: a big poster
  // whose median dipped while she gained followers is not a problem account.
  if (input.trend === 'down') return 'attention'
  if (input.reelsPerWeek < target * RULES.attentionShare) return 'attention'
  if (input.trend === 'up' && input.reelsPerWeek >= target * RULES.topShare) return 'top'
  return 'average'
}

/**
 * Why a model reads Needs attention, in plain words — every rule that holds,
 * not just the first, so the dashboard can say all of it at once. Same rules
 * and thresholds as `autoTag`; empty when none apply.
 */
export function attentionReasons(input: {
  reelsSeen: number
  daysSinceLastPost: number | null
  reelsPerWeek: number
  weeklyTarget: number
  trend: Direction | null
  viewsChange: number | null
  followersGain: number | null
}): string[] {
  if (input.reelsSeen < RULES.minReels) return []
  const target = input.weeklyTarget > 0 ? input.weeklyTarget : 21
  const reasons: string[] = []
  if (input.daysSinceLastPost === null) reasons.push('No posts seen on their Instagram.')
  else if (input.daysSinceLastPost >= RULES.quietDays) reasons.push(`Nothing posted in ${Math.floor(input.daysSinceLastPost)} days.`)
  if (input.trend === 'down') {
    const parts: string[] = []
    if (input.viewsChange !== null && input.viewsChange <= -RULES.viewsMove) {
      parts.push(`views on recent reels are down ${Math.floor(-input.viewsChange * 100)}%`)
    }
    if (input.followersGain !== null && input.followersGain < 0) {
      parts.push(`lost ${Math.abs(input.followersGain).toLocaleString('en-US')} followers`)
    }
    reasons.push(`Trending down${parts.length ? ` — ${parts.join(' and ')}` : ''}.`)
  }
  if (input.reelsPerWeek < target * RULES.attentionShare) {
    reasons.push(`Posting ${input.reelsPerWeek.toFixed(1)} reels a week — under a quarter of their target of ${target}.`)
  }
  return reasons
}

/**
 * Several series added into one. Each part is held at its first value on the
 * days before it starts — a model whose tracking began on the 26th must not
 * arrive as a one-day jump of her whole following.
 */
export function sumHeld(parts: { day: string; value: number }[][], days: string[]): { day: string; value: number }[] {
  const live = parts.filter((part) => part.length > 0)
  if (!live.length) return []
  const start = live.map((part) => part[0].day).sort()[0]
  return days.filter((day) => day >= start).map((day) => ({
    day,
    value: live.reduce((total, part) => {
      let value = part[0].value
      for (const point of part) { if (point.day > day) break; value = point.value }
      return total + value
    }, 0),
  }))
}
