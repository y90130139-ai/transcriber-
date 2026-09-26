/**
 * Niche strength — does a niche carry winners right now, in what we watch?
 *
 * The one gate of the T0 "Niche Validation" proposal (2026-09-25) that this
 * system can answer honestly from its own data: T0 asks a model to search the
 * web for creators winning in a niche and warns, as its biggest failure mode,
 * that the model will invent them. Every handle here was actually swept, and
 * every multiple is that creator's own plays over their own median.
 *
 * **Information, not a verdict** — Geno's call. The count measures our
 * watchlist as much as the niche: golf showed 3 winners because few golf
 * creators are watched, not because golf is dead. So each niche carries how
 * many of its creators we watch at all, and the words below say "in what we
 * watch", never "the niche fails".
 */
import { sql } from './db'
import { labelOf } from './taxonomy'

/** A reel counts as a win at this multiple of its creator's own median plays —
 *  the library's "blowing up" line, not the 10x "winner" of her own bank. */
export const WIN_MULTIPLE = 5
/** T0's recency rule: a niche that won two years ago and is flat now is not
 *  a niche that carries. */
export const RECENT_DAYS = 90
/** T0's bands, kept as T0 wrote them so the words mean the same thing: 6+
 *  creators winning is a niche that carries, 3-5 is thin. */
export const CARRIES_AT = 6
export const THIN_AT = 3
const TOP_HANDLES = 4
const STRONGEST_SHOWN = 5

export type NicheCreator = { handle: string; multiple: number; posted_at: string }

export type Niche = {
  topic: string
  label: string
  /** Distinct creators with a reel ≥ WIN_MULTIPLE× their median, last RECENT_DAYS. */
  winning: number
  /** Distinct creators we have any reel of in this niche — the coverage behind the count. */
  watched: number
  band: 'carries' | 'thin' | 'few'
  latest: string | null
  top: NicheCreator[]
}

export type NicheStrength = {
  /** Her own niches, as matching reads them. Empty when her reels are all
   *  relatable or untagged. */
  hers: Niche[]
  /** The strongest niches across everything watched — for a model with no
   *  niche of her own yet, the candidates worth a look. */
  strongest: Niche[]
}

function band(winning: number): Niche['band'] {
  return winning >= CARRIES_AT ? 'carries' : winning >= THIN_AT ? 'thin' : 'few'
}

/**
 * Every niche's strength in one pass. `exclude` is her own handles: her reels
 * are evidence about her, not about whether the niche carries.
 */
async function allNiches(exclude: string[]): Promise<Map<string, Niche>> {
  const rows = await sql.query(
    `with med as (
       select handle, percentile_cont(0.5) within group (order by plays) as m
         from transcriber.sightings
        where plays is not null and not pinned and posted_at >= now() - interval '120 days'
        group by handle
     ),
     tagged as (
       select s.handle, s.plays, s.posted_at, med.m, g.tag as topic
         from transcriber.sightings s
         join transcriber.tags g on g.job_id = s.job_id and g.axis = 'topic'
         left join med on med.handle = s.handle
        where g.tag not in ('relatable', 'unknown')
          and not (s.handle = any($1::text[]))
     )
     select topic, handle,
            max(plays / nullif(m, 0)) filter (
              where posted_at >= now() - interval '${RECENT_DAYS} days' and plays >= ${WIN_MULTIPLE} * m
            ) as best,
            max(posted_at) filter (
              where posted_at >= now() - interval '${RECENT_DAYS} days' and plays >= ${WIN_MULTIPLE} * m
            ) as latest
       from tagged
      group by topic, handle`,
    [exclude],
  )
  const niches = new Map<string, Niche>()
  for (const row of rows) {
    const topic = String(row.topic)
    const niche = niches.get(topic) ?? {
      topic, label: labelOf('topic', topic), winning: 0, watched: 0, band: 'few', latest: null, top: [],
    }
    niche.watched += 1
    if (row.best !== null && row.best !== undefined) {
      niche.winning += 1
      const posted = new Date(row.latest as string).toISOString()
      niche.top.push({ handle: String(row.handle), multiple: Math.round(Number(row.best) * 10) / 10, posted_at: posted })
      if (!niche.latest || posted > niche.latest) niche.latest = posted
    }
    niches.set(topic, niche)
  }
  for (const niche of niches.values()) {
    niche.band = band(niche.winning)
    niche.top = niche.top.sort((a, b) => b.multiple - a.multiple).slice(0, TOP_HANDLES)
  }
  return niches
}

export async function nicheStrength(topics: string[], ownHandles: string[]): Promise<NicheStrength> {
  const all = await allNiches(ownHandles.map((h) => h.toLowerCase()))
  const hers = topics.map((topic) => all.get(topic) ?? {
    topic, label: labelOf('topic', topic), winning: 0, watched: 0, band: 'few' as const, latest: null, top: [],
  })
  const strongest = [...all.values()]
    .filter((niche) => niche.winning > 0 && !topics.includes(niche.topic))
    .sort((a, b) => b.winning - a.winning || b.watched - a.watched)
    .slice(0, STRONGEST_SHOWN)
  return { hers, strongest }
}
