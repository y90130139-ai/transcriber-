import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { isValidTag } from '@/lib/taxonomy'

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

/**
 * The team's own formats — the queue's "+ make a new format". They sit
 * beside the taxonomy's in every format dropdown; the taxonomy stays the
 * curated list, these are the working vocabulary. Tags written with them
 * are ordinary `format` tags, so filters and matching see them like any.
 */
export async function GET() {
  if (!(await isSignedIn())) return unauthorized()
  const rows = await sql.query(
    `select id, label from transcriber.custom_formats order by lower(label)`,
  )
  return NextResponse.json({ formats: rows })
}

export async function POST(request: Request) {
  if (!(await isSignedIn())) return unauthorized()
  const body = await request.json().catch(() => ({}))
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : ''
  if (!label) return NextResponse.json({ error: 'name the format' }, { status: 400 })

  // The id is the tag that gets written: the label, kebab-cased the same way
  // the taxonomy's own ids are.
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (!id) return NextResponse.json({ error: 'name the format' }, { status: 400 })
  if (isValidTag('format', id)) {
    return NextResponse.json({ error: 'that format already exists in the taxonomy' }, { status: 409 })
  }

  const [row] = await sql.query(
    `insert into transcriber.custom_formats (id, label) values ($1, $2)
     on conflict (id) do update set label = excluded.label
     returning id, label`,
    [id, label],
  )
  return NextResponse.json({ format: row })
}
