/**
 * Trending Sounds — every music track the OFM Pro feeds carry.
 *
 * The worker lands each media row with the audio it was posted with; on
 * Instagram and TikTok that is either a track anyone can join or the
 * creator's own recording. The originals — Instagram's "Original audio"
 * bucket and TikTok's "original sound - <handle>" — are one person's audio,
 * not a sound to pick up, so they stay out and everything else is served.
 *
 * One sound can ride both platforms, so rows merge on the trimmed lowercase
 * title, and "now" is the last 7 days against the 7 before it: the feeds are
 * refreshed daily, so a week is the freshest slice that still has a before
 * to move against (Geno, 2026-10-18: "make sure we put all of them here").
 */
import { sql } from './db'
import type { Platform } from './socials'

export type TrendingSound = {
  /** As written on the most-viewed reel using it. */
  title: string
  /** The feeds it rides — a track on both reads as one row. */
  platforms: Platform[]
  medias: number
  creators_now: number
  creators_before: number
  top_plays: number | null
  example: string | null
}

/** The two generic labels and TikTok's per-creator pattern are not sounds;
 *  anything else — even a track whose title starts with "Original" — is. */
const MUSIC_ONLY = `audio is not null
          and platform in ('instagram', 'tiktok')
          and lower(trim(audio)) <> 'original audio'
          and lower(trim(audio)) <> 'original sound'
          and lower(trim(audio)) not like 'original sound - %'`

export async function trendingSounds(
  limit = 60,
  offset = 0,
): Promise<{ sounds: TrendingSound[]; total: number; rising: number }> {
  const [[totals], rows] = await Promise.all([
    sql.query(
      `select count(*)::int as total,
              count(*) filter (where creators_now > creators_before)::int as rising
         from (
           select count(distinct username) filter (where posted_at >= now() - interval '7 days') as creators_now,
                  count(distinct username) filter (where posted_at <  now() - interval '7 days'
                                                   and posted_at >= now() - interval '14 days') as creators_before
             from transcriber.ofmpro_media
            where ${MUSIC_ONLY}
            group by lower(trim(audio))
         ) x`,
    ),
    sql.query(
      `select (array_agg(audio order by view_count desc nulls last))[1] as title,
              array_agg(distinct platform) as platforms,
              count(*)::int as medias,
              count(distinct username) filter (where posted_at >= now() - interval '7 days')::int as creators_now,
              count(distinct username) filter (where posted_at <  now() - interval '7 days'
                                               and posted_at >= now() - interval '14 days')::int as creators_before,
              max(view_count) as top_plays,
              (array_agg(post_url order by view_count desc nulls last)
                 filter (where post_url is not null))[1] as example
         from transcriber.ofmpro_media
        where ${MUSIC_ONLY}
        group by lower(trim(audio))
        order by creators_now desc, medias desc, lower(trim(audio)) asc
        limit $1 offset $2`,
      [limit, offset],
    ),
  ])

  return {
    sounds: rows.map((row) => ({
      title: String(row.title),
      platforms: [...((row.platforms as Platform[] | null) ?? [])].sort(),
      medias: Number(row.medias ?? 0),
      creators_now: Number(row.creators_now ?? 0),
      creators_before: Number(row.creators_before ?? 0),
      top_plays: row.top_plays === null || row.top_plays === undefined ? null : Number(row.top_plays),
      example: row.example ? String(row.example) : null,
    })),
    total: Number(totals?.total ?? 0),
    rising: Number(totals?.rising ?? 0),
  }
}
