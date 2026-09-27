/**
 * The OnlyFans numbers we keep, and what each one actually means.
 *
 * Every definition here is pinned to where the number comes from, because the
 * same word means different things on different screens: OnlyFans "Profile
 * visitors" is *hits*, not people, and includes logged-out guests; Infloww's
 * subscription CVR counts free-trial claims as subscribers; "renew on" is a
 * setting a fan has switched on, not a renewal that happened. Read
 * docs/NUMBERS.md before adding a metric.
 *
 * Pure: no database, no network. Tested in test/numbers.test.ts.
 */

/** Flows: summed across days. */
export const FLOW_METRICS = [
  'visitors', 'guests', 'users',
  'new_subs', 'renewals', 'spenders',
  'earn_total', 'earn_subs', 'earn_recurring', 'earn_tips', 'earn_messages',
  'earn_posts', 'earn_streams', 'earn_referrals', 'refunds',
] as const

/** Stocks: a level on a day. A period takes the last reading, never the sum. */
export const STOCK_METRICS = ['active_fans', 'renew_on', 'expired_change'] as const

export const DAY_METRICS = [...FLOW_METRICS, ...STOCK_METRICS] as const
export type FlowMetric = (typeof FLOW_METRICS)[number]
export type StockMetric = (typeof STOCK_METRICS)[number]
export type DayMetric = (typeof DAY_METRICS)[number]

/** One day for one creator. Missing means *not read*, never zero. */
export type Day = { day: string } & Partial<Record<DayMetric, number>>

export type MetricInfo = { label: string; money?: boolean; definition: string }

export const METRIC_INFO: Record<DayMetric, MetricInfo> = {
  visitors: { label: 'Profile visitors', definition: 'Hits on the profile page (OnlyFans Reach / Infloww). Not unique people. Includes logged-out guests.' },
  guests: { label: 'Guests', definition: 'Visitors not logged in to OnlyFans. They see name, avatar, banner, bio and price, not posts.' },
  users: { label: 'Users', definition: 'Visitors logged in to OnlyFans.' },
  new_subs: { label: 'New subscribers', definition: 'New subscriptions. In Infloww this includes free-trial claims.' },
  renewals: { label: 'Renewals', definition: 'Subscriptions that actually renewed (paid pages).' },
  spenders: { label: 'Spenders', definition: 'Fans who paid anything in the period (Infloww).' },
  earn_total: { label: 'Earnings', money: true, definition: 'Net earnings after refunds (Infloww default; OnlyFans Statements net).' },
  earn_subs: { label: 'New-sub earnings', money: true, definition: 'Subscription earnings from new subscribers.' },
  earn_recurring: { label: 'Recurring subs', money: true, definition: 'Subscription earnings from renewals.' },
  earn_tips: { label: 'Tips', money: true, definition: 'Tips.' },
  earn_messages: { label: 'Messages', money: true, definition: 'PPV and paid messages, mass and one-to-one.' },
  earn_posts: { label: 'Posts', money: true, definition: 'Paid posts.' },
  earn_streams: { label: 'Streams', money: true, definition: 'Live streams.' },
  earn_referrals: { label: 'Referrals', money: true, definition: 'Creator referral earnings (calculated in UTC).' },
  refunds: { label: 'Refunds', money: true, definition: 'Refunds and chargebacks.' },
  active_fans: { label: 'Active fans', definition: 'Fans subscribed at the day\'s snapshot (Infloww, once a day at UTC+0).' },
  renew_on: { label: 'Renew on', definition: 'Fans with auto-renew switched on. A setting, not a renewal.' },
  expired_change: { label: 'Expired change', definition: 'Change in expired-fan count vs the previous period (Infloww). Not true churn.' },
}

const isFlow = (key: DayMetric): key is FlowMetric => (FLOW_METRICS as readonly string[]).includes(key)

export type Totals = Partial<Record<DayMetric, number>> & { days: number; days_read: number }

/**
 * A period's totals. Flows are summed over the days that carry them; stocks
 * take the last reading in the period. `days_read` is how many days carried
 * any number at all — a total over 12 read days of a 30-day window is a
 * 12-day total, and the caller must say so.
 */
export function totals(days: readonly Day[], span?: number): Totals {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day))
  const out: Totals = { days: span ?? sorted.length, days_read: 0 }
  for (const row of sorted) {
    let any = false
    for (const key of DAY_METRICS) {
      const value = row[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      any = true
      out[key] = isFlow(key) ? (out[key] ?? 0) + value : value
    }
    if (any) out.days_read += 1
  }
  return out
}

/** a ÷ b, or null when either side is missing or b is zero. Never NaN, never ∞. */
export function ratio(a: number | undefined | null, b: number | undefined | null): number | null {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null
  return a / b
}

/**
 * The ratios the diagnosis reads. Every one names its denominator, because
 * the same word ("conversion", "rebill") circulates with three.
 */
export type Ratios = {
  /** new subs ÷ profile visitors. Diluted by guests and repeat hits. */
  visit_cvr: number | null
  /** guests ÷ visitors. */
  guest_share: number | null
  /** new subs ÷ logged-in users. An upper bound on profile conversion: a guest who signs up arrives as a sub, not a user. */
  user_cvr: number | null
  /** net earnings ÷ visitors. The agencies' north star. */
  rev_per_visit: number | null
  /** net earnings ÷ new subs. */
  rev_per_new_sub: number | null
  /** net earnings ÷ spenders (ARPPU). */
  rev_per_spender: number | null
  /** spenders ÷ active fans. */
  spender_share: number | null
  /** message earnings ÷ net earnings. */
  message_share: number | null
  /** subscription earnings (new + recurring) ÷ net earnings. */
  sub_share: number | null
  /** renew-on fans ÷ active fans (paid pages). */
  renew_on_share: number | null
  /** refunds ÷ (net + refunds). */
  refund_rate: number | null
  /** visitors per day read. */
  visits_per_day: number | null
  /** new subs per day read. */
  subs_per_day: number | null
}

export function ratios(t: Totals): Ratios {
  const subsEarn = t.earn_subs !== undefined || t.earn_recurring !== undefined
    ? (t.earn_subs ?? 0) + (t.earn_recurring ?? 0)
    : undefined
  return {
    visit_cvr: ratio(t.new_subs, t.visitors),
    guest_share: ratio(t.guests, t.visitors),
    user_cvr: ratio(t.new_subs, t.users),
    rev_per_visit: ratio(t.earn_total, t.visitors),
    rev_per_new_sub: ratio(t.earn_total, t.new_subs),
    rev_per_spender: ratio(t.earn_total, t.spenders),
    spender_share: ratio(t.spenders, t.active_fans),
    message_share: ratio(t.earn_messages, t.earn_total),
    sub_share: ratio(subsEarn, t.earn_total),
    renew_on_share: ratio(t.renew_on, t.active_fans),
    refund_rate: ratio(t.refunds, t.earn_total !== undefined && t.refunds !== undefined ? t.earn_total + t.refunds : undefined),
    visits_per_day: ratio(t.visitors, t.days_read),
    subs_per_day: ratio(t.new_subs, t.days_read),
  }
}

/** A tracking or trial link, as one snapshot of its running totals. */
export type Link = {
  name: string
  kind: 'tracking' | 'trial'
  /** Where it is placed: ig-bio, ig-story, reddit, tiktok, x, shoutout… */
  source?: string | null
  clicks?: number | null
  /** Subscribers (tracking) or claims (trial). */
  subs?: number | null
  earnings?: number | null
  spenders?: number | null
  cost?: number | null
}

export type LinkRatios = {
  click_cvr: number | null
  per_click: number | null
  per_sub: number | null
  spend_cvr: number | null
  roi: number | null
}

export function linkRatios(link: Link): LinkRatios {
  return {
    click_cvr: ratio(link.subs, link.clicks),
    per_click: ratio(link.earnings, link.clicks),
    per_sub: ratio(link.earnings, link.subs),
    spend_cvr: ratio(link.spenders, link.subs),
    roi: link.cost && link.cost > 0 && typeof link.earnings === 'number' ? (link.earnings - link.cost) / link.cost : null,
  }
}

/** Links grouped by where they are placed, so IG and Reddit can be compared. */
export function bySource(links: readonly Link[]): Link[] {
  const groups = new Map<string, Link>()
  for (const link of links) {
    const key = (link.source ?? 'untagged').toLowerCase()
    const prev = groups.get(key) ?? { name: key, kind: link.kind, source: key }
    const add = (a: number | null | undefined, b: number | null | undefined) =>
      typeof a === 'number' || typeof b === 'number' ? (a ?? 0) + (b ?? 0) : null
    groups.set(key, {
      ...prev,
      clicks: add(prev.clicks, link.clicks),
      subs: add(prev.subs, link.subs),
      earnings: add(prev.earnings, link.earnings),
      spenders: add(prev.spenders, link.spenders),
      cost: add(prev.cost, link.cost),
    })
  }
  return [...groups.values()]
}

/** The median of the numbers given, ignoring nulls. */
export function median(values: readonly (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (!nums.length) return null
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}
