/**
 * The T6 brief and the caption engine, written in one call per card.
 *
 * T6 is the manual's send-to-model brief: a short DM-ready version, in her
 * voice, with **no competitor handle, no source creator and no other model's
 * name** anywhere in it. The caption engine is the manual's five formulas —
 * hyper-specific claim, POV possessive, self-aware flaw, symmetry slogan,
 * ragebait opinion — each written with the exact comment it is built to
 * provoke, which is the manual's test for whether a caption baits anything.
 *
 * One call for both, because they read the same inputs and the free allowance
 * is shared with Whisper. The full T6 brief is not generated: every field it
 * asks for is already on her card (concept, hook, what to film, outfit,
 * location, length, caption, what to avoid, why it fits her).
 */
import { sql } from './db'
import { WRITER_MODEL, askJson } from './ai'
import { labelOf } from './taxonomy'
import { expressionFor, copyRuleFor, type Bucket } from './card'
import type { CaptionOption } from './plans'

const FORMULAS = [
  'Hyper-Specific Claim — a numbered promise with 3+ specific true traits, one geographic or cultural',
  'POV Possessive — "POV: your [archetype people already use] finally [action]"',
  'Self-Aware Flaw — pre-empt a criticism people would genuinely make, then a redeeming trait',
  'Symmetry Slogan — a quotable word inversion, built for shares',
  'Ragebait Opinion — a confident take on a LOW-STAKES universal topic (phones, food, texting, driving, gym)',
]

type Written = { dm?: unknown; captions?: unknown }

/** A "baited" comment that is really praise. Nobody needs a caption to type
 *  "love this"; the manual's QC pass cuts exactly these. */
const PRAISE = /\b(love (this|it|you)|so (you|true|cute|pretty|hot)|killing it|slay|nailed|queen|obsessed|gorgeous|beautiful|stunning|yes girl|you go|amazing|perfect|obsessed)\b/i

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
  const rule = copyRuleFor((row.bucket as Bucket | null) ?? null, (row.axis as string | null) ?? null)
  const verticals = Array.isArray(row.verticals)
    ? (row.verticals as { name: string }[]).map((v) => v.name).join(', ')
    : ''

  const prompt = [
    'You write for one specific creator. Return ONLY a JSON object:',
    '{"dm": "...", "captions": [{"formula": "...", "caption": "...", "baits": "..."}]}',
    '',
    'CREATOR',
    `- Name: ${row.name}`,
    persona.length ? `- Persona: ${persona.join(', ')}` : '',
    row.place ? `- Where she is: ${row.place}` : '',
    verticals ? `- Her verticals: ${verticals}` : '',
    row.her_words ? `- Words she actually uses (from her own videos): ${String(row.her_words).slice(0, 500)}` : '',
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
    'TASK 1 — "dm": a short message (under 90 words) she could receive as a DM, in a warm direct friend tone:',
    'what the concept is, the hook, what to film, what to wear and where, how long, and one line on why it fits her lane.',
    (row.bucket === 'reskin' || row.bucket === 'iteration')
      ? '- This is HER OWN reel that already did well. Say so plainly: she is re-filming her own video' +
        (row.axis ? `, changing only ${row.axis === 'location' ? 'where she films it' : row.axis === 'hook' ? 'the opening line' : 'her outfit'}.` : ', exactly as it was.')
      : '- This is a new idea for her.',
    'Never mention any other creator, handle, account, source, or model. Never use the words card, reskin, iteration, vertical, bucket or winner card.',
    '',
    'TASK 2 — "captions": exactly 3 captions, each using a different formula from:',
    ...FORMULAS.map((f, i) => `${i + 1}. ${f}`),
    'Each caption under 12 words, sounding like her, using only traits she actually has from the profile above.',
    '"baits" is the exact comment a real stranger would type in reply. It must be a disagreement, a correction,',
    'a question, tagging a friend, or "this is literally me" — NEVER a compliment or praise for her.',
    'A caption that only draws "love this" baits nothing and fails.',
    'Formula 1 must be a numbered promise like "2 reasons to date a..." — not a list of adjectives.',
    'Hard bans: no emojis, no hashtags, no em-dash asides, no "not just X but Y", no politics, race, religion or body-shaming.',
  ].filter(Boolean).join('\n')

  const written = await askJson<Written>(prompt, { maxTokens: 520, temperature: 0.6, model: WRITER_MODEL })
  if (!written) return { item_id: itemId, ok: false, reason: 'the model returned nothing usable' }

  const dm = typeof written.dm === 'string' ? cleanDm(written.dm) : null
  const captions: CaptionOption[] = (Array.isArray(written.captions) ? written.captions : [])
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      formula: String(c.formula ?? '').slice(0, 60),
      caption: String(c.caption ?? '').trim().slice(0, 140),
      baits: String(c.baits ?? '').trim().slice(0, 140),
    }))
    // The manual's one test: if you cannot type the comment it provokes, it baits
    // nothing — and a compliment is not a comment anyone needed a caption to type.
    // Enforced here rather than trusted to the prompt, which the first runs ignored.
    .filter((c) => c.caption.length > 0 && c.baits.length > 0 && !PRAISE.test(c.baits))
    .slice(0, 3)

  await sql.query(
    `update transcriber.plan_items set brief_short = coalesce($2, brief_short),
            caption_options = case when $3::jsonb = '[]'::jsonb then caption_options else $3::jsonb end
      where id = $1`,
    [itemId, dm, JSON.stringify(captions)],
  )
  return { item_id: itemId, ok: Boolean(dm || captions.length) }
}
