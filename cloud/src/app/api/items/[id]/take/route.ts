import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { presignGet, r2Config } from '@/lib/r2'

type Params = { params: Promise<{ id: string }> }

/**
 * The team watching her take (Geno, 2026-10-12): a presigned read of the R2
 * object the app uploaded. A redirect, not a JSON envelope — the click goes
 * straight to the video.
 */
export async function GET(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const [row] = await sql.query(`select take_key from transcriber.plan_items where id = $1`, [id])
  const config = r2Config()
  if (!row?.take_key || !config) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.redirect(presignGet(config, String(row.take_key)))
}
