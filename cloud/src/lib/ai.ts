/**
 * One way to ask the model, shared by everything that writes or looks.
 *
 * Same account, token and model the persona profiler has used since it was
 * built — Workers AI, whose free daily allowance is shared with the Whisper
 * failover. So every caller here is on demand and capped, never a sweep over
 * the whole roster, and every caller survives this returning nothing.
 */
const MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'
const API = 'https://api.cloudflare.com/client/v4'

/** For writing: text only, and follows a long list of rules far better than the
 *  small vision model — measured on the caption engine, whose first runs
 *  ignored "never a compliment" three times out of three. */
export const WRITER_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

export function aiReady(): boolean {
  return Boolean(process.env.CLOUDFLARE_AI_TOKEN && (process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID))
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

/** Ask, and return the first JSON object in the answer — or null. */
export async function askJson<T>(
  text: string,
  options: { images?: string[]; maxTokens?: number; temperature?: number; model?: string } = {},
): Promise<T | null> {
  if (!aiReady()) return null
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID
  const content: Part[] = [
    { type: 'text', text },
    ...(options.images ?? []).map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ]
  const response = await fetch(`${API}/accounts/${account}/ai/run/${options.model ?? MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content }],
      max_tokens: options.maxTokens ?? 500,
      temperature: options.temperature ?? 0.4,
    }),
  })
  if (!response.ok) throw new Error(`Workers AI ${response.status}: ${(await response.text()).slice(0, 160)}`)
  const body = (await response.json()) as { result?: { choices?: { message?: { content?: string } }[]; response?: string } }
  const said = body.result?.choices?.[0]?.message?.content ?? body.result?.response ?? ''
  const match = /\{[\s\S]*\}/.exec(String(said).replace(/```json|```/g, ''))
  if (!match) return null
  try {
    return JSON.parse(match[0]) as T
  } catch {
    return null
  }
}
