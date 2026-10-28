import { q } from './db'
import { actions, tally, type Money, type Reading, type State, type Action, type Tally } from './funnel-rank'

/** Reading the funnel out of the database.
 *
 *  The judgement lives in `funnel-rank.ts`; this is only the fetch. The two
 *  are apart so the part that decides what Geno does in the morning can be
 *  tested without a database behind it.
 */

export type { Action, Money, Reading, State, Tally }

export type FunnelView = {
  day: string | null
  readings: Reading[]
  money: Record<string, Money>
  actions: Action[]
  tally: Tally
}

const num = (v: unknown) => (v == null ? null : Number(v))

const EMPTY: FunnelView = {
  day: null, readings: [], money: {}, actions: [],
  tally: { scanned: 0, green: 0, amber: 0, red: 0, unknown: 0, stories: 0, darkFollowers: 0, litFollowers: 0 },
}

/** The most recent day with a reading, and the day before it. */
async function days(): Promise<{ latest: string | null; previous: string | null }> {
  const rows = await q<{ read_on: string }>(
    `select distinct read_on::text as read_on
       from transcriber.funnel_readings
      order by read_on desc
      limit 2`,
  )
  return { latest: rows[0]?.read_on ?? null, previous: rows[1]?.read_on ?? null }
}

export async function loadFunnel(): Promise<FunnelView> {
  const { latest, previous } = await days()
  if (!latest) return EMPTY

  const rows = await q<Reading>(
    `select r.handle, r.state, r.bio_url, r.has_story, r.highlights,
            r.followers, r.creator, r.places, r.read_at::text as read_at,
            p.state as was
       from transcriber.funnel_readings r
       left join transcriber.funnel_readings p
              on p.handle = r.handle and p.read_on = $2::date
      where r.read_on = $1::date
      order by r.followers desc nulls last`,
    [latest, previous],
  )
  const readings: Reading[] = rows.map((r) => ({
    ...r,
    followers: num(r.followers),
    highlights: num(r.highlights),
  }))

  // Whatever the latest money push holds, which may be a day behind the
  // reading if the Infloww sync could not run. Shown as it is rather than
  // blanked: a slightly old dollar figure still ranks the list correctly.
  const moneyRows = await q<Money>(
    `select creator, chat, tier, sep_full, oct_net, gap, week_now, week_peak
       from transcriber.roster_money
      where read_on = (select max(read_on) from transcriber.roster_money)`,
  )
  const money: Record<string, Money> = {}
  for (const m of moneyRows) {
    money[m.creator] = {
      ...m,
      sep_full: num(m.sep_full), oct_net: num(m.oct_net), gap: num(m.gap),
      week_now: num(m.week_now), week_peak: num(m.week_peak),
    }
  }

  return { day: latest, readings, money, actions: actions(readings, money), tally: tally(readings) }
}
