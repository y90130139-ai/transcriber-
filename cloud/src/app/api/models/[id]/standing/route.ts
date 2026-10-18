import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { loadStanding } from '@/lib/standing'

type Params = { params: Promise<{ id: string }> }

const PRIORITIES = ['S', 'A', 'B', 'C', 'D']
const BANDS = ['high', 'mid', 'low']

/** One model's standing, with the breakdown behind it. */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const standing = (await loadStanding(id)).get(id)
  if (!standing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ standing })
}

/**
 * Set her priority or her revenue band. Saved on its own, not through the
 * profile's Save, because it is a decision rather than a detail — and so an
 * unsaved profile edit is never needed to record it.
 *
 * `null` clears either. A field left out of the body is left alone.
 */
export async function PUT(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key)
  const read = (key: string, allowed: string[]) =>
    body[key] === null ? null : allowed.includes(body[key]) ? String(body[key]) : undefined

  const priority = has('priority') ? read('priority', PRIORITIES) : undefined
  const band = has('revenue_band') ? read('revenue_band', BANDS) : undefined
  if ((has('priority') && priority === undefined) || (has('revenue_band') && band === undefined)) {
    return NextResponse.json({ error: 'priority is S/A/B/C, revenue_band is high/mid/low' }, { status: 400 })
  }

  const [row] = await sql.query(
    `update transcriber.models
        set priority        = case when $2::bool then $3::text else priority end,
            priority_set_at = case when $2::bool then now() else priority_set_at end,
            revenue_band    = case when $4::bool then $5::text else revenue_band end,
            revenue_set_at  = case when $4::bool then now() else revenue_set_at end
      where id = $1
      returning id`,
    [id, has('priority'), priority ?? null, has('revenue_band'), band ?? null],
  )
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const standing = (await loadStanding(id)).get(id)
  return NextResponse.json({ standing })
}
