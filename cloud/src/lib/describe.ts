/**
 * One line per shot of a reference, from a vision model — the part of "Film
 * it" the Mac cannot measure (Geno approved this pass, 2026-09-27).
 *
 * The Mac measures where the cuts are, who is in frame and whether the phone
 * moves (`src/shots.py`), and Apple's labels name a thing ("horse"). What they
 * cannot say is what *happens*: "she glances back, unimpressed", "a horse
 * bolts across a field". This asks for exactly that, one short line a shot,
 * plus how the phone looks to be held, and stores it on the reel's shot list.
 *
 * One call per reel, one keyframe per shot, at most MAX_SHOTS. It runs from
 * the nightly job after the captions, on whatever free allowance is left.
 */
import { sql } from './db'
import { askJson } from './ai'
import { mergeDescriptions, type Measured } from './shotlist'

const MAX_SHOTS = 4
type Said = { shots?: { no?: unknown; what?: unknown; camera?: unknown }[] }

export type Frame = { no: number; image: string }

function prompt(measured: Measured, context: { screen: string[]; speech: string[] }): string {
  return [
    'These are frames from an Instagram Reel, one per shot, in order. A creator will film her own version,',
    'so describe what she would need to do or show. Return ONLY JSON:',
    '{"shots":[{"no":1,"what":"...","camera":"selfie|someone|propped|none"}]}',
    '- "what": one short plain sentence, max 14 words, present tense, what happens in that shot',
    '  (e.g. "She looks at the camera, unimpressed, then rolls her eyes" or "A horse runs off across a field").',
    '  No opinions, no emojis, no body descriptions, never name or guess who anyone is.',
    '- "camera": selfie = she holds the phone herself (arm in frame, close, front camera);',
    '  someone = another person holds it; propped = on a stand or surface; none = nobody in the shot.',
    '',
    'What the Mac measured, per shot:',
    ...measured.shots.slice(0, MAX_SHOTS).map((shot, index) =>
      `${index + 1}. ${shot.start.toFixed(1)}-${shot.end.toFixed(1)}s, people: ${shot.people}, framing: ${shot.framing}, phone: ${shot.camera}${shot.labels.length ? `, seen: ${shot.labels.join(', ')}` : ''}`),
    context.screen.length ? `On-screen text: ${context.screen.slice(0, 4).map((t) => `"${t}"`).join(', ')}` : '',
    context.speech.length ? `Words spoken: "${context.speech.join(' ').slice(0, 240)}"` : '',
  ].filter(Boolean).join('\n')
}

export async function describeReel(jobId: string, frames: Frame[]): Promise<{ ok: boolean; reason?: string }> {
  const [row] = await sql.query(
    `select shots, on_screen_captions, blocks from transcriber.transcripts where job_id = $1`,
    [jobId],
  )
  const measured = row?.shots as Measured | null
  if (!measured?.shots?.length) return { ok: false, reason: 'not measured yet' }
  const images = frames
    .filter((frame) => frame.no >= 1 && frame.no <= MAX_SHOTS && /^data:image\/jpeg;base64,/.test(frame.image))
    .sort((a, b) => a.no - b.no)
    .map((frame) => frame.image)
  if (!images.length) return { ok: false, reason: 'no frames' }
  const screen = Array.isArray(row.on_screen_captions)
    ? (row.on_screen_captions as { text?: string }[]).map((c) => String(c.text ?? '')).filter(Boolean)
    : []
  const speech = Array.isArray(row.blocks) ? (row.blocks as { text?: string }[]).map((b) => String(b.text ?? '')) : []
  // Throws on a refused call (429 included) — the caller says why and stops.
  const said = await askJson<Said>(prompt(measured, { screen, speech }), { images, maxTokens: 400, temperature: 0.2 })
  if (!said) return { ok: false, reason: 'the model answered without usable JSON' }
  await sql.query(
    `update transcriber.transcripts set shots = $2::jsonb where job_id = $1`,
    [jobId, JSON.stringify(mergeDescriptions(measured, said))],
  )
  return { ok: true }
}
