/**
 * Speech to text without the Mac.
 *
 * whisper.cpp with Metal is the real transcriber and it only runs on the Mac.
 * When the Mac is unreachable this stands in: Cloudflare Workers AI running
 * `whisper-large-v3-turbo` — the same model family, on the account that
 * already holds the R2 bucket, so failover adds no new vendor.
 *
 * It is a fallback, not a replacement. It hears speech and nothing else: no
 * diarization, no on-screen text (Apple's Vision framework is macOS-only).
 * Those stay the Mac's job and can be filled in later.
 *
 * Free allowance is 10,000 neurons a day, about 640 twenty-second reels —
 * more than a week of picks, so failover normally costs nothing.
 */
const MODEL = '@cf/openai/whisper-large-v3-turbo'
const API = 'https://api.cloudflare.com/client/v4'

/** Base64 inflates by a third, and the whole request has to fit comfortably
 *  in a serverless function's memory and time. A reel's audio track runs
 *  ~150KB; anything past this is not a reel. */
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024

export type Heard = {
  text: string
  words: number
  language: string | null
  seconds: number | null
  voiced: number | null
}

export function sttConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_AI_TOKEN && process.env.R2_ACCOUNT_ID)
}

/** Transcribe one audio file. Throws with the API's own words on failure —
 *  the caller records it on the job so a bad key is visible, not silent. */
export async function transcribe(audio: ArrayBuffer): Promise<Heard> {
  const token = process.env.CLOUDFLARE_AI_TOKEN
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID
  if (!token || !account) throw new Error('CLOUDFLARE_AI_TOKEN / account id not set')
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(`audio is ${Math.round(audio.byteLength / 1024)}KB, over the ${MAX_AUDIO_BYTES / 1024 / 1024}MB limit`)
  }

  const response = await fetch(`${API}/accounts/${account}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio: Buffer.from(audio).toString('base64'),
      task: 'transcribe',
      // The Mac runs whisper behind Silero VAD, and that gate is what makes
      // "no words" mean "nobody spoke" rather than "hallucinated lyrics".
      // Turbo has the same filter; without it a music-only reel invents words.
      vad_filter: true,
    }),
  })

  const body = (await response.json().catch(() => null)) as
    | { result?: { text?: string; word_count?: number; transcription_info?: { language?: string; duration?: number; duration_after_vad?: number } }; errors?: { message?: string }[] }
    | null
  if (!response.ok || !body?.result) {
    const said = body?.errors?.map((e) => e.message).filter(Boolean).join('; ')
    throw new Error(`Workers AI ${response.status}: ${said || 'no result'}`)
  }

  const text = (body.result.text ?? '').trim()
  const info = body.result.transcription_info ?? {}
  return {
    text,
    words: typeof body.result.word_count === 'number' ? body.result.word_count : text.split(/\s+/).filter(Boolean).length,
    language: info.language ?? null,
    seconds: typeof info.duration === 'number' ? info.duration : null,
    voiced: typeof info.duration_after_vad === 'number' ? info.duration_after_vad : null,
  }
}
