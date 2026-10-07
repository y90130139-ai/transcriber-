import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { newId } from '@/lib/models'
import { isValidTag } from '@/lib/taxonomy'

/**
 * Card templates (Geno, 2026-10-07): the team's own reusable blanks for the
 * plan editor — a label, a format, the directions. "Anytime we add them, it
 * just stays there, and we could edit them if we misspell it by accident."
 */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rows = await sql.query(
    `select id, label, format, body from transcriber.plan_templates order by lower(label)`,
  )
  return NextResponse.json({ templates: rows })
}

function readFields(body: Record<string, unknown>) {
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : ''
  const format = typeof body.format === 'string' && isValidTag('format', body.format) ? body.format : null
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 4000) : null
  return { label, format, text }
}

export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const { label, format, text } = readFields(body)
  if (!label) return NextResponse.json({ error: 'give the template a label' }, { status: 400 })
  const [row] = await sql.query(
    `insert into transcriber.plan_templates (id, label, format, body)
     values ($1, $2, $3, $4) returning id, label, format, body`,
    [newId(), label, format, text],
  )
  return NextResponse.json({ template: row })
}

export async function PATCH(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  const { label, format, text } = readFields(body)
  if (!id || !label) return NextResponse.json({ error: 'id and label are required' }, { status: 400 })
  const [row] = await sql.query(
    `update transcriber.plan_templates
        set label = $2, format = $3, body = $4, updated_at = now()
      where id = $1 returning id, label, format, body`,
    [id, label, format, text],
  )
  if (!row) return NextResponse.json({ error: 'no such template' }, { status: 404 })
  return NextResponse.json({ template: row })
}

export async function DELETE(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  await sql.query(`delete from transcriber.plan_templates where id = $1`, [id])
  return NextResponse.json({ ok: true })
}
