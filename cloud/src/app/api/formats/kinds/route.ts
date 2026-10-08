import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { isValidTag } from '@/lib/taxonomy'

/**
 * "What it is", saved (Geno, 2026-10-08): a kind added in the queue's second
 * column is kept per format and offered forever — the same move as "+ Make a
 * new format", one level down. The kind is a label, not a tag: the format
 * carries the tag, the kind names the rows.
 */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const format = typeof body.format === 'string' ? body.format.trim().slice(0, 40) : ''
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : ''
  if (!label) return NextResponse.json({ error: 'name it first' }, { status: 400 })
  const known = format && (
    isValidTag('format', format) ||
    (await sql.query(`select 1 from transcriber.custom_formats where id = $1`, [format])).length > 0
  )
  if (!known) return NextResponse.json({ error: 'pick a format first' }, { status: 400 })

  const [row] = await sql.query(
    `insert into transcriber.format_kinds (id, format, label)
     values ($1, $2, $3)
     on conflict (format, lower(label)) do update set label = excluded.label
     returning id, format, label`,
    [nanoid(12), format, label],
  )
  return NextResponse.json({ kind: row })
}
