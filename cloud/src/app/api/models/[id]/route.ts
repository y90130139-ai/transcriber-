import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { MODEL_COLUMNS, linkedOnlyfans, keysForModel, newToken, readModelInput, trashKeys } from '@/lib/models'

type Params = { params: Promise<{ id: string }> }

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })

/** One model, plus every plan she has ever had — old weeks are kept as history. */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  const [model] = await sql.query(
    `select ${MODEL_COLUMNS}, ${linkedOnlyfans('models')} from transcriber.models where id = $1`,
    [id],
  )
  if (!model) return notFound()

  const plans = await sql.query(
    `select p.id, to_char(p.week_of, 'YYYY-MM-DD') as week_of,
            to_char(p.due_date, 'YYYY-MM-DD') as due_date,
            p.title, p.status, p.sent_at,
            count(i.id)::int as items,
            count(i.id) filter (where i.filmed_at is not null)::int as filmed,
            count(i.id) filter (where i.uploaded_at is null and i.r2_purged_at is null)::int as waiting,
            count(i.id) filter (where i.model_note is not null and i.seen_at is null)::int as unread
       from transcriber.plans p
       left join transcriber.plan_items i on i.plan_id = p.id
      where p.model_id = $1
      group by p.id
      order by p.week_of desc`,
    [id],
  )

  // What she has actually turned down, counted. A decline has always carried
  // her reason in prose, which cannot be added up — so three "nowhere to film"
  // in a row read as three bad weeks rather than as one fact about her house.
  // Across every week of hers, not just this one: a constraint is not a mood,
  // and the whole point is to see it accumulate.
  const declines = await sql.query(
    `select i.decline_code as code, count(*)::int as n,
            max(i.declined_at) as last_at
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where p.model_id = $1 and i.declined_at is not null
      group by i.decline_code
      order by count(*) desc, i.decline_code`,
    [id],
  )

  return NextResponse.json({ model, plans, declines })
}

/**
 * Edit the profile, and rotate or revoke the link.
 *
 * `token: 'rotate'` mints a new one and un-revokes; `token: 'revoke'` stamps
 * `token_revoked_at`, after which the old URL 404s like any unknown token.
 */
export async function PUT(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const input = readModelInput(body)
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })

  const rotate = body.token === 'rotate'
  const revoke = body.token === 'revoke'

  // Every placeholder below was renumbered when formats/hooks/wont_do landed.
  // Get this wrong and a live model's share link rotates silently, so the
  // token arguments are deliberately last and counted twice.
  const [model] = await sql.query(
    `update transcriber.models
        set name = $2, handle = $3, photo_url = $4,
            persona = $5::text[], formats = $6::text[], hooks = $7::text[],
            wont_do = $8::text[], status = $9,
            filming_days = $10::int[], weekly_target = $11, timezone = $12,
            standing_rules = $13, notes = $14, tier = $18, place = $19,
            drive_url = $20, delivery_note = $21, ig_account_type = $22,
            creator_type = $24,
            socials = $23::jsonb,
            access_token = case when $15 then $16 else access_token end,
            token_revoked_at = case when $15 then null
                                    when $17 then now()
                                    else token_revoked_at end,
            updated_at = now()
      where id = $1
      returning ${MODEL_COLUMNS}`,
    [
      id, input.name, input.handle, input.photo_url,
      input.persona, input.formats, input.hooks, input.wont_do, input.status,
      input.filming_days, input.weekly_target, input.timezone,
      input.standing_rules, input.notes, rotate, newToken(), revoke,
      // Appended rather than slotted in, for the reason stated above.
      input.tier, input.place,
      input.drive_url, input.delivery_note, input.ig_account_type,
      JSON.stringify(input.socials),
      input.creator_type,
    ],
  )
  if (!model) return notFound()
  return NextResponse.json({ model })
}

/** Remove a model and everything of hers. The R2 objects go on the Mac's list. */
export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  await trashKeys(await keysForModel(id))
  await sql.query(`delete from transcriber.models where id = $1`, [id])
  return NextResponse.json({ ok: true })
}
