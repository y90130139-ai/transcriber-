/**
 * Why the numbers are what they are — the decision tree in docs/NUMBERS.md,
 * as code.
 *
 * The published benchmarks in this vertical are nearly all agency SEO copy
 * (the same "visit→sub" rate circulates as 1–3% and as 5–15%), so nothing
 * here judges a number against an industry figure. A number is judged against
 * two things only: the same creator's previous period, and the median of our
 * own roster. With neither, a finding says what the number is and marks
 * itself `info` — it does not pretend to know whether that is good.
 *
 * Pure. Tested in test/numbers.test.ts.
 */
import { bySource, linkRatios, median, ratio, ratios, type Day, type Link, type Ratios, type Totals } from './metrics'

export type Status = 'good' | 'watch' | 'problem' | 'info' | 'unknown'

export type Finding = {
  key: string
  /** Order in the tree: 0 data, 1 guests, 2 link path, 3 profile/offer, 4 traffic quality, 5 money, 6 retention. */
  step: number
  status: Status
  title: string
  detail: string
  /** What to do about it, when there is something to do. */
  lever?: string
}

export type PageType = 'free' | 'paid' | null

export type DiagnoseInput = {
  totals: Totals
  previous?: Totals | null
  /** Roster medians for the same window. */
  baseline?: Partial<Ratios> | null
  /** Link snapshots covering the same window. */
  links?: readonly Link[]
  days?: readonly Day[]
  page?: PageType
}

/** A move this size against the last period is a finding, not noise. */
export const DROP = -0.25
export const RISE = 0.1
/** Against the roster median. */
export const BEHIND = 0.6
export const AHEAD = 1.1
/** Guests as a share of visits, past which the headline rate is mostly login wall. */
export const GUEST_HEAVY = 0.6
export const GUEST_WATCH = 0.4
/** Tracked subs ÷ new subs below this and attribution cannot carry a diagnosis. */
export const TRACKED_MIN = 0.7
/** A source converting this many times worse than the best one is its own problem. */
export const SOURCE_GAP = 3
/** Clicks a link needs before its conversion rate means anything. */
export const MIN_CLICKS = 100
/** A day this many times the period's median visits is a spike. */
export const SPIKE_X = 2

const IN_APP = /\b(ig|insta|instagram|tiktok|tt|threads|fb|facebook)\b/i

export const pct = (v: number | null | undefined, digits = 1) =>
  typeof v === 'number' ? `${(v * 100).toFixed(digits)}%` : '—'
export const num = (v: number | null | undefined) =>
  typeof v === 'number' ? Math.round(v).toLocaleString('en-US') : '—'
export const money = (v: number | null | undefined) =>
  typeof v === 'number' ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'

/** Current against last period and against the roster. */
export function compare(current: number | null, prev: number | null | undefined, base: number | null | undefined) {
  const vsPrev = current !== null && typeof prev === 'number' && prev > 0 ? current / prev - 1 : null
  const vsBase = current !== null && typeof base === 'number' && base > 0 ? current / base : null
  let status: Status = current === null ? 'unknown' : 'info'
  if (current !== null && (vsPrev !== null || vsBase !== null)) {
    if ((vsPrev !== null && vsPrev <= DROP) || (vsBase !== null && vsBase <= BEHIND)) status = 'problem'
    else if ((vsPrev !== null && vsPrev >= RISE) || (vsBase !== null && vsBase >= AHEAD)) status = 'good'
    else status = 'watch'
  }
  const parts: string[] = []
  if (vsPrev !== null) parts.push(`${vsPrev >= 0 ? '+' : ''}${(vsPrev * 100).toFixed(0)}% vs last period`)
  if (vsBase !== null) parts.push(`${vsBase.toFixed(2)}× the roster median`)
  return { status, vsPrev, vsBase, note: parts.length ? parts.join(', ') : 'no baseline yet — nothing to judge it against' }
}

/** The one-paragraph answer to "44,000 visits, 800 subs — why?" */
export function funnelStory(t: Totals): string {
  const r = ratios(t)
  if (t.visitors === undefined || t.new_subs === undefined) return 'Profile visitors and new subscribers are both needed to read the funnel.'
  const lines = [`${num(t.visitors)} profile visits became ${num(t.new_subs)} new subscribers — ${pct(r.visit_cvr, 2)} of visits.`]
  if (t.guests !== undefined && t.users !== undefined) {
    lines.push(
      `${num(t.guests)} of those visits (${pct(r.guest_share, 0)}) were logged-out guests, who see only the name, photo, bio and price, and must sign up before they can subscribe.`,
      `Measured against the ${num(t.users)} logged-in visits, the page converted ${pct(r.user_cvr, 1)} — the upper bound on how well the profile itself sells.`,
    )
  } else {
    lines.push('The guest / user split was not read, so the login wall cannot be separated from the profile. Screenshot Statistics → Reach with Guests and Users showing.')
  }
  lines.push('Visits are hits, not people: one fan opening the page three times counts three.')
  return lines.join(' ')
}

function dataFindings(input: DiagnoseInput): Finding[] {
  const t = input.totals
  const out: Finding[] = []
  if (t.visitors === undefined || t.new_subs === undefined) {
    out.push({ key: 'data.missing', step: 0, status: 'unknown', title: 'Not enough read to diagnose',
      detail: 'Profile visitors and new subscribers are the two numbers everything else hangs off. Neither can be skipped.',
      lever: 'Add the Reach screenshot (visitors, guests, users, new subscribers) or an Infloww Creator Report export.' })
  }
  if (t.days && t.days_read < t.days * 0.8) {
    out.push({ key: 'data.coverage', step: 0, status: 'watch', title: `Only ${t.days_read} of ${t.days} days read`,
      detail: 'Totals cover the days that carry numbers. Comparisons with a fully read period will be off by the missing days.' })
  }
  const tracked = (input.links ?? []).reduce((sum, l) => sum + (l.subs ?? 0), 0)
  if (input.links?.length && t.new_subs) {
    const share = tracked / t.new_subs
    if (share < TRACKED_MIN) {
      out.push({ key: 'data.attribution', step: 0, status: 'problem', title: `Only ${pct(share, 0)} of new subs came through a tracking link`,
        detail: `${num(tracked)} of ${num(t.new_subs)} new subscribers are attributed. The rest arrived by a link nobody can trace, so no source comparison is trustworthy.`,
        lever: 'Give every placement its own tracking link — IG bio, each story link, each subreddit, each shoutout — and never paste the bare onlyfans.com URL.' })
    } else if (share > 1.3) {
      out.push({ key: 'data.attribution', step: 0, status: 'watch', title: 'Link totals cover a different window',
        detail: `Links show ${num(tracked)} subs against ${num(t.new_subs)} new subscribers. Infloww filters links by the date each link was created, not by when fans subscribed — screenshot links at the same range as Reach.` })
    } else {
      out.push({ key: 'data.attribution', step: 0, status: 'good', title: `${pct(share, 0)} of new subs are attributed`, detail: 'Enough to compare sources.' })
    }
  }
  return out
}

function guestFinding(t: Totals): Finding | null {
  const share = ratios(t).guest_share
  if (share === null) return null
  const status: Status = share >= GUEST_HEAVY ? 'problem' : share >= GUEST_WATCH ? 'watch' : 'good'
  return {
    key: 'guests', step: 1, status,
    title: `${pct(share, 0)} of visits were logged-out guests`,
    detail: status === 'good'
      ? 'Most visitors arrive logged in, so the headline conversion rate is mostly about the page itself.'
      : 'Instagram and TikTok open links in their own browser, which does not share the fan\'s OnlyFans login — so a paying fan arrives as a stranger facing a sign-up wall, and "Sign in with Google" is blocked inside those browsers. Guests also cannot see posts, so no profile change reaches them.',
    lever: status === 'good' ? undefined
      : 'Test the link path, not the bio: run a deep-link / open-in-browser version of the bio link against the plain one, each with its own tracking link, alternating weeks.',
  }
}

function sourceFindings(links: readonly Link[]): Finding[] {
  const sources = bySource(links.filter((l) => l.kind === 'tracking'))
    .map((s) => ({ ...s, cvr: linkRatios(s).click_cvr, perClick: linkRatios(s).per_click }))
    .filter((s) => (s.clicks ?? 0) >= MIN_CLICKS && s.cvr !== null)
  if (sources.length < 2) return []
  const sorted = [...sources].sort((a, b) => (b.cvr ?? 0) - (a.cvr ?? 0))
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  if (!best.cvr || !worst.cvr || best.cvr / worst.cvr < SOURCE_GAP) {
    return [{ key: 'sources', step: 2, status: 'good', title: 'Sources convert within 3× of each other',
      detail: sorted.map((s) => `${s.source} ${pct(s.cvr, 1)}`).join(' · ') }]
  }
  const inApp = IN_APP.test(worst.source ?? '') && !IN_APP.test(best.source ?? '')
  return [{
    key: 'sources', step: 2, status: 'problem',
    title: `${worst.source} converts ${(best.cvr / worst.cvr).toFixed(1)}× worse than ${best.source}`,
    detail: `${sorted.map((s) => `${s.source}: ${num(s.clicks)} clicks → ${num(s.subs)} subs (${pct(s.cvr, 1)}${s.perClick !== null ? `, ${money(s.perClick)}/click` : ''})`).join(' · ')}.`
      + (inApp ? ' The weak source opens in an in-app browser and the strong one does not — that pattern is the login wall, not the audience.' : ''),
    lever: inApp
      ? `Route ${worst.source} through an open-in-external-browser link and compare it on its own tracking link.`
      : `Judge ${worst.source} on earnings per click, not conversion: a source can convert worse and still pay better.`,
  }]
}

function profileFinding(input: DiagnoseInput): Finding | null {
  const now = ratios(input.totals)
  if (now.visit_cvr === null) return null
  const before = input.previous ? ratios(input.previous) : null
  const c = compare(now.visit_cvr, before?.visit_cvr, input.baseline?.visit_cvr)
  const user = now.user_cvr !== null ? compare(now.user_cvr, before?.user_cvr, input.baseline?.user_cvr) : null
  const guestsHeavy = (now.guest_share ?? 0) >= GUEST_HEAVY
  const profileIsFine = user !== null && (user.status === 'good' || user.status === 'watch')
  let lever: string | undefined
  if (c.status === 'problem' || user?.status === 'problem') {
    if (guestsHeavy && profileIsFine) lever = 'Logged-in visitors still convert — the drop is the login wall. Fix the link path before touching the page.'
    else if (input.page === 'paid') lever = 'Logged-in visitors are not buying the offer: test a 7-day free-trial link or a first-month discount against the full price, one change at a time, same traffic.'
    else lever = 'Logged-in visitors are not subscribing to a free page, so it is the page: avatar, banner, name, the bio\'s first line and the pinned post. Change one element a week.'
  }
  return {
    key: 'conversion', step: 3, status: user?.status === 'problem' ? 'problem' : c.status,
    title: `${pct(now.visit_cvr, 2)} of visits subscribed${now.user_cvr !== null ? ` · ${pct(now.user_cvr, 1)} of logged-in visits` : ''}`,
    detail: `Visit conversion: ${c.note}.${user ? ` Logged-in conversion: ${user.note}.` : ''}`,
    lever,
  }
}

/** Spike days: visits ≥ 2× the period median. Do they convert like other days? */
export function trafficQuality(days: readonly Day[]): Finding | null {
  const read = days.filter((d) => typeof d.visitors === 'number' && typeof d.new_subs === 'number')
  if (read.length < 7) return null
  const mid = median(read.map((d) => d.visitors))
  if (!mid) return null
  const spikes = read.filter((d) => (d.visitors ?? 0) >= SPIKE_X * mid)
  const calm = read.filter((d) => (d.visitors ?? 0) < SPIKE_X * mid)
  if (!spikes.length || !calm.length) return null
  const cvr = (list: Day[]) => ratio(list.reduce((s, d) => s + (d.new_subs ?? 0), 0), list.reduce((s, d) => s + (d.visitors ?? 0), 0))
  const spikeCvr = cvr(spikes)
  const calmCvr = cvr(calm)
  if (spikeCvr === null || calmCvr === null) return null
  const low = spikeCvr < calmCvr * 0.5
  return {
    key: 'traffic', step: 4, status: low ? 'watch' : 'good',
    title: `${spikes.length} spike day${spikes.length === 1 ? '' : 's'} converted ${pct(spikeCvr, 2)} vs ${pct(calmCvr, 2)} on other days`,
    detail: low
      ? `Spike days (${spikes.map((d) => d.day.slice(5)).join(', ')}) brought visits that mostly did not subscribe — the signature of a reel reaching people outside her audience. The rate falls while the count rises; that is expected, not broken.`
      : 'Spike traffic converted about as well as ordinary days — the extra reach was the right audience.',
    lever: low ? 'Judge spike days on subs and earnings gained, not on conversion rate. Check which reel ran the day before — see the spikes panel.' : undefined,
  }
}

function moneyFindings(input: DiagnoseInput): Finding[] {
  const now = ratios(input.totals)
  const before = input.previous ? ratios(input.previous) : null
  const out: Finding[] = []
  if (now.rev_per_visit !== null) {
    const c = compare(now.rev_per_visit, before?.rev_per_visit, input.baseline?.rev_per_visit)
    out.push({ key: 'money.per_visit', step: 5, status: c.status, title: `${money(now.rev_per_visit)} earned per profile visit`,
      detail: `The one number that holds traffic, conversion and selling together. ${c.note}.` })
  }
  if (now.rev_per_new_sub !== null) {
    const c = compare(now.rev_per_new_sub, before?.rev_per_new_sub, input.baseline?.rev_per_new_sub)
    out.push({ key: 'money.per_sub', step: 5, status: c.status, title: `${money(now.rev_per_new_sub)} earned per new subscriber`,
      detail: `${c.note}. Most payments land within 48 hours of subscribing, so the welcome message and first PPV decide this.`,
      lever: c.status === 'problem' ? 'Check the first 48 hours: is the welcome sequence firing, how fast do chatters reply, when does the first PPV go out? Compare cohorts in Infloww Fan Reports.' : undefined })
  }
  if (now.spender_share !== null) {
    const c = compare(now.spender_share, before?.spender_share, input.baseline?.spender_share)
    out.push({ key: 'money.spenders', step: 5, status: c.status, title: `${pct(now.spender_share, 1)} of active fans spent`,
      detail: `${c.note}.`, lever: c.status === 'problem' ? 'Few fans are buying at all — look at mass-message cadence and price points before chatter scripts.' : undefined })
  }
  if (now.message_share !== null && input.page === 'free' && now.message_share < 0.5) {
    out.push({ key: 'money.mix', step: 5, status: 'watch', title: `Messages are only ${pct(now.message_share, 0)} of earnings on a free page`,
      detail: 'A free page earns through messages; if they are not most of it, PPV and chatting are underused.' })
  }
  return out
}

function retentionFindings(input: DiagnoseInput): Finding[] {
  if (input.page !== 'paid') return []
  const now = ratios(input.totals)
  if (now.renew_on_share === null) return []
  const before = input.previous ? ratios(input.previous) : null
  const c = compare(now.renew_on_share, before?.renew_on_share, input.baseline?.renew_on_share)
  return [{ key: 'retention', step: 6, status: c.status, title: `${pct(now.renew_on_share, 0)} of active fans have renew on`,
    detail: `${c.note}. Renew-on is a setting; actual renewals are the Renewals line. Trial and discount cohorts renew less — judge them apart.`,
    lever: c.status === 'problem' ? 'Run the expiry reminder and a renew-on incentive; split renewals by the link each fan came through.' : undefined }]
}

/** Every finding, in tree order, problems first within a step. */
export function diagnose(input: DiagnoseInput): Finding[] {
  const weight: Record<Status, number> = { problem: 0, watch: 1, unknown: 2, info: 3, good: 4 }
  const all = [
    ...dataFindings(input),
    guestFinding(input.totals),
    ...sourceFindings(input.links ?? []),
    profileFinding(input),
    input.days ? trafficQuality(input.days) : null,
    ...moneyFindings(input),
    ...retentionFindings(input),
  ].filter((f): f is Finding => f !== null)
  return all.sort((a, b) => a.step - b.step || weight[a.status] - weight[b.status])
}
