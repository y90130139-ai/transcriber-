import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { addDays, currentWeekOf } from '@/lib/dates'
import { newId, readWeekOf } from '@/lib/models'

type Params = { params: Promise<{ id: string }> }

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })

/** The last day of the week the plan belongs to — same rule as POST /api/plans. */
const DUE_OFFSET_DAYS = 6

/**
 * Copy a week's cards onto another creator's week (Geno, 2026-10-12).
 *
 * The dialog picks the creator and the week; every card comes over as
 * content — title, directions, wardrobe, hook, caption, editing notes,
 * location, the style tag and the reference video — with fresh ids and
 * numbers. The target week is created when it does not exist yet, and a
 * video already on that week is skipped rather than doubled. Every card
 * lands as a fresh draft: nothing of her answers (accepts, declines, notes)
 * follows it across.
 */
export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  const body = await request.json().catch(() => ({}))
  const modelId = typeof body.model_id === 'string' ? body.model_id : ''
  if (!modelId) return NextResponse.json({ error: 'model_id is required' }, { status: 400 })

  const [source] = await sql.query(`select id from transcriber.plans where id = $1`, [id])
  if (!source) return notFound()

  const [model] = await sql.query(
    `select id, name, timezone from transcriber.models where id = $1`,
    [modelId],
  )
  if (!model) return NextResponse.json({ error: 'no such model' }, { status: 404 })

  const weekOf = readWeekOf(body.week_of, currentWeekOf(String(model.timezone)))

  const items = await sql.query(
    `select job_id, title, notes, notes_to_model, editing_notes, location, bucket, axis, source, twist,
            style, wardrobe, camera, takes, sound, hook, caption
       from transcriber.plan_items
      where plan_id = $1
      order by position, created_at`,
    [id],
  )

  // Create-or-get, exactly like POST /api/plans: one plan per model per week.
  const [plan] = await sql.query(
    `insert into transcriber.plans (id, model_id, week_of, due_date)
     values ($1, $2, $3::date, $4::date)
     on conflict (model_id, week_of) do update set updated_at = now()
     returning id, model_id, to_char(week_of, 'YYYY-MM-DD') as week_of, status`,
    [newId(), modelId, weekOf, addDays(weekOf, DUE_OFFSET_DAYS)],
  )
  const targetPlanId = String(plan.id)

  const [positionRow, cardNoRow] = await Promise.all([
    sql.query(
      `select coalesce(max(position), -1) as last from transcriber.plan_items where plan_id = $1`,
      [targetPlanId],
    ),
    sql.query(
      `select coalesce(max(i.card_no), 0) as last
         from transcriber.plan_items i
         join transcriber.plans p on p.id = i.plan_id
        where p.model_id = $1`,
      [modelId],
    ),
  ])
  let position = Number(positionRow[0]?.last ?? -1)
  let cardNo = Number(cardNoRow[0]?.last ?? 0)

  let added = 0
  let skipped = 0
  for (const item of items) {
    position += 1
    cardNo += 1
    const [row] = await sql.query(
      `insert into transcriber.plan_items
         (id, plan_id, job_id, position, notes, notes_to_model, editing_notes, title, location, card_no,
          bucket, axis, source, twist, style, wardrobe, camera, takes, sound, hook, caption)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       on conflict do nothing
       returning id`,
      [
        newId(), targetPlanId, item.job_id ?? null, position,
        item.notes ?? null, item.notes_to_model ?? null,
        item.editing_notes ?? null, item.title ?? null, item.location ?? null, cardNo,
        item.bucket ?? null, item.axis ?? null, item.source ?? null, item.twist ?? null, item.style ?? null,
        item.wardrobe ?? null, item.camera ?? null, item.takes ?? null, item.sound ?? null,
        item.hook ?? null, item.caption ?? null,
      ],
    )
    if (row) added += 1
    else {
      // A video already on that week — the same reel is skipped, and its
      // number and slot go back so the copied week stays tight.
      skipped += 1
      position -= 1
      cardNo -= 1
    }
  }

  return NextResponse.json({
    plan,
    model: { id: model.id, name: model.name },
    added,
    skipped,
  })
}
