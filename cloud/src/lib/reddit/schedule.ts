/**
 * The scheduler's arithmetic, as pure functions — the same interval rule the
 * SQL enqueue uses, and a full 24-hour simulation the test suite runs to
 * prove 1,000-community coverage without issuing a single real request.
 *
 * The model, in one line: **every community has a due time; the queue is
 * served oldest-due first.**
 *
 *   due = last_synced + interval(priority) × activity_scale
 *
 * - `interval(priority)` is the configured target: high 180m, medium 720m,
 *   low 1440m — all ≤ 24h, so daily coverage is structural.
 * - `activity_scale` (1.0 / 0.75 / 0.5) lets busy communities earn extra
 *   refreshes by making their due times arrive sooner.
 * - FIFO on due time is the fairness guarantee: a quiet community due at
 *   09:00 is served before a busy one due at 09:05, no matter how loud the
 *   busy one is. Nothing can be starved while capacity exists.
 */

export type Priority = 'high' | 'medium' | 'low'

export type TargetMinutes = Record<Priority, number>

/** Defaults: one scan a day for everything, twice for high priority. A
 *  successful sync means tomorrow, not three hours from now. */
export const DEFAULT_TARGETS: TargetMinutes = { high: 720, medium: 1440, low: 1440 }

/** Never fetch a community more often than this, whatever its activity. */
export const MIN_INTERVAL_MINUTES = 15
/** The daily-coverage ceiling: no effective interval may exceed a day. */
export const MAX_INTERVAL_MINUTES = 1440

/**
 * The gap-maker. Every community's due time is pulled forward by a stable
 * 80–95% of its interval, derived from its own name — so a fleet synced in
 * one sweep does not come due in one wave tomorrow. The factor is always
 * ≤ 1, which is what keeps the "at least once every 24 hours" promise
 * while spreading the actual fetches across ~3½ hours of every day.
 */
export function spreadFactor(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return 0.8 + (Math.abs(hash) % 16) / 100
}

export type SchedulerSub = {
  id: string
  priority: Priority
  /** Posts observed in the last 24 hours — drives the activity scale. */
  activity: number
  /** Epoch ms of the last successful fetch; null = never fetched. */
  lastSyncedAt: number | null
}

/** Busy communities earn a slightly earlier scan — extra refreshes when
 *  the budget permits, exactly the scale the SQL enqueue applies. Gentle
 *  on purpose: a scan means tomorrow for everyone (19–23h), busy or not. */
export function activityScale(activity: number): number {
  if (activity >= 100) return 0.8
  if (activity >= 30) return 0.9
  return 1
}

/** The effective interval a community is on right now. */
export function effectiveIntervalMinutes(sub: Pick<SchedulerSub, 'priority' | 'activity'>, targets: TargetMinutes = DEFAULT_TARGETS): number {
  const base = targets[sub.priority]
  const scaled = Math.round(base * activityScale(sub.activity))
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, scaled))
}

/** The moment a community is next due, in epoch ms. A never-fetched
 *  community is due at the start of time — first in the queue, always. */
export function dueAt(sub: SchedulerSub, now: number, targets: TargetMinutes = DEFAULT_TARGETS): number {
  if (sub.lastSyncedAt === null) return Number.NEGATIVE_INFINITY
  const spread = effectiveIntervalMinutes(sub, targets) * spreadFactor(sub.id)
  return sub.lastSyncedAt + spread * 60_000
}

export type SchedulerOptions = {
  /** Requests one fetch costs (listings fetched per community). */
  listingsPerFetch: number
  /** Internal daily ceiling — every request counts, failures included. */
  dailyCap: number
  /** Normal throttle, requests per minute. */
  requestsPerMinute: number
  targets?: TargetMinutes
}

export type SimulationResult = {
  /** Total requests the day would spend, failures included. */
  requests: number
  /** How many times each community was fetched. */
  fetches: Map<string, number>
  /** Communities that never got a fetch inside the window. */
  uncovered: string[]
  /** Requests per hour (24 entries) — the burst check. */
  hourly: number[]
  /** True when the daily cap stopped the schedule early. */
  capHit: boolean
  /** Minutes until every community had at least one fetch, or null. */
  coverageMinutes: number | null
}

/**
 * Simulate one 24-hour day: repeatedly fetch the community with the oldest
 * due time, pay its requests at the throttle, until the window closes, the
 * cap is reached, or nothing is due. Nothing here touches the network — the
 * point is to prove the schedule's coverage and its ceiling.
 *
 * `failures` optionally injects a failure rate: every failed attempt costs
 * a request (as the real client counts them) and the community is retried
 * with a five-minute backoff instead of being marked fresh.
 */
export function simulateDay(
  subs: SchedulerSub[],
  options: SchedulerOptions,
  failureRate = 0,
): SimulationResult {
  const targets = options.targets ?? DEFAULT_TARGETS
  const perRequestMs = 60_000 / Math.max(0.01, options.requestsPerMinute)
  const dayMs = 86_400_000
  const hourly = Array.from({ length: 24 }, () => 0)
  const fetches = new Map<string, number>()
  const due = new Map<string, number>()
  // The fixture's last-sync times are relative; anchor the day so "now" is
  // the newest of them.
  const anchor = Math.max(0, ...subs.map((sub) => sub.lastSyncedAt ?? 0), 0)

  for (const sub of subs) due.set(sub.id, dueAt(sub, anchor, targets))

  let t = 0
  let requests = 0
  let capHit = false
  let coverageMinutes: number | null = subs.length === 0 ? 0 : null

  while (t < dayMs) {
    if (requests >= options.dailyCap) { capHit = true; break }

    // Oldest due first; ties go to the higher priority, then id order.
    let best: SchedulerSub | null = null
    let bestDue = Number.POSITIVE_INFINITY
    for (const sub of subs) {
      const at = due.get(sub.id) ?? Number.NEGATIVE_INFINITY
      if (at > anchor + t) continue // not due yet
      if (
        at < bestDue
        || (at === bestDue && best !== null && priorityRank(sub.priority) < priorityRank(best.priority))
      ) {
        best = sub
        bestDue = at
      }
    }
    if (!best) {
      // Nothing due this minute. A real cron run would idle and fire again
      // later, so the clock advances to the next due time instead of the
      // day ending here.
      let nextDue = Number.POSITIVE_INFINITY
      for (const sub of subs) nextDue = Math.min(nextDue, due.get(sub.id) ?? Number.POSITIVE_INFINITY)
      if (!Number.isFinite(nextDue) || nextDue >= anchor + dayMs) break
      t = Math.max(t, nextDue - anchor)
      continue
    }

    const fetchRequests = Math.max(1, options.listingsPerFetch)
    const finishAt = t + fetchRequests * perRequestMs
    if (finishAt >= dayMs) break
    if (requests + fetchRequests > options.dailyCap) { capHit = true; break }

    const failed = failureRate > 0 && pseudoRandom(requests) < failureRate
    requests += fetchRequests
    for (let i = 0; i < fetchRequests; i += 1) {
      hourly[Math.min(23, Math.floor((t + i * perRequestMs) / 3_600_000))] += 1
    }
    if (failed) {
      // The attempt cost budget; the community retries in five minutes.
      due.set(best.id, anchor + t + 5 * 60_000)
    } else {
      const fetchedAt = anchor + t
      fetches.set(best.id, (fetches.get(best.id) ?? 0) + 1)
      due.set(best.id, fetchedAt + effectiveIntervalMinutes(best, targets) * 60_000)
      if (coverageMinutes === null && fetches.size === subs.length) {
        coverageMinutes = Math.round((t + fetchRequests * perRequestMs) / 60_000)
      }
    }
    t = finishAt
  }

  const uncovered = subs.filter((sub) => !fetches.has(sub.id)).map((sub) => sub.id)
  return { requests, fetches, uncovered, hourly, capHit, coverageMinutes }
}

const priorityRank = (priority: Priority) => (priority === 'high' ? 0 : priority === 'medium' ? 1 : 2)

/** Deterministic pseudo-random for reproducible failure injection. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** A ready-made 1,000-community fleet for the simulation tests: a realistic
 *  mix of priorities, activity and staleness. */
export function sampleFleet(count = 1000, now = 0): SchedulerSub[] {
  const priorities: Priority[] = ['high', 'medium', 'low']
  return Array.from({ length: count }, (_, index) => {
    const priority = priorities[index % 3 === 0 ? 0 : index % 5 === 0 ? 1 : 2]
    return {
      id: `sub-${index}`,
      priority,
      // A long tail: a few very busy communities, most quiet.
      activity: index % 50 === 0 ? 400 : index % 10 === 0 ? 120 : 10 + (index % 40),
      lastSyncedAt: index % 7 === 0 ? null : now - (index % 20) * 3_600_000,
    }
  })
}
