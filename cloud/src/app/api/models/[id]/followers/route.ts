import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { newId } from '@/lib/models'
import { isPlatform, readCount } from '@/lib/socials'

type Params = { params: Promise<{ id: string }> }

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })

/** Enough readings to draw a line and see a trend, not enough to be a report.
 *  Per platform, so a model on five accounts still gets a full year each. */
const KEEP = 52

/**
 * Her reach over time, per account.
 *
 * Readings rather than a number. The question worth asking is not how big she
 * is but whether the weeks we plan are moving her, and that needs two readings
 * with a date between them. Until Instagram's App Review clears these are typed
 * in by hand and stamped `manual`; when Insights lands it writes rows here with
 * `source = 'insights'` and nothing else in the app has to change.
 */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  const readings = await sql.query(
    `select id, platform, followers::int as followers, source, taken_at
       from transcriber.model_followers
      where model_id = $1
      order by taken_at desc
      limit ${KEEP * 4}`,
    [id],
  )

  return NextResponse.json({ readings })
}

/** Record one reading. Never an update — the history is the point, so a
 *  correction is a new row and a mistake is deleted rather than overwritten. */
export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const platform = isPlatform(body.platform) ? body.platform : null
  if (!platform) return NextResponse.json({ error: 'which account?' }, { status: 400 })

  // "128.4k" and "1,284" are both what a phone screen actually says, so both
  // are read rather than rejected — retyping a number you can see is exactly
  // the friction that stops the reading being taken at all.
  const followers = readCount(body.followers)
  if (followers === null) {
    return NextResponse.json({ error: 'that is not a follower count' }, { status: 400 })
  }

  const [model] = await sql.query(`select id from transcriber.models where id = $1`, [id])
  if (!model) return notFound()

  const [reading] = await sql.query(
    `insert into transcriber.model_followers (id, model_id, platform, followers, source)
     values ($1, $2, $3, $4, 'manual')
     returning id, platform, followers::int as followers, source, taken_at`,
    [newId(), id, platform, followers],
  )
  return NextResponse.json({ reading })
}

/** Drop one reading — a mistyped figure, which would otherwise bend the line
 *  for good. `?reading=` rather than a body, because a DELETE with one is not
 *  something every client sends. */
export async function DELETE(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params
  const reading = new URL(request.url).searchParams.get('reading')
  if (!reading) return NextResponse.json({ error: 'which reading?' }, { status: 400 })

  await sql.query(
    `delete from transcriber.model_followers where id = $1 and model_id = $2`,
    [reading, id],
  )
  return NextResponse.json({ ok: true })
}
