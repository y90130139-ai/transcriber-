import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { decide } from '@/lib/earnings/queue'

type Params = { params: Promise<{ id: string }> }

/**
 * The bot reporting on one message:
 *   { action: 'shown', ops_message_id }   posted in OPS with buttons
 *   { action: 'approve' }                 Geno tapped Approve → returns what to send, re-checked
 *   { action: 'skip' }                    Geno tapped Skip
 *   { action: 'sent', ok, error? }        delivery result
 */
export async function POST(request: Request, { params }: Params) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const result = await decide(id, body)
  return NextResponse.json(result, { status: result.ok ? 200 : 409 })
}
