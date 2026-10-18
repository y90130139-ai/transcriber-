import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { matchAccount } from '@/lib/earnings/board'

type Params = { params: Promise<{ id: string }> }

const Body = z.object({
  model_id: z.string().min(1).max(64).nullable(),
  /** Her win floor in dollars; null for the $150 default. */
  win_floor: z.number().int().min(0).max(100_000).nullable().optional(),
})

/** Match an Infloww account to a roster model — the mapping every creator
 *  message is checked against before it is sent. */
export async function PATCH(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'model_id (or null) is required' }, { status: 400 })
  const floor = parsed.data.win_floor === undefined || parsed.data.win_floor === null ? null : parsed.data.win_floor * 100
  const ok = await matchAccount(id, parsed.data.model_id, floor)
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: 'no such account' }, { status: 404 })
}
