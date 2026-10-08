import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { isTemplate } from '@/lib/template'

type Params = { params: Promise<{ id: string }> }

/**
 * Which plan template drives their autodraft — sprint / mix / winning /
 * custom, or null for auto. Its own route, like `solo`: the model form's
 * full-row update should not grow a column the form never shows.
 */
export async function PUT(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const template = isTemplate(body.template) ? body.template : null
  if (body.template && !template) {
    return NextResponse.json({ error: 'not a template' }, { status: 400 })
  }

  const [model] = await sql.query(
    `update transcriber.models set plan_template = $2 where id = $1
     returning id, plan_template`,
    [id, template],
  )
  if (!model) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ id: String(model.id), template: model.plan_template ?? null })
}
