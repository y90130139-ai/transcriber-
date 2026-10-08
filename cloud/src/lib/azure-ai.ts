/**
 * Azure AI Foundry chat — the same deployment the invoice app's forms run on
 * (Geno, 2026-10-08: "use the azure thing from ai-invoice"). The endpoint is
 * the OpenAI-compatible `.../openai/v1` base, so one POST is the whole
 * client; the console ships no OpenAI SDK and this does not add one.
 *
 * Config, from the environment:
 *   AZURE_AI_FOUNDRY_ENDPOINT    e.g. https://<resource>.services.ai.azure.com/openai/v1
 *   AZURE_AI_FOUNDRY_API_KEY
 *   AZURE_AI_FOUNDRY_DEPLOYMENT  default gpt-5.4
 *
 * gpt-5 / o-series deployments reject `max_tokens` and take the completion
 * budget the new way — the invoice app's client makes the same split.
 */

const MAX_OUTPUT_TOKENS = 900
const TIMEOUT_MS = 120_000

export function azureReady(): boolean {
  return Boolean(process.env.AZURE_AI_FOUNDRY_ENDPOINT?.trim() && process.env.AZURE_AI_FOUNDRY_API_KEY?.trim())
}

function isReasoningModel(model: string): boolean {
  return /gpt-5|o1|o3|o4|reasoner/i.test(model)
}

export async function azureChat(system: string, user: string): Promise<string> {
  const base = process.env.AZURE_AI_FOUNDRY_ENDPOINT?.trim().replace(/\/+$/, '')
  const key = process.env.AZURE_AI_FOUNDRY_API_KEY?.trim()
  if (!base || !key) throw new Error('Azure AI Foundry is not configured — set AZURE_AI_FOUNDRY_ENDPOINT and AZURE_AI_FOUNDRY_API_KEY')

  const model = process.env.AZURE_AI_FOUNDRY_DEPLOYMENT?.trim() || 'gpt-5.4'
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }
  if (isReasoningModel(model)) {
    payload.max_completion_tokens = MAX_OUTPUT_TOKENS
  } else {
    payload.max_tokens = MAX_OUTPUT_TOKENS
    payload.temperature = 0.3
  }

  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await response.json().catch(() => null) as {
    error?: { message?: string }
    choices?: { message?: { content?: unknown } }[]
  } | null

  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Azure answered ${response.status}`)
  }

  const content = body?.choices?.[0]?.message?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part as { text?: string })?.text ?? '').join('')
      : ''
  return text.trim()
}
