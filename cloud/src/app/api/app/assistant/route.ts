import { NextResponse } from 'next/server'
import { modelSessionFrom } from '@/lib/model-auth'
import { rateLimit } from '@/lib/ratelimit'
import { chatWithStudio, studioAssistantReady, MAX_CHARS, MAX_TURNS } from '@/lib/studio-assistant'
import type { AzureMessage } from '@/lib/azure-ai'

/**
 * Her studio assistant (Geno, 2026-10-13): the app sends the last few turns,
 * Azure Foundry answers from the studio playbook. The key never leaves the
 * server.
 */

export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit(`app-assistant:${session.accountId}`, 30)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }

  const body = await request.json().catch(() => null)
  const raw = Array.isArray(body?.messages) ? (body.messages as unknown[]) : null
  if (!raw) return NextResponse.json({ error: 'nothing asked' }, { status: 400 })

  const messages: AzureMessage[] = raw
    .slice(-MAX_TURNS)
    .map((one) => {
      const entry = one as { role?: unknown; content?: unknown }
      const role = entry?.role === 'user' ? 'user' : entry?.role === 'assistant' ? 'assistant' : null
      const content = typeof entry?.content === 'string' ? entry.content.trim().slice(0, MAX_CHARS) : ''
      return role && content ? { role, content } : null
    })
    .filter((one): one is AzureMessage => one !== null)

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'nothing asked' }, { status: 400 })
  }
  if (!studioAssistantReady()) {
    return NextResponse.json({ error: 'assistant is not configured yet' }, { status: 503 })
  }

  try {
    const reply = await chatWithStudio(messages)
    if (!reply) return NextResponse.json({ error: 'empty answer' }, { status: 502 })
    return NextResponse.json({ ok: true, reply })
  } catch (problem) {
    console.error('[assistant]', problem instanceof Error ? problem.message : problem)
    return NextResponse.json({ error: 'the assistant could not answer just now' }, { status: 502 })
  }
}
