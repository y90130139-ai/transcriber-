import { NextResponse } from 'next/server'
import { personaProposal } from '@/lib/autotag'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { COMMENT_WEIGHT, IN_HOT_WINDOW } from '@/lib/hot'
import { instagramAccounts, readSocials } from '@/lib/socials'

/** How many creators one sitting is. Ten covers most of the library by volume,
 *  and ten decisions is a coffee rather than an afternoon. */
const PROPOSE_DEFAULT = 10
const PROPOSE_MAX = 40

/** How many personas to put in front of a human for one creator. The tagger
 *  itself caps at two; this is a menu to pick from, not the tagger's answer. */
const PROPOSE_PER_CREATOR = 4

/**
 * Persona proposals, biggest shelves first.
 *
 * Not a bulk auto-tagger. It reads everything a creator has said and offers
 * what the lexicon makes of it, with the words that fired, for a human to
 * approve or correct one creator at a time. Nothing here writes anything —
 * approving is a PUT to /api/creators/[handle] with `apply`.
 */
async function propose(limit: number) {
  const creators = await sql.query(
    `select t.author as handle,
            count(*)::int as posts,
            coalesce(max(c.persona), '{}')::text[] as persona,
            count(*) filter (
              where exists (select 1 from transcriber.tags g
                             where g.job_id = t.job_id and g.axis = 'persona')
            )::int as tagged,
            string_agg(coalesce(t.plain, '') || ' ' || coalesce(t.caption, ''), ' ') as body
       from transcriber.transcripts t
       left join transcriber.creators c on c.handle = t.author
      where t.author is not null
      group by t.author
      order by count(*) desc, t.author
      limit $1`,
    [limit],
  )

  // The second leg: persona tags already sitting on their items. It matters
  // more than the lexicon does here, because most of this library is short and
  // half of it is barely spoken — a shelf of eighteen reels can total two
  // thousand characters, and a keyword table has almost nothing to bite on.
  // What is already tagged is real evidence and was going unused.
  const held = await sql.query(
    `select t.author as handle, g.tag,
            count(*)::int as on_posts,
            count(*) filter (where g.origin = 'human')::int as by_hand
       from transcriber.tags g
       join transcriber.transcripts t on t.job_id = g.job_id
      where g.axis = 'persona' and t.author = any($1::text[])
      group by t.author, g.tag
      order by count(*) desc`,
    [creators.map((creator) => String(creator.handle))],
  )

  const heldFor = new Map<string, { tag: string; onPosts: number; byHand: number }[]>()
  for (const row of held) {
    const list = heldFor.get(String(row.handle)) ?? []
    list.push({
      tag: String(row.tag),
      onPosts: Number(row.on_posts ?? 0),
      byHand: Number(row.by_hand ?? 0),
    })
    heldFor.set(String(row.handle), list)
  }

  // The body is only ever read here — it is the whole of a creator's shelf
  // glued together and has no business crossing the wire.
  return creators.map((creator) => {
    const handle = String(creator.handle)
    const words = personaProposal(String(creator.body ?? ''))
    const tags = heldFor.get(handle) ?? []

    // Both legs, merged, tag-evidence first — a persona already on twelve of
    // her posts is a stronger claim than two words in a transcript. Capped so
    // the row stays a decision rather than a menu.
    const merged = new Map<string, {
      tag: string; score: number; phrases: string[]; onPosts: number; byHand: number
    }>()
    for (const one of tags) {
      merged.set(one.tag, {
        tag: one.tag, score: 0, phrases: [], onPosts: one.onPosts, byHand: one.byHand,
      })
    }
    for (const one of words) {
      const existing = merged.get(one.tag)
      if (existing) { existing.score = one.score; existing.phrases = one.phrases; continue }
      merged.set(one.tag, { tag: one.tag, score: one.score, phrases: one.phrases, onPosts: 0, byHand: 0 })
    }

    return {
      handle,
      posts: Number(creator.posts ?? 0),
      tagged: Number(creator.tagged ?? 0),
      persona: (creator.persona as string[] | undefined) ?? [],
      proposed: [...merged.values()]
        .sort((a, b) => b.onPosts - a.onPosts || b.score - a.score)
        .slice(0, PROPOSE_PER_CREATOR),
    }
  })
}

/** One row per creator: how much of them we hold, and how they normally do. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // `?propose=` asks a different question — what persona does each creator's
  // own shelf suggest — and is answered on its own, the way /api/models?job=
  // is. Without it the response stays exactly what the grid already expects.
  const asked = new URL(request.url).searchParams.get('propose')
  if (asked !== null) {
    const wanted = Number(asked)
    const limit = Number.isFinite(wanted) && wanted > 0
      ? Math.min(Math.trunc(wanted), PROPOSE_MAX)
      : PROPOSE_DEFAULT
    return NextResponse.json({ proposals: await propose(limit) })
  }

  // Transcript authors, tracked watchlist accounts, and the Instagram accounts
  // on our active roster all belong in this index. Snapshot fields are the
  // daily cookie-based reads, not hand-entered profile guesses.
  const [authors, covers, watched, models, snapshots] = await Promise.all([
    sql.query(
      `with scored as (
         select t.author,
                t.job_id,
                t.upload_date,
                (coalesce(t.like_count,0) + ${COMMENT_WEIGHT} * coalesce(t.comment_count,0))::float as score
           from transcriber.transcripts t
          where t.author is not null
       )
       select s.author as handle,
              max(c.display_name) as display_name,
              coalesce(max(c.persona), '{}')::text[] as persona,
              count(*)::int as posts,
              count(*) filter (where s.upload_date >= to_char(now() - interval '90 days','YYYY-MM-DD'))::int as recent_posts,
              round(percentile_cont(0.5) within group (order by s.score)::numeric)::float as median_score,
              max(s.upload_date) as last_upload
         from scored s
         left join transcriber.creators c on c.handle = s.author
        group by s.author
       order by posts desc, last_upload desc nulls last`,
    ),
    // A face for each card, taken from that creator's most recent post.
    sql.query(
      `select distinct on (author) author, job_id
         from transcriber.transcripts
        where author is not null and thumbnail is not null
         order by author, upload_date desc nulls last, transcribed_at desc`,
    ),
    sql.query(
      `select handle, display_name, persona
         from transcriber.creators
        where watch = 'watching'`,
    ),
    sql.query(
      `select name, handle, socials
         from transcriber.models
        where status = 'active'`,
    ),
    sql.query(
      `select distinct on (lower(handle)) lower(handle) as handle, followers, seen_at
         from transcriber.creator_snapshots
        where followers is not null
        order by lower(handle), seen_at desc`,
    ),
  ])

  const tracked = new Set<string>()
  const profileByHandle = new Map<string, { display_name: string | null; persona: string[] }>()
  for (const row of watched) {
    const handle = String(row.handle ?? '').replace(/^@+/, '').toLowerCase()
    if (!handle) continue
    tracked.add(handle)
    profileByHandle.set(handle, {
      display_name: row.display_name ? String(row.display_name) : null,
      persona: (row.persona as string[] | null) ?? [],
    })
  }

  const modelNameByHandle = new Map<string, string>()
  for (const row of models) {
    const name = String(row.name ?? '')
    for (const handle of instagramAccounts(row.handle ? String(row.handle) : null, readSocials(row.socials))) {
      tracked.add(handle)
      if (name) modelNameByHandle.set(handle, name)
    }
  }

  const latestByHandle = new Map<string, { followers: number; seen_at: string }>()
  for (const row of snapshots) {
    const handle = String(row.handle ?? '').toLowerCase()
    if (!handle) continue
    tracked.add(handle)
    latestByHandle.set(handle, {
      followers: Number(row.followers),
      seen_at: String(row.seen_at),
    })
  }

  const rowsByHandle = new Map<string, Record<string, unknown>>()
  for (const row of authors) {
    const handle = String(row.handle ?? '').replace(/^@+/, '').toLowerCase()
    if (!handle) continue
    const snapshot = latestByHandle.get(handle)
    const profile = profileByHandle.get(handle)
    rowsByHandle.set(handle, {
      ...row,
      handle,
      display_name: row.display_name ? String(row.display_name) : profile?.display_name ?? modelNameByHandle.get(handle) ?? null,
      persona: (row.persona as string[] | null) ?? profile?.persona ?? [],
      tracked: tracked.has(handle),
      followers: snapshot?.followers ?? null,
      follower_checked_at: snapshot?.seen_at ?? null,
    })
  }
  for (const handle of tracked) {
    if (rowsByHandle.has(handle)) continue
    const profile = profileByHandle.get(handle)
    const snapshot = latestByHandle.get(handle)
    rowsByHandle.set(handle, {
      handle,
      display_name: profile?.display_name ?? modelNameByHandle.get(handle) ?? null,
      persona: profile?.persona ?? [],
      posts: 0,
      recent_posts: 0,
      median_score: null,
      last_upload: null,
      tracked: true,
      followers: snapshot?.followers ?? null,
      follower_checked_at: snapshot?.seen_at ?? null,
    })
  }

  const coverOf = new Map(covers.map((row) => [String(row.author).toLowerCase(), row.job_id as string]))
  const creators = [...rowsByHandle.values()].sort((a, b) =>
    Number(b.posts ?? 0) - Number(a.posts ?? 0) ||
    String(b.last_upload ?? '').localeCompare(String(a.last_upload ?? '')) ||
    String(a.handle).localeCompare(String(b.handle)),
  )

  return NextResponse.json({
    creators: creators.map((creator) => ({
      ...creator,
      cover_id: coverOf.get(String(creator.handle).toLowerCase()) ?? null,
    })),
    windowNote: IN_HOT_WINDOW ? '90 days' : null,
  })
}
