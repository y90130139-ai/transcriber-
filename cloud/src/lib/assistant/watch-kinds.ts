/**
 * The alert menu (/q phase 2, Geno 2026-10-03). The assistant turns "tell me
 * when..." into one of these kinds; nothing outside this list can be watched.
 * Pure: validation and wording only. Checking against the database is in
 * ./watches.
 *
 * Anything the bot already alerts OPS about is deliberately missing: earnings
 * days or weeks down 25%+, an account gone from Infloww, Content Snare
 * hand-ins and overdue items, the Drive pipeline, Instagram login deaths,
 * model questions on their plans, shout-outs and scorecards.
 */

export type WatchKind =
  | 'questionnaire_answered'
  | 'questionnaire_opened'
  | 'plan_not_opened'
  | 'week_net_below'
  | 'reel_over_usual'
  | 'failed_downloads_above'

export type WatchParams = {
  model?: string | null // display name, resolved when proposed
  model_id?: string | null
  days?: number
  usd?: number
  times?: number
  count?: number
}

type KindSpec = {
  /** How often it is worth checking, in minutes. */
  every: number
  needs: Array<'days' | 'usd' | 'times' | 'count'>
  limits: Partial<Record<'days' | 'usd' | 'times' | 'count', [number, number]>>
  label: (p: WatchParams) => string
}

const who = (p: WatchParams) => p.model ?? 'any model'

export const KINDS: Record<WatchKind, KindSpec> = {
  questionnaire_answered: {
    every: 5, needs: [], limits: {},
    label: (p) => `When ${who(p)} finishes the questionnaire`,
  },
  questionnaire_opened: {
    every: 5, needs: [], limits: {},
    label: (p) => `When ${who(p)} opens the questionnaire`,
  },
  plan_not_opened: {
    every: 30, needs: ['days'], limits: { days: [1, 7] },
    label: (p) => `When ${who(p)} has not opened this week's plan ${p.days} day${p.days === 1 ? '' : 's'} after it was sent`,
  },
  week_net_below: {
    every: 60, needs: ['usd'], limits: { usd: [1, 1_000_000] },
    label: (p) => `When ${who(p)} closes a Monday-Sunday week under $${p.usd} OnlyFans net`,
  },
  reel_over_usual: {
    every: 30, needs: ['times'], limits: { times: [1.5, 100] },
    label: (p) => `When a reel from ${who(p)} gets ${p.times}x her usual views or more`,
  },
  failed_downloads_above: {
    every: 30, needs: ['count'], limits: { count: [1, 10_000] },
    label: (p) => `When failed reel downloads go above ${p.count}`,
  },
}

export const KIND_NAMES = Object.keys(KINDS) as WatchKind[]

export function isKind(value: unknown): value is WatchKind {
  return typeof value === 'string' && Object.hasOwn(KINDS, value)
}

/** Checks a proposal from the model. Returns clean params or the reason it
 *  cannot be watched, worded for the assistant to pass on. */
export function readParams(kind: WatchKind, raw: Record<string, unknown>): WatchParams | { error: string } {
  const spec = KINDS[kind]
  const out: WatchParams = {}
  for (const key of spec.needs) {
    const n = Number(raw[key])
    const [min, max] = spec.limits[key] ?? [0, Number.MAX_SAFE_INTEGER]
    if (!Number.isFinite(n) || n < min || n > max) return { error: `${kind} needs ${key} between ${min} and ${max}.` }
    out[key] = key === 'times' ? Math.round(n * 10) / 10 : Math.round(n)
  }
  if (kind === 'failed_downloads_above' && raw.model) return { error: 'Failed downloads are counted for the whole library, not per model.' }
  return out
}

const NY = 'America/New_York'

/** Alerts wait overnight like the bot's others: 23:00-09:00 New York is held
 *  and goes out at 09:00. */
export function isQuietHour(now: number): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)))
  return hour >= 23 || hour < 9
}

export function due(lastChecked: number | null, kind: WatchKind, now: number): boolean {
  return lastChecked === null || now - lastChecked >= KINDS[kind].every * 60_000
}
