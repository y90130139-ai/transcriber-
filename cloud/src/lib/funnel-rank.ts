/** The funnel's judgement, with no database attached.
 *
 *  Separated from `funnel.ts` because this is the part worth testing and the
 *  part worth arguing about: turning sixty rows of state into the four things
 *  actually worth doing. `funnel.ts` fetches; this decides. (It also has to
 *  live apart — `db.ts` throws at import time without DATABASE_URL, so a
 *  module that touches it cannot be unit tested.)
 */

export type State = 'green' | 'amber' | 'red' | 'unknown'

export type Reading = {
  handle: string
  state: State
  bio_url: string | null
  has_story: boolean | null
  highlights: number | null
  followers: number | null
  creator: string | null
  read_at: string
  /** The state at the previous reading, when there was one. */
  was: State | null
}

export type Money = {
  creator: string
  chat: boolean | null
  tier: string | null
  sep_full: number | null
  oct_net: number | null
  gap: number | null
  week_now: number | null
  week_peak: number | null
}

export type Action = {
  creator: string
  handles: string[]
  kind: 'lost' | 'dark' | 'unverified'
  /** Cents a week behind the ask, so the list ranks by what it is worth. */
  lostPerWeek: number
  followers: number
  owner: 'Iona' | 'her' | 'Patricia'
  tier: string | null
  why: string
}

export type Tally = {
  scanned: number
  green: number
  amber: number
  red: number
  unknown: number
  stories: number
  darkFollowers: number
  litFollowers: number
}

/** Who to take it to. A chat client runs her own marketing, so the only
 *  honest move is a question through Patricia — never an instruction, and
 *  never a message straight at her. */
function ownerFor(chat: boolean | null): Action['owner'] {
  return chat ? 'Patricia' : 'her'
}

/** Sixty rows of state, reduced to the handful worth doing something about.
 *
 *  Grouped by creator rather than by account: three dark handles belonging to
 *  one model is one conversation, and some handles are shared by two Infloww
 *  records besides. Ranked by money rather than audience, because a 500k
 *  account that earns nothing is not the first call of the morning.
 */
export function actions(readings: Reading[], money: Record<string, Money>): Action[] {
  const byCreator = new Map<string, { dark: string[]; vague: string[]; lost: string[]; followers: number }>()

  for (const r of readings) {
    if (!r.creator) continue
    // A live link is nothing to do, and an unread account is not a dark one:
    // "we could not read her bio" and "she has no link" are different
    // answers, and acting on the first asks a model about nothing.
    if (r.state === 'green' || r.state === 'unknown') continue

    const e = byCreator.get(r.creator) ?? { dark: [], vague: [], lost: [], followers: 0 }
    if (r.was === 'green') e.lost.push(r.handle)
    else if (r.state === 'red') e.dark.push(r.handle)
    else e.vague.push(r.handle)
    e.followers += r.followers ?? 0
    byCreator.set(r.creator, e)
  }

  const out: Action[] = []
  for (const [creator, e] of byCreator) {
    const m = money[creator]
    const lostPerWeek = Math.max(0, (m?.week_peak ?? 0) - (m?.week_now ?? 0))
    const handles = e.lost.length ? e.lost : e.dark.length ? e.dark : e.vague
    const kind: Action['kind'] = e.lost.length ? 'lost' : e.dark.length ? 'dark' : 'unverified'
    const why =
      kind === 'lost'
        ? 'Her link was there yesterday and is gone today'
        : kind === 'dark'
          ? 'No link in bio, no highlight, no story'
          : 'Something is there but nothing we recognise as a selling link'
    out.push({
      creator, handles, kind, lostPerWeek, followers: e.followers,
      owner: ownerFor(m?.chat ?? null), tier: m?.tier ?? null, why,
    })
  }

  // A link that vanished overnight outranks one dark for a month: it is still
  // fresh enough for her to remember doing it, which is what makes the ask
  // land. After that, money.
  const rank = { lost: 0, dark: 1, unverified: 2 }
  return out.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || b.lostPerWeek - a.lostPerWeek || b.followers - a.followers,
  )
}

/** The headline counts.
 *
 *  Counted per account, not per row: one Instagram can serve a FREE page and
 *  a VIP page, and counting it twice doubles the follower figure that the
 *  whole argument rests on.
 */
export function tally(readings: Reading[]): Tally {
  const seen = new Set<string>()
  const out: Tally = {
    scanned: 0, green: 0, amber: 0, red: 0, unknown: 0,
    stories: 0, darkFollowers: 0, litFollowers: 0,
  }
  for (const r of readings) {
    if (seen.has(r.handle)) continue
    seen.add(r.handle)
    out.scanned += 1
    out[r.state] += 1
    if (r.has_story) out.stories += 1
    if (r.state === 'red' || r.state === 'amber') out.darkFollowers += r.followers ?? 0
    if (r.state === 'green') out.litFollowers += r.followers ?? 0
  }
  return out
}
