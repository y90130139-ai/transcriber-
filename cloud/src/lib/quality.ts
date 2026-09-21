/**
 * The quality scan — the manual's T2, on the reels she actually posted.
 *
 * Eight dimensions: hook, lighting, angle, length, pacing, caption, audio,
 * style match. A composite under 7.0 earns a revision note; a guideline risk
 * the model rates high is a FAIL. The manual invokes the compliance tiers and
 * the dimensions by name and defines neither, so the scoring here is ours and
 * says what it is.
 *
 * Split by what can honestly be judged from where. The vision model sees one
 * frame — the poster, which is the reel's first impression — so it scores what
 * a frame shows: lighting, angle, background, outfit, first-frame hook and
 * guideline risk. Length, caption and audio are measured, not guessed. Pacing
 * cannot be read from a still and is left out rather than invented.
 */
import { sql } from './db'
import { askJson } from './ai'

const PER_REQUEST = 4
export const REVISE_BELOW = 7.0
/** The manual: keep videos shorter. */
const IDEAL_MAX_SECONDS = 15

type Seen = { lighting?: unknown; angle?: unknown; background?: unknown; outfit?: unknown; hook?: unknown; risk?: unknown; note?: unknown }

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

/** Scan her newest reels that have not been checked yet. */
export async function scanModel(modelId: string, handles: string[]): Promise<QualityCheck[]> {
  const rows = await sql.query(
    `select s.post_id, s.poster_url, s.duration_sec, s.caption, s.audio_title, s.original_audio
       from transcriber.sightings s
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
    const seen = await askJson<Seen>(
      'This is the first frame of an Instagram Reel from a creator. Rate each 1-10 as a strict creative director. ' +
      'Return ONLY JSON: {"lighting":n,"angle":n,"background":n,"outfit":n,"hook":n,"risk":"none|some|high","note":"one sentence: the single most important fix"}. ' +
      'background: outside, pool, beach, garden or city scores high; plain white walls, bedrooms or messy rooms score low. ' +
      'hook: would this first frame stop someone scrolling? risk: how likely Instagram flags it under community guidelines.',
      { images: [frame], maxTokens: 160, temperature: 0.1 },
    )
    if (!seen) continue

    const scores: Record<string, number> = {}
    for (const key of ['lighting', 'angle', 'background', 'outfit', 'hook'] as const) {
      const value = score(seen[key])
      if (value !== null) scores[key] = value
    }
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
