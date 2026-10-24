/**
 * Roster Health - the Red October desk.
 *
 * The bot computes the numbers (gosian-bot: src/roster-health.js) from its
 * Infloww transaction mirror and ships the whole board with its hourly
 * snapshot. This file is the other half: who may read it, how much of it a
 * question needs, and the instructions the model writes from.
 *
 * Two things are deliberate here.
 *
 * 1. The desk prompt travels with the data, not in the system prompt. It is
 *    ~90 lines that only matter when someone asks about the board, and the
 *    system prompt is cached in front of every question in OPS.
 *
 * 2. The board is Geno's DM by default. It carries agency-wide money and fan
 *    ids, which is the same reason /revenue in the bot answers nowhere else -
 *    and the assistant answers in a staff group that now includes the FansLink
 *    side of the merger. ROSTER_HEALTH_OPS=1 opens a fan-id-free version to
 *    that group when Geno wants it. With no owner chat id configured nobody
 *    gets it, because failing closed is the only safe default for a payload
 *    that names what individual fans spend.
 *
 *    The owner is read from GOSIAN_OWNER_CHAT_ID, or from OWNER_TELEGRAM_ID,
 *    which has been deployed here since the drafts lock needed it and holds
 *    the same number - a Telegram DM's chat id is the account's own id. The
 *    board was dormant for want of a second name for an id we already had.
 */

export const GUIDANCE = `You are the Roster Health desk for Gosian Media's OnlyFans chatting roster. You read one payload, roster_health, computed by the Gosian bot from the Infloww transaction mirror, and you tell the team what is happening across the roster and exactly what to do about it before the month closes.

THE GOAL
- The month is judged on one number: how many active creators finish it below their own previous month (red_at_month_end). The target is goal.target; a true 30% is goal.true_pct_target.
- Every answer starts from: red today, projected red at month end, the target, and the gap between the projection and the target. One line.

HARD RULES
1. Every number you write must be in the payload, or a simple difference, sum or percentage of numbers in it. Never estimate, never round up to sound better, never fill a gap. A missing field is reported as missing.
2. Each creator is compared only with her own previous month, never with another creator.
3. Net is the creator's net after OnlyFans' cut. Never call it Gosian's revenue or margin.
4. Say how fresh the data is (as_of). If as_of is more than 6 hours old, say that first - the mirror is filled by the bot's Infloww sync, so a stale as_of means the sync is not running.
5. Mention roster changes every time: active count, anyone gone from Infloww, anyone new. A creator who disappears is never reported as a revenue collapse; she is "gone from Infloww - reconnect or confirm she left". If roster.partial_sync is set, say the roster question is being withheld this pass.
6. Infloww shows purchases, not sends. When you call something a reach problem, say send volume still has to be confirmed in Infloww.
7. Internal only. Never draft anything for a creator or a fan from this data. Fan ids may appear in a chatter brief; fan display names and chatter notes never do (they are not in the payload - do not ask for them).
8. If a whale is pushing for off-platform payment or meeting up: stop and flag it to Geno. Never work around it.

HOW TO SORT THE ROSTER (creator.tier)
- hold: behind today but her own recent pace carries her past last month. Protect her. Do not move her chatter.
- push: needs up to 1.5x her best pace. These decide the goal; plays go here first.
- stretch: 1.5x-2x. A target only once the push list is covered.
- not_this_month: over 2x. Work her, but do not count her toward the goal. With 3+ dark days, ask whether to cover or park the account.
- at_risk (a flag, not a tier): up on the same days today but projected red at month end - a back-loaded previous month. Name these; mark them with * wherever you list them. They fall into the red in the second half without warning.

THE PLAYS, IN ORDER (match the play to the evidence on her card)
01 Win back idle spenders. Use her idle.top fan ids, one message each, referencing what they actually bought. Report since_last_read.idle_came_back against idle_handed_over to show whether the list is being worked.
02 Restore reach, then price. When ppv_buyers fell 20%+ and avg_ppv held or rose: one mass PPV at her sep_median_price to everyone who bought last month but not this one, then ladder up from whoever opens. Give the PPV sales a day she needs (needs_per_day / avg_ppv) against what she makes now.
03 Cover the hours that went quiet. agency.hour_blocks_red_accounts for the roster, creator.quiet_hours_et for her.
04 Re-open whales by hand. whales.silent and whales.cooled, one named chatter each. No mass send, no discount.
05 Reload the funnel. When new_subs fell 25%+ while renewals held. A promo job; it pays next month.
Plus: get the account covered (3+ dark days); rebuild the tip line (tips down 40%+ from $100+); reset the opening price (price up 15%+ and buyers down, but not a reach collapse).

OUTPUTS
A. MORNING BRIEF (the default; at most 12 lines, Telegram-safe, no tables, no markdown)
   Line 1: "Red: {red_today}/{active} today, {projected_red} projected for month end, goal {target}. Need {projected-target} more flips in {days_left} days."
   Line 2: agency pace against to_tie_sep_per_day, and the last-4-day trend.
   Line 3: roster changes, or "Roster unchanged: N active".
   Then the 3 push creators with the biggest dollar gap, one line each: name - needs $X/day, running $Y - the one play to run today.
   Then any hold creator whose last-4 pace fell below her needs, and any new at_risk creator.
   End: play 01 status (came_back / handed_over) in one line.
B. FLIP BOARD ("flip board", "who can we turn"): hold / push / stretch / not_this_month / at_risk, each with name, still to earn, needs per day, best pace and ratio. Then the arithmetic: projected red minus the push count = best case.
C. CREATOR BRIEF ("brief for <name>"): a plain-text chatter brief - header line with net against last month, needs per day against running, then 2-5 numbered plays with her own numbers and fan ids, written so a chatter can act without reading anything else.
D. WEEKLY READ (Mondays): what moved since the last read, which plays landed (came_back, buyers, hour blocks), who left or joined the red.

STYLE
Direct and short. Lead with the number that matters. No praise, no filler. When something did not work, say so plainly. Name the owner and the deadline for every action; an action that cannot name an owner, a deadline and the metric that proves it worked is dropped.`

export type Payload = {
  as_of: string
  window: { through: string; days_elapsed: number; days_left: number; month: string; prior_month: string }
  roster: { active: number; gone: unknown[]; new: unknown[]; partial_sync?: boolean }
  goal: Record<string, unknown>
  agency: Record<string, unknown>
  creators: Creator[]
}

export type Creator = {
  id: string; name: string; tier: string | null; at_risk: boolean
  oct_net: number; sep_same_days: number; sep_full: number
  pace: number; pace_last4: number; needs_per_day: number; ratio: number | null
  red_today: boolean; projected_red: boolean
  dark_days: string[]; still_falling: boolean
  idle: { fans: number; sep_value: number; top: Array<[string, number]> }
  whales: { silent: Array<[string, number]>; cooled: Array<[string, number, number]>; returned: Array<[string, number]> }
  [key: string]: unknown
}

export const STALE_HOURS = 6

export function isStale(asOf: string, now = Date.now()): boolean {
  const when = Date.parse(asOf)
  return !Number.isFinite(when) || now - when > STALE_HOURS * 3_600_000
}

/** The one-line summary every answer is supposed to open with, so the model
 *  cannot get it wrong even when it only asks for one creator. */
export function headline(p: Payload): string {
  const target = Number(p.goal.target)
  const projected = Number(p.agency.projected_red)
  const gap = projected - target
  return `Red: ${p.agency.red_today}/${p.roster.active} today, ${projected} projected at month end, goal ${target}.` +
    ` ${gap > 0 ? `${gap} more flip${gap === 1 ? '' : 's'} needed` : 'Goal met at this pace'} with ${p.window.days_left} day${p.window.days_left === 1 ? '' : 's'} left.`
}

const thin = (c: Creator) => ({
  name: c.name, tier: c.tier, at_risk: c.at_risk,
  oct_net: c.oct_net, sep_full: c.sep_full, still_to_earn: Math.max(c.sep_full - c.oct_net, 0),
  needs_per_day: c.needs_per_day, pace: c.pace, pace_last4: c.pace_last4, ratio: c.ratio,
  red_today: c.red_today, projected_red: c.projected_red,
  dark_days: c.dark_days.length, still_falling: c.still_falling,
})

/** Fan ids out, everything else kept - and said out loud, so the model
 *  reports a withheld list rather than an empty one. */
export function withoutFans(c: Creator): Creator {
  return {
    ...c,
    idle: { ...c.idle, top: [] },
    whales: { silent: [], cooled: [], returned: [] },
    fan_ids_withheld: true,
  }
}

export function matchCreator(creators: Creator[], name: string): Creator | null {
  const want = name.trim().toLowerCase()
  if (!want) return null
  return (
    creators.find((c) => c.name.toLowerCase() === want) ??
    creators.find((c) => c.name.toLowerCase().startsWith(want)) ??
    creators.find((c) => c.name.toLowerCase().includes(want)) ??
    null
  )
}

/** The slice a question needs: the board, one tier, or one creator. */
export function slice(p: Payload, input: { view?: string; tier?: string; creator?: string }, fans: boolean) {
  const creators = fans ? p.creators : p.creators.map(withoutFans)
  const head = {
    as_of: p.as_of,
    stale: isStale(p.as_of) ? `The mirror was last filled ${p.as_of}. Say so before anything else - the bot's Infloww sync is behind.` : undefined,
    window: p.window, roster: p.roster, goal: p.goal, headline: headline(p),
  }
  if (input.creator) {
    const found = matchCreator(creators, input.creator)
    if (!found) return { ...head, error: `No creator on the board matches "${input.creator}". Names: ${creators.map((c) => c.name).join(', ')}` }
    return { ...head, creator: found }
  }
  if (input.tier) {
    const tier = String(input.tier)
    const list = tier === 'at_risk' ? creators.filter((c) => c.at_risk) : creators.filter((c) => c.tier === tier)
    return { ...head, tier, creators: list }
  }
  // The board: the agency line, and a thin row for everyone who is in trouble.
  const trouble = creators.filter((c) => c.tier)
  return {
    ...head,
    agency: p.agency,
    counts: { hold: 0, push: 0, stretch: 0, not_this_month: 0, at_risk: creators.filter((c) => c.at_risk).length,
      ...trouble.reduce<Record<string, number>>((acc, c) => ({ ...acc, [String(c.tier)]: (acc[String(c.tier)] ?? 0) + 1 }), {}) },
    creators: trouble.map(thin).sort((a, b) => b.still_to_earn - a.still_to_earn),
    note: 'This is the board. Ask again with tier (hold/push/stretch/not_this_month/at_risk) or creator for the full cards, which carry the plays.',
  }
}

export type Audience = { fans: boolean } | { refusal: string }

/**
 * Who may read the board from the chat the question was asked in. Geno's DM
 * sees everything; the staff group sees it without fan ids, and only when
 * Geno has opened it. Anything unconfigured is a refusal, never a leak.
 *
 * GOSIAN_OWNER_CHAT_ID wins where both are set, so the board can be pointed
 * somewhere else without moving the lock that guards sending a draft.
 */
export function audienceFor(chatId: string, env: Record<string, string | undefined> = process.env): Audience {
  const owner = (env.GOSIAN_OWNER_CHAT_ID ?? env.OWNER_TELEGRAM_ID ?? '').trim()
  if (!owner) return { refusal: 'Roster Health is not available here: it prints agency-wide money and fan ids, so it answers in Geno\'s DM only, and neither GOSIAN_OWNER_CHAT_ID nor OWNER_TELEGRAM_ID is set on the transcriber.' }
  if (String(chatId) === owner) return { fans: true }
  if ((env.ROSTER_HEALTH_OPS ?? '') === '1') return { fans: false }
  return { refusal: 'Roster Health answers in Geno\'s DM only - it is agency-wide money and fan spend. Ask him, or he can open it to this group by setting ROSTER_HEALTH_OPS=1.' }
}
