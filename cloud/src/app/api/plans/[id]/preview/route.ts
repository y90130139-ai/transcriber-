import { NextResponse } from 'next/server'
import { guardAccess } from '@/lib/access'
import { loadPlanPreview } from '@/lib/preview'

type Params = { params: Promise<{ id: string }> }

/**
 * One plan in her page's own shape, for the console's preview pane.
 *
 * Console session only — this is the one route that reads a plan by id without
 * a token, so the gate is the first thing in it. Her own `/api/plan/[token]`
 * is unchanged and still the only token-addressable read.
 *
 * It returns a draft as readily as a sent week, which is the entire reason it
 * exists: `loadPlan` shows only what she is entitled to see *now*, and the
 * preview's job is to show what she *will* see once it goes out.
 */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied

  const { id } = await params
  const payload = await loadPlanPreview(id)
  if (!payload) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } })
}
