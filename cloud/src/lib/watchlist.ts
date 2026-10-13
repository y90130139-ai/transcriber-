/**
 * The watchlist read, in one place (2026-10-13).
 *
 * The page used to fetch this only after hydration, so every visit opened on
 * empty placeholders and the real list arrived a round trip later. The
 * console renders pages on the server, so the same three queries now run
 * there and the first paint already carries the data — the route keeps
 * calling this for the panel's reloads after a mutation.
 */
import { q } from './db'

export type WatchlistSuggested = { handle: string; found_via: string | null; seen: number }
export type WatchlistWatched = { handle: string; access: string | null; updated_at: string | null }
export type WatchlistCounts = { watching: number; suggested: number; gated: number }

export type WatchlistData = {
  suggested: WatchlistSuggested[]
  watching: WatchlistWatched[]
  counts: WatchlistCounts
}

export async function loadWatchlist(): Promise<WatchlistData> {
  const [suggested, watching, counts] = await Promise.all([
    q<WatchlistSuggested>(
      `select c.handle, c.found_via,
              (select count(*)::int from transcriber.sightings s where s.handle = c.handle) as seen
         from transcriber.creators c
        where c.watch = 'suggested'
        order by c.updated_at desc
        limit 60`,
    ),
    // The watched side: what the sweep actually reads, newest first. Capped —
    // the counts row carries the real total.
    q<WatchlistWatched>(
      `select handle, access, updated_at
         from transcriber.creators
        where watch = 'watching'
        order by updated_at desc nulls last
        limit 300`,
    ),
    q<WatchlistCounts>(
      `select count(*) filter (where watch = 'watching')::int as watching,
              count(*) filter (where watch = 'suggested')::int as suggested,
              count(*) filter (where watch = 'watching' and access = 'gated')::int as gated
         from transcriber.creators`,
    ),
  ])
  return {
    suggested,
    watching,
    counts: counts[0] ?? { watching: 0, suggested: 0, gated: 0 },
  }
}
