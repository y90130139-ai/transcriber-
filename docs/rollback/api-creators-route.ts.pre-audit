import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { COMMENT_WEIGHT, IN_HOT_WINDOW } from '@/lib/hot'

/** One row per creator: how much of them we hold, and how they normally do. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const creators = await sql.query(
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
  )

  // A face for each card, taken from that creator's most recent post.
  const covers = await sql.query(
    `select distinct on (author) author, job_id
       from transcriber.transcripts
      where author is not null and thumbnail is not null
      order by author, upload_date desc nulls last, transcribed_at desc`,
  )
  const coverOf = new Map(covers.map((row) => [row.author as string, row.job_id as string]))

  return NextResponse.json({
    creators: creators.map((creator) => ({
      ...creator,
      cover_id: coverOf.get(creator.handle as string) ?? null,
    })),
    windowNote: IN_HOT_WINDOW ? '90 days' : null,
  })
}
