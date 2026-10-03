/**
 * The OPS assistant's pure half: the instructions, the tool loop, cost and the
 * Telegram-sized split. No database here (./tools and ./store do that), so the
 * loop is tested with a fake client.
 *
 * Geno, 2026-10-03: anyone in GOSIAN | OPS can ask; the assistant answers in
 * OPS only and never speaks to a creator by itself.
 */
import type Anthropic from '@anthropic-ai/sdk'

export const MODEL = 'claude-opus-5-5'
export const EFFORT = 'medium' as const
/** A question that needs more rounds than this is answered with what it has. */
export const MAX_ROUNDS = 8
/** Stop starting new rounds after this long, so the answer (and its cost)
 *  always lands before Vercel's 300s limit kills the function. */
export const DEADLINE_MS = 180_000
/** A tool result bigger than this is cut, so follow-ups stay affordable. */
export const MAX_TOOL_CHARS = 24_000
/** Telegram's hard limit is 4096; a little under leaves room for a header. */
export const TELEGRAM_LIMIT = 3900

/** Fields that must never reach the model, at any depth. Her access token is
 *  the key to her plan page; revenue band is Geno's alone. */
const FORBIDDEN_KEYS = new Set(['access_token', 'token', 'revenue_band', 'token_revoked_at'])

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !FORBIDDEN_KEYS.has(key))
        .map(([key, v]) => [key, scrub(v)]),
    )
  }
  return value
}

export const SYSTEM_PROMPT = `You are the Gosian Media operations assistant. The people asking you are the internal team in the GOSIAN | OPS Telegram group (Geno owns the agency; Patricia, Dariel and Casey work with him). The creators ("models") never see what you write.

Answer from the tools, not from memory. Every number you give must come from a tool result in this conversation. If no tool can answer, say plainly what you could not find and suggest they use /ask, which relays the question to Geno. A confident wrong answer in a group chat gets believed, so when the data is partial, say what is missing.

How to write: plain text for Telegram, no markdown (no **, no #, no tables). Short lines, lead with the answer, then the detail. Names as the roster spells them. Money is OnlyFans net after the 20% fee, in dollars, unless asked for gross. Times are New York time. When a figure depends on when data was last pulled, say how fresh it is.

Things to keep straight:
- Priority (S/A/B/C) and tier are internal. You may tell the team; models never see them.
- Models film and edit their own videos. Never write "we edit".
- Aurore gets no marketing (no plans, no questionnaire, no campaigns). That is final, not a problem to report.
- A paused or deactivated model is not a gap in the roster; say they are paused if it matters.
- Alerts: when someone asks to be told when something happens, use propose_alert. It is saved only when someone taps Save under your answer; say so in one line. Use list_alerts for "what alerts do we have". Deleting one is done with /q alerts.
- You cannot send messages to models or change anything else yet. If asked to, say so and suggest how the team can do it.`

export type ToolSpec = {
  name: string
  description: string
  input_schema: Anthropic.Tool.InputSchema
  run: (input: Record<string, unknown>) => Promise<unknown>
}

export type ToolCall = { name: string; input: unknown; ms: number; error: string | null }

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** Claude Opus 5.5 list prices, dollars per million tokens. */
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }

export function costCents(u: Usage): number {
  const dollars =
    (u.input_tokens * PRICE.input +
      u.output_tokens * PRICE.output +
      u.cache_read_input_tokens * PRICE.cacheRead +
      u.cache_creation_input_tokens * PRICE.cacheWrite) /
    1_000_000
  return Math.round(dollars * 10_000) / 100
}

export function addUsage(a: Usage, b: Partial<Usage> | null | undefined): Usage {
  return {
    input_tokens: a.input_tokens + (b?.input_tokens ?? 0),
    output_tokens: a.output_tokens + (b?.output_tokens ?? 0),
    cache_read_input_tokens: a.cache_read_input_tokens + (b?.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: a.cache_creation_input_tokens + (b?.cache_creation_input_tokens ?? 0),
  }
}

export const NO_USAGE: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** The part of the SDK client the loop uses, so tests can hand in a fake. */
export type MessagesClient = {
  beta: { messages: { create: (body: Record<string, unknown>) => Promise<AssistantResponse> } }
}

export type AssistantResponse = {
  content: Array<{ type: string; [key: string]: unknown }>
  stop_reason: string | null
  usage?: Partial<Usage>
}

export type Turn = { role: 'user' | 'assistant'; content: unknown }

/** Thrown when the API fails mid-question; carries what was spent so far. */
export class LoopError extends Error {
  readonly usage: Usage
  readonly calls: ToolCall[]
  constructor(message: string, usage: Usage, calls: ToolCall[]) {
    super(message)
    this.usage = usage
    this.calls = calls
  }
}

export function capToolResult(json: string): string {
  if (json.length <= MAX_TOOL_CHARS) return json
  return `${json.slice(0, MAX_TOOL_CHARS)}... [cut: ${json.length - MAX_TOOL_CHARS} more characters. Ask a narrower question, e.g. one model or 7 days.]`
}

export type LoopResult = {
  text: string
  messages: Turn[]
  calls: ToolCall[]
  usage: Usage
  stop: string
}

/** The New York time line put in front of each question, so "today" and "this
 *  week" mean something. Kept out of the system prompt so caching holds. */
export function nowLine(now: number): string {
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(now))
  return `(Now: ${when} New York time.)`
}

function textOf(content: AssistantResponse['content']): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => String(b.text))
    .join('\n')
    .trim()
}

/** Runs one question to an answer. `history` is the thread so far, exactly as
 *  the API returned it (thinking blocks included, never edited). The returned
 *  `messages` are what to save: history plus this exchange, or history alone
 *  when the turn must not be replayed (a refusal, a cut-off answer). */
export async function runLoop(
  client: MessagesClient,
  tools: ToolSpec[],
  history: Turn[],
  question: string,
  { now = Date.now(), deadline = Date.now() + DEADLINE_MS, clock = () => Date.now() } = {},
): Promise<LoopResult> {
  const messages: Turn[] = [...history, { role: 'user', content: `${nowLine(now)}\n\n${question}` }]
  const byName = new Map(tools.map((t) => [t.name, t]))
  const calls: ToolCall[] = []
  let usage = NO_USAGE

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // The last round, or one past the deadline, may not call tools: it must
    // answer with what it has instead of being cut off mid-search.
    const wrapUp = round === MAX_ROUNDS - 1 || clock() > deadline
    let response: AssistantResponse
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: EFFORT },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
        ...(wrapUp ? { tool_choice: { type: 'none' } } : {}),
        messages,
      })
    } catch (error) {
      throw new LoopError(error instanceof Error ? error.message : String(error), usage, calls)
    }
    usage = addUsage(usage, response.usage)

    if (response.stop_reason === 'refusal') {
      return { text: "I can't help with that one. Try /ask to put it to Geno.", messages: history, calls, usage, stop: 'refusal' }
    }
    if (response.stop_reason === 'max_tokens') {
      const text = textOf(response.content)
      return { text: text ? `${text}\n\n(cut off - ask for less at once)` : 'That answer ran too long. Ask for less at once.', messages: history, calls, usage, stop: 'max_tokens' }
    }
    messages.push({ role: 'assistant', content: response.content })
    if (response.stop_reason === 'pause_turn') continue
    if (response.stop_reason !== 'tool_use') {
      const text = textOf(response.content)
      return { text: text || 'I had nothing to say to that. Try asking another way.', messages, calls, usage, stop: String(response.stop_reason) }
    }

    const uses = response.content.filter((b) => b.type === 'tool_use')
    const results = await Promise.all(
      uses.map(async (use) => {
        const started = clock()
        const tool = byName.get(String(use.name))
        try {
          if (!tool) throw new Error(`no tool called ${String(use.name)}`)
          const input = (use.input && typeof use.input === 'object' ? use.input : {}) as Record<string, unknown>
          const out = scrub(await tool.run(input))
          calls.push({ name: String(use.name), input: use.input, ms: clock() - started, error: null })
          return { type: 'tool_result', tool_use_id: use.id, content: capToolResult(JSON.stringify(out) ?? 'null') }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          calls.push({ name: String(use.name), input: use.input, ms: clock() - started, error: message })
          return { type: 'tool_result', tool_use_id: use.id, content: message, is_error: true }
        }
      }),
    )
    messages.push({ role: 'user', content: results })
  }

  // Only reachable if the wrap-up round itself asked for tools anyway.
  return { text: 'That took more digging than I allow for one question. Ask something narrower?', messages: history, calls, usage, stop: 'max_rounds' }
}

/** Splits an answer into Telegram-sized parts on line breaks, never mid-word
 *  unless a single line is longer than the limit. */
export function splitForTelegram(text: string, limit = TELEGRAM_LIMIT): string[] {
  if (text.length <= limit) return [text]
  const parts: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line
    if (candidate.length <= limit) {
      current = candidate
      continue
    }
    if (current) parts.push(current)
    let rest = line
    while (rest.length > limit) {
      const cut = rest.lastIndexOf(' ', limit) > limit / 2 ? rest.lastIndexOf(' ', limit) : limit
      parts.push(rest.slice(0, cut))
      rest = rest.slice(cut).trimStart()
    }
    current = rest
  }
  if (current) parts.push(current)
  return parts
}
