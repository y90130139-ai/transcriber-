import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { readOverrides } from '@/lib/models'

type Params = { params: Promise<{ id: string }> }

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })

/**
 * Her own answers for the brief's fields.
 *
 * The lookup tables in `lib/brief.ts` are global, so two creators shooting the
 * same format get byte-identical wardrobe lines. These are the layer in front
 * of them, resolving model override → format default → global default.
 *
 * They are standing facts about her, like standing rules, which is why they are
 * edited from her sheet and not from the plan editor. And they are consulted
 * only while drafting: changing one never rewrites a card that has already been
 * authored.
 */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  const defaults = await sql.query(
    `select format, field, value from transcriber.model_brief_defaults
      where model_id = $1
      order by format, field`,
    [id],
  )
  return NextResponse.json({ defaults })
}

/** Replace her whole set. Sending an empty list clears it. */
export async function PUT(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const [model] = await sql.query(
    `select id, formats from transcriber.models where id = $1`,
    [id],
  )
  if (!model) return notFound()

  // Only a format she actually does, or the catch-all. An override for a format
  // she does not shoot would never resolve and would sit in her sheet looking
  // like it had taken effect.
  const rows = readOverrides(body, (model.formats as string[] | undefined) ?? [])

  await sql.query(`delete from transcriber.model_brief_defaults where model_id = $1`, [id])
  if (rows.length > 0) {
    await sql.query(
      `insert into transcriber.model_brief_defaults (model_id, format, field, value)
       select $1, chosen.format, chosen.field, chosen.value
         from unnest($2::text[], $3::text[], $4::text[]) as chosen(format, field, value)`,
      [id, rows.map((row) => row.format), rows.map((row) => row.field), rows.map((row) => row.value)],
    )
  }

  return NextResponse.json({ defaults: rows })
}
