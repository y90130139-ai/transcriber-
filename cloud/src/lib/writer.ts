/**
 * The T6 brief, written one card per call.
 *
 * T6 is the manual's send-to-model brief: a short DM-ready version, in her
 * voice, with **no competitor handle, no source creator and no other model's
 * name** anywhere in it. The full T6 brief is not generated: every field it
 * asks for is already on her card (concept, hook, what to film, outfit,
 * location, length, caption, what to avoid, why it fits her).
 *
 * Captions used to be written here too, one card at a time, and collapsed onto
 * three shapes across a week. They are written a week at a time in
 * `captions.ts` now; the DM is per card because it was always good.
 */
import { sql } from './db'
import { WRITER_MODEL, askJson } from './ai'
import { labelOf } from './taxonomy'
import { expressionFor, copyRuleFor, type Bucket } from './card'

type Written = { dm?: unknown }

/**
 * How the writer is told to address the creator.
 *
 * Deliberately about words rather than identity: the caption engine writes a
 * line somebody will read as hers, and the only thing it needs to know is
 * which words are hers. `unknown` refuses to guess — no gendered word at all
 * is a safe caption; the wrong one is not.
 */
export const WHO: Record<string, string> = {
  woman: 'The creator is a woman. Use she/her, and words like girl or woman where they fit.',
  man: 'The creator is a MAN. Use he/him. Never write girl, woman, she or her about him, '
    + 'and never write a caption addressed to men about a woman.',
  'trans-woman': 'The creator is a trans woman. Use she/her. Do not make being trans the subject '
    + 'of a caption unless her own words already do.',
  'trans-man': 'The creator is a trans man. Use he/him. Do not make being trans the subject '
    + 'of a caption unless his own words already do.',
  'non-binary': 'The creator is non-binary. Use they/them, and no gendered nouns at all.',
  couple: 'The creator is a couple — two people. Use we/us in captions and they/them about them.',
  unknown: 'Nobody has said who this creator is, so use NO gendered words at all: '
    + 'no she, he, girl, guy, woman or man, and no gendered framing.',
}

/** Our own vocabulary, which must never reach her. */
const JARGON: [RegExp, string][] = [
  [/\bwinner card\b/gi, 'reel'],
  [/\bfor a card\b/gi, ''],
  [/\bcard\b/gi, 'video'],
  [/\breskin(ned|s)?\b/gi, 'redo'],
  [/\biterations?\b/gi, 'another go'],
  [/\bverticals?\b/gi, 'style'],
]

function cleanDm(text: string): string {
  let out = text.trim()
  for (const [pattern, replacement] of JARGON) out = out.replace(pattern, replacement)
  return out.replace(/\s{2,}/g, ' ').slice(0, 900)
}

export type WriteResult = { item_id: string; ok: boolean; reason?: string }

export async function writeCard(itemId: string): Promise<WriteResult> {
  const [row] = await sql.query(
    `select i.id, i.bucket, i.axis, i.hook, i.caption, i.notes, i.wardrobe, i.location, i.title,
            t.duration_sec, left(coalesce(t.plain, ''), 600) as reference_words,
            m.name, m.persona, m.place, m.standing_rules, m.wont_do, m.verticals, m.handle,
            m.creator_type,
            coalesce((select array_agg(g.tag) from transcriber.tags g
                       where g.job_id = i.job_id and g.axis = 'format'), '{}') as formats,
            (select string_agg(left(coalesce(h.plain, ''), 200), ' ')
               from (select plain from transcriber.transcripts
                      where author = lower(m.handle) and coalesce(plain, '') <> ''
                      order by transcribed_at desc limit 4) h) as her_words
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
       join transcriber.models m on m.id = p.model_id
       left join transcriber.transcripts t on t.job_id = i.job_id
      where i.id = $1`,
    [itemId],
  )
  if (!row) return { item_id: itemId, ok: false, reason: 'no such card' }

  const formats = (row.formats as string[]) ?? []
  const persona = ((row.persona as string[]) ?? []).map((tag) => labelOf('persona', tag))

  // Whose voice this is. Left unset the model reads the roster's centre of
  // gravity and writes female — which is how Magnus, a man, was given a week
  // of "3 reasons to date a Connecticut girl" (2026-09-23).
  const who = WHO[String(row.creator_type ?? 'unknown')] ?? WHO.unknown

  const rule = copyRuleFor((row.bucket as Bucket | null) ?? null, (row.axis as string | null) ?? null)
  const verticals = Array.isArray(row.verticals)
    ? (row.verticals as { name: string }[]).map((v) => v.name).join(', ')
    : ''

  const prompt = [
    'You write for one specific creator. Return ONLY a JSON object:',
    '{"dm": "..."}',
    '',
    'CREATOR',
    `- Name: ${row.name}`,
    `- ${who}`,
    persona.length ? `- Persona: ${persona.join(', ')}` : '',
    row.place ? `- Where they are: ${row.place}` : '',
    verticals ? `- Her verticals: ${verticals}` : '',
    row.her_words ? `- Words the creator actually uses (from their own videos): ${String(row.her_words).slice(0, 500)}` : '',
    row.standing_rules ? `- Always: ${row.standing_rules}` : '',
    (row.wont_do as string[] | null)?.length ? `- Never: ${(row.wont_do as string[]).map((t) => labelOf('format', t)).join(', ')}` : '',
    '',
    'THIS CARD',
    `- Format: ${formats.map((t) => labelOf('format', t)).join(', ') || 'general'}`,
    `- What she does: ${rule.label}. Keep: ${rule.keep} Change: ${rule.change}`,
    `- Her face: ${expressionFor(formats)}`,
    row.hook ? `- The reference opens with: "${row.hook}"` : '',
    row.wardrobe ? `- Outfit: ${row.wardrobe}` : '',
    row.location ? `- Where: ${row.location}` : '',
    row.duration_sec ? `- Length: about ${Math.round(Number(row.duration_sec) / 5) * 5} seconds` : '',
    '',
    'TASK — "dm": a short message (under 90 words) she could receive as a DM, in a warm direct friend tone:',
    'what the concept is, the hook, what to film, what to wear and where, how long, and one line on why it fits her lane.',
    (row.bucket === 'reskin' || row.bucket === 'iteration')
      ? '- This is HER OWN reel that already did well. Say so plainly: she is re-filming her own video' +
        (row.axis ? `, changing only ${row.axis === 'location' ? 'where she films it' : row.axis === 'hook' ? 'the opening line' : 'her outfit'}.` : ', exactly as it was.')
      : '- This is a new idea for her.',
    'Never mention any other creator, handle, account, source, or model. Never use the words card, reskin, iteration, vertical, bucket or winner card.',
  ].filter(Boolean).join('\n')

  const written = await askJson<Written>(prompt, { maxTokens: 260, temperature: 0.75, model: WRITER_MODEL })
  if (!written) return { item_id: itemId, ok: false, reason: 'the model returned nothing usable' }

  const dm = typeof written.dm === 'string' ? cleanDm(written.dm) : null
  if (!dm) return { item_id: itemId, ok: false, reason: 'the model wrote no DM' }

  await sql.query(`update transcriber.plan_items set brief_short = $2 where id = $1`, [itemId, dm])
  return { item_id: itemId, ok: true }
}
