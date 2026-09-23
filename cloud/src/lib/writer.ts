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

/**
 * How the writer is told to address the creator.
 *
 * Deliberately about words rather than identity: the caption engine writes a
 * line somebody will read as hers, and the only thing it needs to know is
 * which words are hers. `unknown` refuses to guess — no gendered word at all
 * is a safe caption; the wrong one is not.
 */
const WHO: Record<string, string> = {
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

/**
 * Words that give away the wrong person.
 *
 * The prompt says who the creator is and the model still wrote "3 reasons to
 * date a Connecticut girl" on 7 of 21 cards for a man (2026-09-23, second
 * run). Same lesson as the praise filter directly below: state it in the
 * prompt, then enforce it here, because the prompt is advice and this is not.
 */
const WRONG_WORDS: Record<string, RegExp> = {
  woman: /\b(he|him|his|guy|guys|dude|man|men|boyfriend material)\b/i,
  man: /\b(she|her|hers|girl|girls|woman|women|ladies|queen)\b/i,
  'trans-woman': /\b(he|him|his|guy|dude|man|men)\b/i,
  'trans-man': /\b(she|her|hers|girl|girls|woman|women|ladies)\b/i,
  'non-binary': /\b(he|him|his|she|her|hers|girl|girls|guy|guys|woman|women|man|men)\b/i,
  unknown: /\b(he|him|his|she|her|hers|girl|girls|guy|guys|woman|women|man|men)\b/i,
}

/** Two captions are "the same" when what they say is the same. Numbers and
 *  punctuation move around freely — "2 reasons to date a Connecticut girl" and
 *  "3 reasons to date a Connecticut girl" are one caption, not two. */
function shapeOf(caption: string): string {
  return caption.toLowerCase().replace(/[0-9]+/g, '#').replace(/[^a-z#\s]/g, '').replace(/\s+/g, ' ').trim()
}

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
            m.creator_type, i.plan_id,
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

  // What has already been written for this week, so twenty cards stop
  // converging on the same three sentences. Each card is one call and knows
  // nothing about its siblings unless it is told.
  const siblings = await sql.query(
    `select caption_options from transcriber.plan_items
      where plan_id = $1 and id <> $2 and caption_options is not null
      order by position limit 24`,
    [row.plan_id, itemId],
  )
  const already = siblings
    .flatMap((r) => (Array.isArray(r.caption_options) ? r.caption_options as CaptionOption[] : []))
    .map((option) => option.caption)
    .filter(Boolean)
    .slice(0, 40)
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
    'TASK 1 — "dm": a short message (under 90 words) she could receive as a DM, in a warm direct friend tone:',
    'what the concept is, the hook, what to film, what to wear and where, how long, and one line on why it fits her lane.',
    (row.bucket === 'reskin' || row.bucket === 'iteration')
      ? '- This is HER OWN reel that already did well. Say so plainly: she is re-filming her own video' +
        (row.axis ? `, changing only ${row.axis === 'location' ? 'where she films it' : row.axis === 'hook' ? 'the opening line' : 'her outfit'}.` : ', exactly as it was.')
      : '- This is a new idea for her.',
    'Never mention any other creator, handle, account, source, or model. Never use the words card, reskin, iteration, vertical, bucket or winner card.',
    '',
    // Five asked for, three kept. The manual has five formulas and the filters
    // below drop anything written for the wrong person or already said this
    // week — asking for exactly three left cards with one caption on it.
    'TASK 2 — "captions": exactly 5 captions, one for each formula:',
    ...FORMULAS.map((f, i) => `${i + 1}. ${f}`),
    'Each caption under 12 words, sounding like the creator, using only traits they actually have above.',
    already.length
      ? 'ALREADY USED THIS WEEK — do not repeat or paraphrase any of these:\n' + already.map((c) => `- ${c}`).join('\n')
      : '',
    'Do not build every caption around where they live, and do not borrow an incidental detail '
      + 'from the reference words (a prop, a one-off line) as if it were her subject.',
    '"baits" is the exact comment a real stranger would type in reply. It must be a disagreement, a correction,',
    'a question, tagging a friend, or "this is literally me" — NEVER a compliment or praise for her.',
    'A caption that only draws "love this" baits nothing and fails.',
    'Formula 1 must be a numbered promise like "2 reasons to date a..." — not a list of adjectives.',
    'Hard bans: no emojis, no hashtags, no em-dash asides, no "not just X but Y", no politics, race, religion or body-shaming.',
  ].filter(Boolean).join('\n')

  const written = await askJson<Written>(prompt, { maxTokens: 760, temperature: 0.75, model: WRITER_MODEL })
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

  const wrong = WRONG_WORDS[String(row.creator_type ?? 'unknown')] ?? WRONG_WORDS.unknown
  const seen = new Set(already.map(shapeOf))
  const kept: CaptionOption[] = []
  for (const option of captions) {
    // Written for the wrong person, or already said this week. Either way it
    // is dropped rather than stored: a card with two captions she can use is
    // worth more than three with one that calls her the wrong thing.
    if (wrong.test(option.caption)) continue
    const shape = shapeOf(option.caption)
    if (seen.has(shape)) continue
    seen.add(shape)
    kept.push(option)
    if (kept.length === 3) break
  }

  await sql.query(
    `update transcriber.plan_items set brief_short = coalesce($2, brief_short),
            caption_options = case when $3::jsonb = '[]'::jsonb then caption_options else $3::jsonb end
      where id = $1`,
    [itemId, dm, JSON.stringify(kept)],
  )
  return {
    item_id: itemId,
    ok: Boolean(dm || kept.length),
    reason: kept.length === 0 && captions.length > 0
      ? 'every caption was written for the wrong person or already used this week'
      : undefined,
  }
}
