import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { readActiveChange } from '@/lib/inactive'

type Params = { params: Promise<{ id: string }> }

/**
 * Deactivate a model with a reason, or bring her back (lib/inactive.ts). Its
 * own route, like /solo, so it takes effect on the tap rather than waiting on
 * the profile's Save. Reactivating clears the reason; nothing else changes.
 */
export async function PUT(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const change = readActiveChange(await request.json().catch(() => null))
  if ('error' in change) return NextResponse.json({ error: change.error }, { status: 400 })

  const [row] = change.active
    ? await sql.query(
        `update transcriber.models
            set status = 'active', inactive_reason = null, inactive_note = null, inactive_since = null, updated_at = now()
          where id = $1 returning status, inactive_reason, inactive_note, inactive_since`,
        [id],
      )
    : await sql.query(
        `update transcriber.models
            set status = 'paused', inactive_reason = $2, inactive_note = $3,
                inactive_since = case when status = 'paused' then coalesce(inactive_since, now()) else now() end,
                updated_at = now()
          where id = $1 returning status, inactive_reason, inactive_note, inactive_since`,
        [id, change.reason, change.note],
      )
  return row ? NextResponse.json(row) : NextResponse.json({ error: 'not found' }, { status: 404 })
}
