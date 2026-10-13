import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { findGerman } from '@/lib/german'
import { extractLinks, labelFor } from '@/lib/links'
import { appendItems } from '@/lib/models'
import { isValidTag } from '@/lib/taxonomy'

export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const payload = await request.json().catch(() => ({}))
  const text = typeof payload.text === 'string' ? payload.text : ''
  // Metadata only, for a model's own posts: they are ingested for a date and a
  // link, and whisper on forty of her reels buys nothing anyone will read.
  // Anything that does not ask still gets the pass, exactly as before.
  const transcribe = payload.transcribe !== false
  const links = extractLinks(text)
  if (links.length === 0) {
    return NextResponse.json(
      { error: 'No supported links in that paste.' },
      { status: 400 },
    )
  }

  // The three-column composer (Geno, 2026-10-08): everything in one paste can
  // arrive already identified — a format (taxonomy or the team's own), the
  // German playbook entry when the format is German, or a free name. The
  // label says what it is; the tag makes it filterable like anything else.
  const askedFormat = typeof payload.format === 'string' ? payload.format : ''
  const format = askedFormat && (
    isValidTag('format', askedFormat) ||
    (await sql.query(`select 1 from transcriber.custom_formats where id = $1`, [askedFormat])).length > 0
  ) ? askedFormat : null
  const german = format === 'german' && typeof payload.variant === 'string'
    ? findGerman(payload.variant) ?? null
    : null
  const givenName = typeof payload.name === 'string' ? payload.name.trim().slice(0, 120) : ''
  const label = (link: string) =>
    german ? `German #${german.no} · ${german.name}` : givenName || labelFor(link)

  const batchId = nanoid(10)
  // A link already in the library is skipped rather than re-transcribed, which
  // is what makes pasting an ever-growing list of saved posts cheap to re-run.
  // Everything gets a speech pass: it costs about a second against a fetch of
  // tens, so the Talking / No speech label comes from listening, not from a box.
  const rows = await sql.query(
    `insert into transcriber.jobs (id, kind, source, source_key, label, batch_id, transcribe)
     select * from unnest(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::boolean[]
     )
     on conflict (source_key) do nothing
     returning id, label, source, status, transcribe, created_at`,
    [
      links.map(() => nanoid(12)),
      links.map(() => 'link'),
      links,
      links,
      links.map(label),
      links.map(() => batchId),
      links.map(() => transcribe),
    ],
  )

  // Every link's job id — the ones this paste created and the ones already
  // held — so the Add content composer can pin a pasted reference onto the
  // cards it lands in the same breath (Geno, 2026-10-13). The old contract
  // (added / skipped) is untouched; this is additive.
  const heldIds = await sql.query(
    `select id, source_key from transcriber.jobs where source_key = any($1::text[])`,
    [links],
  )
  const idByKey = new Map(heldIds.map((row) => [String(row.source_key), String(row.id)]))
  const linkJobs = links.map((url) => ({ url, job_id: idByKey.get(url) ?? null }))

  // The picked format tags every link in the paste — new and already-held —
  // with the team's word on it (origin 'human'), so the retagger leaves it.
  if (format) {
    const held = await sql.query(
      `select id from transcriber.jobs where source_key = any($1::text[])`,
      [links],
    )
    for (const job of held) {
      await sql.query(
        `insert into transcriber.tags (job_id, axis, tag, origin, score)
         values ($1, 'format', $2, 'human', 1)
         on conflict do nothing`,
        [String(job.id), format],
      )
    }
  }

  // Straight onto a week (2026-10-08): a paste in the plan editor lands its
  // videos on that plan as cards, new and already-held alike. The cards are
  // thin until the Mac fetches — her page says the video is not ready yet —
  // and every appendItems guard (declines, solo, one-card-per-reel) applies.
  let attached = 0
  // The cards the paste became, so the editor can point at them — "landed as
  // V-121, V-122" beats a count when the week is forty rows long.
  let cards: { id: string; card_no: number | null }[] = []
  if (typeof payload.plan_id === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(payload.plan_id)) {
    const [plan] = await sql.query(
      `select id, model_id from transcriber.plans where id = $1`,
      [payload.plan_id],
    )
    if (!plan) return NextResponse.json({ error: 'no such plan' }, { status: 404 })
    const held = await sql.query(
      `select id from transcriber.jobs where source_key = any($1::text[])`,
      [links],
    )
    const jobIds = held.map((job) => String(job.id))
    attached = await appendItems(String(plan.id), String(plan.model_id), jobIds)
    if (attached > 0) {
      // A named paste — a German playbook pick, or a name typed in — names
      // its cards before the Mac has fetched anything (Geno, 2026-10-13). A
      // bare link keeps the job id for a minute rather than a URL as a title.
      const namedIds = links
        .filter((link) => label(link) !== labelFor(link))
        .map((link) => idByKey.get(link))
        .filter((id): id is string => Boolean(id))
      if (namedIds.length > 0) {
        await sql.query(
          `update transcriber.plan_items i
              set title = j.label
             from transcriber.jobs j
            where j.id = i.job_id and i.plan_id = $1
              and i.title is null and i.job_id = any($2::text[])`,
          [String(plan.id), namedIds],
        )
      }
      const landed = await sql.query(
        `select id, card_no from transcriber.plan_items
          where plan_id = $1 and job_id = any($2::text[])
          order by position`,
        [String(plan.id), jobIds],
      )
      cards = landed.map((row) => ({
        id: String(row.id),
        card_no: row.card_no === null || row.card_no === undefined ? null : Number(row.card_no),
      }))
    }
  }

  return NextResponse.json({
    added: rows.length,
    skipped: links.length - rows.length,
    attached,
    cards,
    jobs: rows,
    links: linkJobs,
  })
}
