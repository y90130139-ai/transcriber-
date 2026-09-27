import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { workingWeek, type WeekRef } from '@/lib/carry'
import { addDays, currentWeekOf } from '@/lib/dates'
import { sql } from '@/lib/db'
import { linksFor, mediaBase } from '@/lib/media'
import { appendItems, newId } from '@/lib/models'

/**
 * The two things a winner of hers can become.
 *
 * A reel that popped is not one decision, it is two, and until now the console
 * offered neither on the post itself:
 *
 *   recreate   she shoots it again — a reskin card on her week, the control
 *              rung of the ladder, her own opening quoted back to her
 *   repurpose  we repost it ourselves — the file comes down, goes through the
 *              batcher that rewrites its metadata, and goes out again on trial
 *              reels or the main feed
 *
 * They are independent on purpose. The same winner can be worth her filming
 * again *and* worth reposting, and which of those happened is worth knowing
 * later when a reel's numbers are read.
 */
type Params = { params: Promise<{ id: string; postId: string }> }

const DESTINATIONS = new Set(['trial', 'main', 'both'])

/** The last day of the week the plan belongs to. Same as creating one. */
const DUE_OFFSET_DAYS = 6

export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, postId } = await params
  const body = await request.json().catch(() => ({}))
  const action = typeof body.action === 'string' ? body.action : ''

  // `postId` is the job id the strip already renders — her post is in the
  // library, which is what makes either action possible at all.
  const [post] = await sql.query(
    `select j.id, j.status, t.webpage_url, t.folder, t.author
       from transcriber.jobs j
       join transcriber.transcripts t on t.job_id = j.id
      where j.id = $1`,
    [postId],
  )
  if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (action === 'recreate') return recreate(id, post, body.plan_id)
  if (action === 'repurpose') return repurpose(id, post, body, body.plan_id)
  if (action === 'unrepurpose') {
    await sql.query(`delete from transcriber.repurposes where post_id = $1`, [String(post.id)])
    return NextResponse.json({ repurposed: false })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

/**
 * Put it on her week as a reskin.
 *
 * The control rung, deliberately: this is Geno saying "this one worked, shoot
 * it again", and a control is the version that says so without changing
 * anything. The ladder's variants are the planner's job on Sunday, not a
 * side-effect of one tap here.
 *
 * Onto the week the editor has open when it names one (`plan_id`); from the
 * profile, which has no week open, onto `workingWeek`. It used to be this
 * week, always — so late in a week the card landed on a plan about to end
 * while next week's sat open beside it. A sent week is left alone — the same
 * rule `draftWeek` follows: a card appearing on a plan she has already opened
 * is a card nobody reviewed.
 */
async function recreate(modelId: string, post: Record<string, unknown>, askedPlan: unknown) {
  const target = await recreateTarget(modelId, askedPlan)
  if ('error' in target) return NextResponse.json({ error: target.error }, { status: target.status })
  const { planId, weekOf } = target

  const added = await appendItems(planId, modelId, [String(post.id)], () => ({
    bucket: 'reskin',
    axis: null,
    source_post: shortcodeOf(post.webpage_url as string | null),
    source_url: (post.webpage_url as string | null) ?? null,
    hold: 'Nothing changes. This one worked — shoot it again exactly as it was.',
  }))

  return NextResponse.json({ added, plan_id: planId, week_of: weekOf })
}

type Target = { planId: string; weekOf: string } | { error: string; status: number }

async function recreateTarget(modelId: string, askedPlan: unknown): Promise<Target> {
  if (typeof askedPlan === 'string' && askedPlan) {
    const [plan] = await sql.query(
      `select id, status, to_char(week_of, 'YYYY-MM-DD') as week_of
         from transcriber.plans where id = $1 and model_id = $2`,
      [askedPlan, modelId],
    )
    if (!plan) return { error: 'That week is gone. Reopen the plan and try again.', status: 404 }
    if (String(plan.status) !== 'draft') {
      return { error: 'That week is already sent. Open a draft week and add it there.', status: 409 }
    }
    return { planId: String(plan.id), weekOf: String(plan.week_of) }
  }

  const [model] = await sql.query(`select timezone from transcriber.models where id = $1`, [modelId])
  const weeks = (await sql.query(
    `select id, to_char(week_of, 'YYYY-MM-DD') as week_of, status
       from transcriber.plans where model_id = $1`,
    [modelId],
  )) as WeekRef[]
  const pick = workingWeek(weeks, currentWeekOf(String(model?.timezone ?? 'America/New_York')))
  if (pick.kind === 'existing') return { planId: pick.id, weekOf: pick.week_of }

  const [made] = await sql.query(
    `insert into transcriber.plans (id, model_id, week_of, due_date)
     values ($3, $1, $2::date, $4::date)
     on conflict (model_id, week_of) do update set updated_at = now()
     returning id, status`,
    [modelId, pick.week_of, newId(), addDays(pick.week_of, DUE_OFFSET_DAYS)],
  )
  if (String(made.status) !== 'draft') {
    return { error: 'Their next week is already sent. Open a draft week and add it there.', status: 409 }
  }
  return { planId: String(made.id), weekOf: pick.week_of }
}

/**
 * Mark it ours to repost, and hand back the file.
 *
 * The download is the whole point — the batcher needs the actual video — so a
 * repurpose that cannot produce one says so rather than recording an intention
 * nobody can act on. The Mac holds the files, so this needs the Mac awake.
 */
async function repurpose(modelId: string, post: Record<string, unknown>, body: Record<string, unknown>, askedPlan: unknown) {
  const destination = typeof body.destination === 'string' && DESTINATIONS.has(body.destination)
    ? body.destination
    : 'trial'

  const folder = post.folder as string | null
  const base = folder ? await mediaBase() : null
  const download = base && folder ? linksFor(base, folder).download : null

  await sql.query(
    `insert into transcriber.repurposes (post_id, model_id, job_id, destination, note)
     values ($1, $2, $3, $4, $5)
     on conflict (post_id) do update
        set destination = excluded.destination, note = excluded.note, created_at = now()`,
    [
      String(post.id),
      modelId,
      String(post.id),
      destination,
      typeof body.note === 'string' ? body.note.slice(0, 500) : null,
    ],
  )

  // On her week too, labelled Repurpose (2026-09-27): she saves it and posts
  // it again, no filming. Same week rule as Recreate. A week that cannot take
  // it (already sent) still leaves the repost marked and the file downloading.
  const target = await recreateTarget(modelId, askedPlan)
  const onWeek = 'error' in target
    ? { added: 0, week_of: null, week_note: target.error }
    : {
        added: await appendItems(target.planId, modelId, [String(post.id)], () => ({
          bucket: 'repurpose',
          axis: null,
          source_post: shortcodeOf(post.webpage_url as string | null),
          source_url: (post.webpage_url as string | null) ?? null,
          hold: 'Nothing to film. Save it and post it again this week.',
        })),
        week_of: target.weekOf,
        week_note: null,
      }

  return NextResponse.json({
    repurposed: true,
    ...onWeek,
    destination,
    download,
    // Said plainly rather than returning a dead link: the video lives on the
    // Mac, and a sleeping Mac is the one reason this comes back empty.
    note: download ? null : 'Marked, but the Mac is offline so there is no file to download yet.',
  })
}

/** The shortcode in an Instagram URL — what `plan_items.source_post` holds. */
function shortcodeOf(url: string | null): string | null {
  const match = /\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/.exec(url ?? '')
  return match ? match[1] : null
}
