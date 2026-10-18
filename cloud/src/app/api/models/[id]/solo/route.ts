import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })

/**
 * Whether she films alone. On for everyone (2026-09-27): a solo model is never
 * given a reel that needs someone else on camera, and any already on her week
 * that she has not taken on are folded off her page. Its own route rather than
 * another numbered slot in the profile save — that query's placeholders are
 * what stand between a typo and a rotated share link.
 */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const [row] = await sql.query(`select solo from transcriber.models where id = $1`, [id])
  return row ? NextResponse.json({ solo: row.solo !== false }) : notFound()
}

export async function PUT(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (typeof body?.solo !== 'boolean') return NextResponse.json({ error: 'solo must be true or false' }, { status: 400 })
  const [row] = await sql.query(
    `update transcriber.models set solo = $2, updated_at = now() where id = $1 returning solo`,
    [id, body.solo],
  )
  return row ? NextResponse.json({ solo: row.solo }) : notFound()
}
