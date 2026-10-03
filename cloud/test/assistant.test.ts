import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  scrub, costCents, splitForTelegram, runLoop, nowLine, capToolResult, LoopError, MODEL, MAX_ROUNDS, MAX_TOOL_CHARS, TELEGRAM_LIMIT,
  type MessagesClient, type AssistantResponse, type ToolSpec,
} from '../src/lib/assistant/core'

function fakeClient(responses: AssistantResponse[]) {
  const bodies: Record<string, unknown>[] = []
  const client: MessagesClient = {
    beta: {
      messages: {
        create: async (body) => {
          bodies.push(structuredClone(body))
          const next = responses.shift()
          if (!next) throw new Error('no more fake responses')
          return next
        },
      },
    },
  }
  return { client, bodies }
}

const text = (t: string): AssistantResponse => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10 } })
const toolUse = (name: string, input: unknown = {}, id = 'tu_1'): AssistantResponse => ({
  content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 5 },
})

const echo: ToolSpec = {
  name: 'roster', description: 'x', input_schema: { type: 'object', properties: {} },
  run: async () => ({ models: [{ name: 'Snow', access_token: 'SECRET', nested: { revenue_band: 'high', ok: 1 } }] }),
}

test('scrub drops tokens and revenue band at any depth and keeps the rest', () => {
  const out = scrub({ a: 1, access_token: 'x', list: [{ token: 't', revenue_band: 'b', name: 'n' }], when: new Date(0) })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { a: 1, list: [{ name: 'n' }], when: new Date(0).toISOString() })
})

test('costCents prices Opus 5.5 input, output and cache', () => {
  assert.equal(costCents({ input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), 400)
  assert.equal(costCents({ input_tokens: 0, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 }), 220)
})

test('a plain answer comes back in one round, with the request shaped right', async () => {
  const { client, bodies } = fakeClient([text('Four models finished.')])
  const r = await runLoop(client, [echo], [], 'who finished?', { now: Date.UTC(2026, 9, 3, 16) })
  assert.equal(r.text, 'Four models finished.')
  assert.equal(r.stop, 'end_turn')
  assert.equal(bodies.length, 1)
  const body = bodies[0]
  assert.equal(body.model, MODEL)
  assert.equal(body.fallbacks, 'default')
  assert.deepEqual(body.betas, ['server-side-fallback-2026-07-01'])
  assert.equal('tool_choice' in body, false, 'forced tool choice is a 400 on Opus 5.5')
  const tools = body.tools as Array<Record<string, unknown>>
  assert.equal('run' in tools[0], false, 'the run function never goes on the wire')
  const msgs = body.messages as Array<{ role: string; content: string }>
  assert.match(msgs[0].content, /^\(Now: Saturday, Oct 3, 2026/)
  assert.match(msgs[0].content, /who finished\?$/)
})

test('tool results are scrubbed before the model sees them, and the loop continues', async () => {
  const { client, bodies } = fakeClient([toolUse('roster'), text('Snow is active.')])
  const r = await runLoop(client, [echo], [], 'roster?')
  assert.equal(r.text, 'Snow is active.')
  assert.equal(r.calls.length, 1)
  assert.equal(r.calls[0].error, null)
  const second = bodies[1].messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
  const result = second.at(-1)!.content[0]
  assert.equal(result.type, 'tool_result')
  assert.equal(result.tool_use_id, 'tu_1')
  assert.doesNotMatch(String(result.content), /SECRET|revenue_band/)
  assert.match(String(result.content), /Snow/)
  assert.deepEqual(r.usage, { input_tokens: 150, output_tokens: 15, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
})

test('a failing or unknown tool becomes an error result, not a crash', async () => {
  const broken: ToolSpec = { ...echo, name: 'model_profile', run: async () => { throw new Error('No model matches "Zed".') } }
  const { client, bodies } = fakeClient([
    { content: [{ type: 'tool_use', id: 'a', name: 'model_profile', input: { name: 'Zed' } }, { type: 'tool_use', id: 'b', name: 'nope', input: {} }], stop_reason: 'tool_use' },
    text('No model called Zed.'),
  ])
  const r = await runLoop(client, [broken], [], 'zed?')
  assert.equal(r.text, 'No model called Zed.')
  const results = (bodies[1].messages as Array<{ content: Array<Record<string, unknown>> }>).at(-1)!.content
  assert.equal(results.length, 2, 'all results go back in one message')
  assert.ok(results.every((x) => x.is_error === true))
  assert.match(String(results[0].content), /Zed/)
  assert.deepEqual(r.calls.map((c) => c.error !== null), [true, true])
})

test('history is kept and appended to, never rewritten', async () => {
  const history = [{ role: 'user' as const, content: 'first' }, { role: 'assistant' as const, content: [{ type: 'text', text: 'one' }] }]
  const { client, bodies } = fakeClient([text('two')])
  const r = await runLoop(client, [echo], history, 'second')
  const sent = bodies[0].messages as unknown[]
  assert.deepEqual(sent.slice(0, 2), history)
  assert.equal(r.messages.length, 4)
  assert.deepEqual(r.messages.slice(0, 2), history)
})

test('a refusal answers politely, points to /ask and is not kept in the thread', async () => {
  const history = [{ role: 'user' as const, content: 'q' }, { role: 'assistant' as const, content: [{ type: 'text', text: 'a' }] }]
  const { client } = fakeClient([{ content: [], stop_reason: 'refusal' }])
  const r = await runLoop(client, [echo], history, 'x')
  assert.equal(r.stop, 'refusal')
  assert.match(r.text, /\/ask/)
  assert.deepEqual(r.messages, history)
})

test('a cut-off answer is shown but not kept in the thread', async () => {
  const { client } = fakeClient([{ content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' }])
  const r = await runLoop(client, [echo], [], 'x')
  assert.match(r.text, /^partial\n\n\(cut off/)
  assert.deepEqual(r.messages, [])
})

test('the last round may not call tools, so the model has to answer', async () => {
  const responses = Array.from({ length: MAX_ROUNDS - 1 }, (_, i) => toolUse('roster', {}, `t${i}`))
  const { client, bodies } = fakeClient([...responses, text('Here is what I found.')])
  const r = await runLoop(client, [echo], [], 'dig')
  assert.equal(r.text, 'Here is what I found.')
  assert.equal(bodies.length, MAX_ROUNDS)
  assert.equal('tool_choice' in bodies[0], false)
  assert.deepEqual(bodies.at(-1)!.tool_choice, { type: 'none' })
})

test('past the deadline the next round wraps up', async () => {
  let t = 0
  const { client, bodies } = fakeClient([toolUse('roster'), text('done')])
  const r = await runLoop(client, [echo], [], 'slow', { deadline: 10, clock: () => (t += 20) })
  assert.equal(r.text, 'done')
  assert.deepEqual(bodies[1].tool_choice, { type: 'none' })
})

test('an API failure mid-question carries what was already spent', async () => {
  const { client } = fakeClient([toolUse('roster')])
  await assert.rejects(runLoop(client, [echo], [], 'x'), (e: unknown) => {
    assert.ok(e instanceof LoopError)
    assert.equal(e.usage.input_tokens, 50)
    assert.equal(e.calls.length, 1)
    return true
  })
})

test('a huge tool result is cut with a hint', () => {
  assert.equal(capToolResult('short'), 'short')
  const cut = capToolResult('x'.repeat(MAX_TOOL_CHARS + 500))
  assert.ok(cut.length < MAX_TOOL_CHARS + 200)
  assert.match(cut, /cut: 500 more characters/)
})

test('splitForTelegram keeps short answers whole and cuts long ones on lines', () => {
  assert.deepEqual(splitForTelegram('hello'), ['hello'])
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n')
  const parts = splitForTelegram(lines)
  assert.ok(parts.length > 1)
  assert.ok(parts.every((p) => p.length <= TELEGRAM_LIMIT))
  assert.equal(parts.join('\n'), lines)
  const giant = 'word '.repeat(2000).trim()
  assert.ok(splitForTelegram(giant).every((p) => p.length <= TELEGRAM_LIMIT))
})

test('nowLine is New York time', () => {
  assert.match(nowLine(Date.UTC(2026, 9, 3, 3, 30)), /Friday, Oct 2, 2026.*11:30 PM/)
})
