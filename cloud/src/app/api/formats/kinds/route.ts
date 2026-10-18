import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { sql } from '@/lib/db'
import { isValidTag } from '@/lib/taxonomy'

/**
 * "What it is", saved (Geno, 2026-10-08): a kind added in the queue's second
 * column is kept per format and offered forever — the same move as "+ Make a
 * new format", one level down. The kind is a label, not a tag: the format
 * carries the tag, the kind names the rows.
 *
 * A German entry is a playbook template too (Geno, 2026-10-16): it may carry
 * the instructions (body) and the version rows, so the plan editor's German
 * lane prefills the brief from it exactly like the doc's own 57.
 */
export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const body = await request.json().catch(() => ({})) as {
    format?: unknown
    label?: unknown
    body?: unknown
    versions?: { outfit?: unknown; caption?: unknown }[]
  }
  const format = typeof body.format === 'string' ? body.format.trim().slice(0, 40) : ''
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : ''
  if (!label) return NextResponse.json({ error: 'name it first' }, { status: 400 })
  // No format is fine — the kind is then general, offered whatever is picked.
  // A format that IS named has to be a real one, taxonomy or the team's own.
  const known = !format || isValidTag('format', format) ||
    (await sql.query(`select 1 from transcriber.custom_formats where id = $1`, [format])).length > 0
  if (!known) return NextResponse.json({ error: 'not a format' }, { status: 400 })

  // Instructions and versions ride only a German entry: the playbook is the
  // one lane whose entries prefill a brief. Anything else lands them null.
  const text = format === 'german' && typeof body.body === 'string'
    ? body.body.trim().slice(0, 4000) || null
    : null
  const versions = format === 'german' && Array.isArray(body.versions)
    ? body.versions
      .slice(0, 8)
      .map((row) => ({
        outfit: typeof row.outfit === 'string' ? row.outfit.trim().slice(0, 120) : '',
        caption: typeof row.caption === 'string' ? row.caption.trim().slice(0, 240) : '',
      }))
      .filter((row) => row.outfit || row.caption)
    : []
  const versionsJson = versions.length > 0 ? JSON.stringify(versions) : null

  const [row] = await sql.query(
    `insert into transcriber.format_kinds (id, format, label, body, versions)
     values ($1, $2, $3, $4, $5::jsonb)
     on conflict (format, lower(label)) do update
       set label = excluded.label, body = excluded.body, versions = excluded.versions
     returning id, format, label, body, versions`,
    [nanoid(12), format, label, text, versionsJson],
  )
  return NextResponse.json({ kind: row })
}
