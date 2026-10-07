/**
 * Everything the system already knows about one model, gathered for the
 * Creator Intelligence report (lib/report/spec.ts) — the database half.
 *
 * Sources, in the order the template values them:
 *   profile      what Geno has set on her (persona, formats, won't-do,
 *                verticals, references, type, standing rules, notes)
 *   survey       her own questionnaire answers (capacity, formats, personas)
 *   intake       the raw onboarding dumps — forms, pasted meeting notes,
 *                whatever was dropped on IntakeDrop (model_intake.raw)
 *   her reels    what she posts: her winners (plays vs her usual) with
 *                captions, and transcripts of her own videos — the closest
 *                thing to hearing her talk
 *   feedback     declines with her reasons, her 👍/👎 counts, and what she
 *                has written in plan threads, in her own words
 *
 * Each block is clipped so one enormous dump cannot crowd out the rest.
 * The return also counts what it found (chars per source) — stored as
 * provenance so a thin report can be explained by its thin evidence.
 */
import { sql } from '../db'
import { loadModels } from '../performance/load'
import { clip } from './spec'

const INTAKE_DOCS = 3
const INTAKE_CHARS = 24_000
const WINNERS = 8
const TRANSCRIPTS = 6
const TRANSCRIPT_CHARS = 1_400
const MESSAGES = 30
const PASTE_CHARS = 40_000

export type Evidence = { text: string; sources: Record<string, number> }

export async function gatherEvidence(modelId: string, paste?: string): Promise<Evidence> {
  const [[row], [survey], intakes, [modelRow]] = await Promise.all([
    sql.query(
      `select name, handle, place, timezone, creator_type, persona, formats, hooks, wont_do,
              verticals, similar_creators, topics, standing_rules, notes, solo,
              of_page_type, of_price, socials, weekly_target, priority, trial_stage
         from transcriber.models where id = $1`,
      [modelId],
    ),
    sql.query(
      `select answers, submitted_at from transcriber.surveys
        where model_id = $1 and submitted_at is not null
        order by submitted_at desc limit 1`,
      [modelId],
    ),
    sql.query(
      `select filename, raw, created_at from transcriber.model_intake
        where model_id = $1 and raw is not null
        order by created_at desc limit ${INTAKE_DOCS}`,
      [modelId],
    ),
    loadModels(modelId),
  ])
  if (!row) throw new Error('no such model')
  const handles = modelRow?.handles ?? []

  const [winners, speech, declines, ratings, messages] = await Promise.all([
    handles.length
      ? sql.query(
          `select handle, caption, plays, posted_at::date::text as day
             from transcriber.creator_posts
            where handle = any($1::text[]) and kind = 'reel' and plays is not null
            order by plays desc limit ${WINNERS}`,
          [handles],
        )
      : Promise.resolve([]),
    handles.length
      ? sql.query(
          `select t.plain, t.caption, t.upload_date
             from transcriber.transcripts t
            where lower(t.author) = any($1::text[]) and t.plain is not null and t.plain <> ''
            order by t.transcribed_at desc nulls last limit ${TRANSCRIPTS}`,
          [handles],
        )
      : Promise.resolve([]),
    sql.query(
      `select i.decline_code, i.decline_reason, count(*) as n
         from transcriber.plan_items i
         join transcriber.plans p on p.id = i.plan_id
        where p.model_id = $1 and i.declined_at is not null
        group by i.decline_code, i.decline_reason
        order by n desc limit 20`,
      [modelId],
    ),
    sql.query(
      `select count(*) filter (where i.rating = 1) as up,
              count(*) filter (where i.rating = -1) as down
         from transcriber.plan_items i
         join transcriber.plans p on p.id = i.plan_id
        where p.model_id = $1`,
      [modelId],
    ),
    sql.query(
      `select m.body, m.created_at::date::text as day
         from transcriber.plan_messages m
         join transcriber.plan_items i on i.id = m.item_id
         join transcriber.plans p on p.id = i.plan_id
        where p.model_id = $1 and m.author = 'model'
        order by m.created_at desc limit ${MESSAGES}`,
      [modelId],
    ),
  ])

  const blocks: string[] = []
  const sources: Record<string, number> = {}
  const add = (name: string, text: string) => {
    const t = text.trim()
    if (!t) return
    blocks.push(`### ${name}\n${t}`)
    sources[name] = t.length
  }

  add('PROFILE (set by the team)', [
    `Name: ${row.name}`,
    row.place && `Based in: ${row.place} (${row.timezone ?? 'tz unknown'})`,
    row.creator_type && `Creator type: ${row.creator_type}`,
    row.persona && `Persona: ${row.persona}`,
    arr(row.formats) && `Formats she makes: ${arr(row.formats)}`,
    arr(row.wont_do) && `Formats she will NOT do: ${arr(row.wont_do)}`,
    arr(row.verticals) && `Verticals: ${arr(row.verticals)}`,
    arr(row.topics) && `Topics: ${arr(row.topics)}`,
    arr(row.similar_creators) && `Reference creators: ${arr(row.similar_creators)}`,
    row.solo === false && 'Films with a partner (not solo-only)',
    row.solo !== false && 'Solo on camera',
    row.of_page_type && `OnlyFans page: ${row.of_page_type}${row.of_price ? ` at ${row.of_price}` : ''}`,
    row.standing_rules && `Standing rules (always apply): ${row.standing_rules}`,
    row.notes && `Team notes: ${row.notes}`,
    handles.length && `Instagram: ${handles.map((h: string) => `@${h}`).join(', ')}`,
  ].filter(Boolean).join('\n'))

  if (survey?.answers) {
    add('HER QUESTIONNAIRE (her own answers)', clip(JSON.stringify(survey.answers, null, 1), 3_000))
  }

  for (const [index, doc] of intakes.entries()) {
    add(
      `INTAKE / MEETING DUMP ${index + 1}${doc.filename ? ` (${doc.filename})` : ''}`,
      clip(String(doc.raw), Math.floor(INTAKE_CHARS / Math.max(intakes.length, 1))),
    )
  }

  if (paste?.trim()) add('PASTED FOR THIS REPORT (meeting notes, extra context)', clip(paste, PASTE_CHARS))

  if (winners.length) {
    add('HER TOP REELS (by plays)', winners.map((w) =>
      `- ${Number(w.plays).toLocaleString('en-US')} plays · @${w.handle} · ${w.day}${w.caption ? ` · caption: ${String(w.caption).slice(0, 140)}` : ''}`,
    ).join('\n'))
  }

  if (speech.length) {
    add('HER OWN WORDS (transcripts of her videos)', speech.map((s, i) =>
      `Video ${i + 1}${s.upload_date ? ` (${s.upload_date})` : ''}:\n${clip(String(s.plain), TRANSCRIPT_CHARS)}`,
    ).join('\n\n'))
  }

  const feedback: string[] = []
  for (const d of declines) {
    feedback.push(`- Declined ${d.n}×: ${d.decline_code ?? 'no reason picked'}${d.decline_reason ? ` — "${String(d.decline_reason).slice(0, 160)}"` : ''}`)
  }
  const up = Number(ratings[0]?.up ?? 0)
  const down = Number(ratings[0]?.down ?? 0)
  if (up + down > 0) feedback.push(`- Reference ratings: ${up} thumbs up, ${down} thumbs down`)
  if (feedback.length) add('HER FEEDBACK ON PLANS (declines and ratings)', feedback.join('\n'))

  if (messages.length) {
    add('HER MESSAGES (plan threads, her words)', messages.map((m) =>
      `- ${m.day}: ${String(m.body).slice(0, 240)}`,
    ).join('\n'))
  }

  return { text: blocks.join('\n\n'), sources }
}

function arr(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null
  return value.map(String).join(', ')
}
