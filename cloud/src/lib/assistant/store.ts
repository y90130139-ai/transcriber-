/**
 * The OPS assistant's database side: threads (so a reply is a follow-up) and
 * the log (so every question and its cost can be counted).
 */
import Anthropic from '@anthropic-ai/sdk'
import { sql } from '../db'
import { newId } from '../models'
import { runLoop, splitForTelegram, costCents, LoopError, NO_USAGE, type MessagesClient, type Turn, type Usage } from './core'
import { TOOLS } from './tools'

/** A thread this long is closed; the next question starts a fresh one. */
export const MAX_THREAD_TURNS = 120
export const MAX_QUESTION = 2000

export type Asked = { question: string; chat_id: string; asker: string | null; thread_id: string | null }

export type Answer = { thread_id: string; parts: string[]; cost_cents: number; fresh: boolean }

let client: MessagesClient | null = null
function anthropic(): MessagesClient {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
  // One retry and a 2-minute cap per request: with the loop's own deadline this
  // keeps every question inside Vercel's 300s.
  client ??= new Anthropic({ timeout: 120_000, maxRetries: 1 }) as unknown as MessagesClient
  return client
}

type Thread = { id: string; history: Turn[]; fresh: boolean; version: string | null }

async function loadThread(id: string | null, chatId: string): Promise<Thread> {
  if (id) {
    const [row] = await sql.query(
      `select id, messages, updated_at::text version from transcriber.assistant_threads where id = $1 and chat_id = $2`,
      [id, chatId],
    )
    const history = (row?.messages as Turn[] | undefined) ?? null
    if (history && history.length < MAX_THREAD_TURNS) return { id: String(row.id), history, fresh: false, version: String(row.version) }
  }
  const fresh = newId()
  await sql.query(`insert into transcriber.assistant_threads (id, chat_id) values ($1, $2)`, [fresh, chatId])
  return { id: fresh, history: [], fresh: true, version: null }
}

/** Saves the thread only if nobody else saved it since it was loaded: two
 *  people replying to one answer at once both get answered, and the first to
 *  finish keeps the thread (the other's turn is simply not remembered). */
async function saveThread(thread: Thread, messages: Turn[]) {
  await sql.query(
    `update transcriber.assistant_threads set messages = $2, updated_at = now()
      where id = $1 and ($3::text is null or updated_at::text = $3)`,
    [thread.id, JSON.stringify(messages), thread.version],
  )
}

async function log(row: {
  id: string; thread_id: string | null; chat_id: string; asker: string | null; question: string
  answer?: string | null; tools?: unknown; usage: Usage; ms: number; stop?: string | null; error?: string | null
}) {
  const u = row.usage
  await sql.query(
    `insert into transcriber.assistant_log
       (id, thread_id, chat_id, asker, question, answer, tools, input_tokens, output_tokens,
        cache_read, cache_write, cost_cents, ms, stop, error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [row.id, row.thread_id, row.chat_id, row.asker, row.question, row.answer ?? null, JSON.stringify(row.tools ?? []),
     u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens, costCents(u),
     row.ms, row.stop ?? null, row.error ?? null],
  )
}

export async function ask(input: Asked): Promise<Answer> {
  const started = Date.now()
  const api = anthropic() // fails before anything is written when the key is missing
  const thread = await loadThread(input.thread_id, input.chat_id)
  const base = { id: newId(), thread_id: thread.id, chat_id: input.chat_id, asker: input.asker, question: input.question }
  try {
    const result = await runLoop(api, TOOLS, thread.history, input.question.slice(0, MAX_QUESTION))
    await saveThread(thread, result.messages)
    await log({ ...base, answer: result.text, tools: result.calls, usage: result.usage, ms: Date.now() - started, stop: result.stop })
    const prefix = input.thread_id && thread.fresh ? '(That conversation got long, so this is a fresh one.)\n\n' : ''
    return { thread_id: thread.id, parts: splitForTelegram(prefix + result.text), cost_cents: costCents(result.usage), fresh: thread.fresh }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const spent = error instanceof LoopError ? error : null
    await log({ ...base, tools: spent?.calls, usage: spent?.usage ?? NO_USAGE, ms: Date.now() - started, error: message.slice(0, 500) })
    throw error
  }
}

/** What /q usage shows: questions and spend today, this week, this month. */
export async function usage() {
  const rows = await sql.query(
    `select
       count(*) filter (where created_at > date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York')::int today_n,
       coalesce(sum(cost_cents) filter (where created_at > date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York'), 0) today_c,
       count(*) filter (where created_at > now() - interval '7 days')::int week_n,
       coalesce(sum(cost_cents) filter (where created_at > now() - interval '7 days'), 0) week_c,
       count(*) filter (where created_at > now() - interval '30 days')::int month_n,
       coalesce(sum(cost_cents) filter (where created_at > now() - interval '30 days'), 0) month_c,
       count(*) filter (where error is not null and created_at > now() - interval '7 days')::int week_errors
     from transcriber.assistant_log`,
  )
  const r = rows[0]
  const line = (label: string, n: unknown, c: unknown) => `${label}: ${Number(n)} question${Number(n) === 1 ? '' : 's'}, $${(Number(c) / 100).toFixed(2)}`
  return [
    '🧮 Assistant usage',
    line('Today', r.today_n, r.today_c),
    line('Last 7 days', r.week_n, r.week_c),
    line('Last 30 days', r.month_n, r.month_c),
    ...(Number(r.week_errors) ? [`⚠️ ${Number(r.week_errors)} failed in the last 7 days`] : []),
  ].join('\n')
}
