/**
 * The quality scan, rebuilt (Geno, 2026-10-07: "a high-quality check, not a
 * BS check"). The old one saw a single poster frame through a small vision
 * model, with "outdoors scores high, bedrooms score low" written into the
 * prompt — so every note said "change the background to an outdoor
 * setting", including on reels whose visual IS a background under text.
 *
 * Now the check reads everything the library already knows about the reel
 * when it has been ingested: the transcript (what she says), the on-screen
 * text (what the viewer reads), the measured shots (cuts and camera — so
 * pacing is measured, not guessed), beside the caption, length, audio and
 * the first frame. A text-overlay reel is judged as a text-overlay reel:
 * legibility and the written hook, not the wallpaper behind it.
 *
 * Judged by Claude (vision) when ANTHROPIC_API_KEY is on Vercel — this is
 * judgment work — and by the Workers vision model with the same grounding
 * and the same neutral rubric until then.
 */
import Anthropic from '@anthropic-ai/sdk'
import { sql } from './db'
import { askJson } from './ai'

const PER_REQUEST = 3
export const REVISE_BELOW = 7.0
/** The manual: keep videos shorter. */
const IDEAL_MAX_SECONDS = 15

type Seen = {
  hook?: unknown; visual?: unknown; pacing?: unknown; clarity?: unknown
  risk?: unknown; note?: unknown
}

const QUALITY_MODEL = 'claude-sonnet-5-5'

/** The rubric both engines get. Neutral on setting by design: the old
 *  bedroom-penalty line is what made every answer "go outdoors". */
const RUBRIC = `You are a strict short-form creative director reviewing one Instagram reel from a creator whose audience follows HER. Judge the reel for what it is — a talking head is judged on its delivery and premise, a text-overlay reel on its written hook and legibility, a thirst trap on its craft. Never penalise a bedroom, car or plain wall as such; judge whether the frame serves THIS reel (light on the subject, readable text, clean composition).

Score 1-10, strictly (7 is good, 9 is rare):
- hook: would the first two seconds stop a scroll? Judge the spoken first line, the on-screen opening text and the first frame together.
- clarity: is the premise graspable in one watch? One idea, or a muddle?
- visual: craft of the frame FOR this content — light on subject, composition, text legibility when text carries it.
- pacing: use the measured cuts and length when given; a single static shot over 20s usually drags, dense cuts can churn.
Also: risk — how likely Instagram limits it under community guidelines ("none"|"some"|"high").
And note — ONE sentence naming the single highest-leverage fix, grounded in what you actually read or saw (quote her words or her on-screen text when that is the problem). Never generic advice.

Answer ONLY JSON: {"hook":n,"clarity":n,"visual":n,"pacing":n,"risk":"none|some|high","note":"..."}`

export type QualityCheck = {
  post_id: string
  scores: Record<string, number>
  composite: number
  verdict: 'PASS' | 'WARN' | 'FAIL'
  notes: string
  checked_at?: string
}

const score = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1), 10) : null
}

async function frameOf(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 900_000) return null
    return `data:${response.headers.get('content-type') ?? 'image/jpeg'};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

type Grounding = { text: string; measured: boolean }

/** Everything the library knows about this reel, written out for the judge.
 *  `measured` says whether pacing can honestly be scored. */
function groundingFor(row: Record<string, unknown>): Grounding {
  const lines: string[] = []
  const seconds = Number(row.duration_sec)
  if (Number.isFinite(seconds) && seconds > 0) lines.push(`Length: ${Math.round(seconds)}s.`)
  if (row.caption) lines.push(`Caption: ${String(row.caption).slice(0, 300)}`)
  if (row.audio_title) lines.push(`Audio: ${String(row.audio_title)}${row.original_audio === false ? ' (licensed sound)' : ''}`)
  const spoken = row.plain ? String(row.plain).trim() : ''
  if (spoken) lines.push(`What she says (transcript): ${spoken.slice(0, 900)}`)
  const onScreen = [row.on_screen_text, row.on_screen_captions].filter(Boolean).map(String).join(' / ').trim()
  if (onScreen) lines.push(`On-screen text the viewer reads: ${onScreen.slice(0, 500)}`)
  let measured = false
  const shots = row.shots as { shots?: { start: number; end: number; camera?: string }[] } | null
  if (shots?.shots?.length) {
    measured = true
    const cuts = shots.shots.length
    const moving = shots.shots.filter((s) => s.camera && s.camera !== 'still').length
    lines.push(`Measured: ${cuts} shot${cuts === 1 ? '' : 's'}${Number.isFinite(seconds) && seconds > 0 ? ` over ${Math.round(seconds)}s` : ''}, camera moving in ${moving}.`)
  }
  if (!spoken && !onScreen && !measured) {
    lines.push('Not ingested: only this first frame, the caption and the length are known — say so in the note rather than guessing at content.')
  }
  return { text: lines.join('\n'), measured }
}

/** Claude with the frame when the key is there; the Workers vision model
 *  with identical grounding and rubric when it is not. */
async function judge(frame: string, grounding: Grounding): Promise<Seen | null> {
  const prompt = `${RUBRIC}\n\n=== WHAT IS KNOWN ABOUT THIS REEL ===\n${grounding.text}`
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ timeout: 60_000, maxRetries: 1 })
      const match = /^data:(.*?);base64,(.*)$/.exec(frame)
      if (!match) return null
      const response = await client.messages.create({
        model: QUALITY_MODEL,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: match[1] as 'image/jpeg', data: match[2] } },
            { type: 'text', text: prompt },
          ],
        }],
      })
      const said = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      const json = /\{[\s\S]*\}/.exec(said.replace(/```json|```/g, ''))
      return json ? (JSON.parse(json[0]) as Seen) : null
    } catch {
      return null
    }
  }
  return askJson<Seen>(prompt, { images: [frame], maxTokens: 300, temperature: 0.1 })
}

/** Scan her newest reels that have not been checked yet. */
export async function scanModel(modelId: string, handles: string[]): Promise<QualityCheck[]> {
  const rows = await sql.query(
    `select s.post_id, s.poster_url, s.duration_sec, s.caption, s.audio_title, s.original_audio,
            k.plain, k.on_screen_text, k.on_screen_captions, k.shots, k.job_id
       from transcriber.sightings s
       left join lateral (
         select t.plain, t.on_screen_text, t.on_screen_captions, t.shots, t.job_id
           from transcriber.jobs j
           join transcriber.transcripts t on t.job_id = j.id
          where j.source ~ ('/' || s.post_id || '/?([?#].*)?$')
          limit 1
       ) k on true
      where s.handle = any($1::text[]) and s.poster_url is not null
        and not exists (select 1 from transcriber.quality_checks q where q.post_id = s.post_id)
      order by s.posted_at desc nulls last
      limit $2`,
    [handles, PER_REQUEST],
  )
  const out: QualityCheck[] = []
  for (const row of rows) {
    const frame = await frameOf(String(row.poster_url))
    if (!frame) continue
    const grounding = groundingFor(row)
    const seen = await judge(frame, grounding)
    if (!seen) continue

    const scores: Record<string, number> = {}
    for (const key of ['hook', 'clarity', 'visual', 'pacing'] as const) {
      const value = score(seen[key])
      if (value !== null) scores[key] = value
    }
    // An unmeasured, un-ingested reel gives the judge nothing to read pacing
    // from — an invented number is the old disease. Drop it instead.
    if (!grounding.measured) delete scores.pacing
    const seconds = Number(row.duration_sec)
    if (Number.isFinite(seconds) && seconds > 0) {
      scores.length = seconds <= IDEAL_MAX_SECONDS ? 10 : seconds <= 30 ? 7 : 4
    }
    const words = String(row.caption ?? '').trim().split(/\s+/).filter(Boolean).length
    scores.caption = words === 0 ? 3 : words <= 12 ? 9 : words <= 30 ? 7 : 5
    scores.audio = row.original_audio === false && row.audio_title ? 9 : 7

    const values = Object.values(scores)
    const composite = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    const risk = String(seen.risk ?? 'none')
    const verdict: QualityCheck['verdict'] = risk === 'high' ? 'FAIL' : composite < REVISE_BELOW || risk === 'some' ? 'WARN' : 'PASS'
    const weakest = Object.entries(scores).sort((a, b) => a[1] - b[1])[0]
    const notes = [
      typeof seen.note === 'string' ? seen.note.slice(0, 200) : '',
      verdict !== 'PASS' && weakest ? `Weakest: ${weakest[0]} (${weakest[1]}/10).` : '',
      risk !== 'none' ? `Guideline risk: ${risk}.` : '',
    ].filter(Boolean).join(' ')

    await sql.query(
      `insert into transcriber.quality_checks (post_id, model_id, scores, composite, verdict, notes)
       values ($1, $2, $3::jsonb, $4, $5, $6)
       on conflict (post_id) do update set scores = excluded.scores, composite = excluded.composite,
         verdict = excluded.verdict, notes = excluded.notes, checked_at = now()`,
      [String(row.post_id), modelId, JSON.stringify(scores), composite, verdict, notes],
    )
    out.push({ post_id: String(row.post_id), scores, composite, verdict, notes })
  }
  return out
}

export async function checksFor(modelId: string): Promise<QualityCheck[]> {
  const rows = await sql.query(
    `select post_id, scores, composite, verdict, notes, checked_at from transcriber.quality_checks
      where model_id = $1 order by checked_at desc limit 20`,
    [modelId],
  )
  return rows.map((row) => ({
    post_id: String(row.post_id),
    scores: row.scores as Record<string, number>,
    composite: Number(row.composite),
    verdict: row.verdict as QualityCheck['verdict'],
    notes: String(row.notes ?? ''),
    checked_at: String(row.checked_at),
  }))
}
