import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { linksFor, mediaBase } from '@/lib/media'
import { appendItems, trashKeys } from '@/lib/models'
import { recreateTarget } from '@/lib/week-target'
import { queueRepurposeRender, REPURPOSE_HOLD } from '@/lib/repurpose'

/**
 * The two things a winner of hers can become.
 *
 * A reel that popped is not one decision, it is two, and until now the console
 * offered neither on the post itself:
 *
 *   recreate   she shoots it again — a reskin card on her week, the control
 *              rung of the ladder, her own opening quoted back to her
 *   repurpose  we repost it ourselves — the studio renders a fresh copy
 *              (mirrored, re-cut, re-encoded, metadata scrubbed; see
 *              docs/REPURPOSE.md), it saves to R2, and goes out again on
 *              trial reels or the main feed
 *
 * They are independent on purpose. The same winner can be worth her filming
 * again *and* worth reposting, and which of those happened is worth knowing
 * later when a reel's numbers are read.
 */
type Params = { params: Promise<{ id: string; postId: string }> }

const DESTINATIONS = new Set(['trial', 'main', 'both'])


export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
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
    // The rendered file has no other owner: nothing will reclaim it once this
    // row is gone, so the key goes on the trash list the Mac already works
    // through before the row is deleted (2026-10-18).
    const [held] = await sql.query(
      `select output_key from transcriber.repurposes where post_id = $1`,
      [String(post.id)],
    )
    if (held?.output_key) await trashKeys([String(held.output_key)])
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


/**
 * Mark it ours to repost — and queue the studio render (2026-10-18).
 *
 * The tap used to stop at "marked": a person had to download the reel and
 * drive the batcher by hand. Now the row is queued for the Mac, which renders
 * a fresh copy through `src/repurpose.py`, uploads it to R2 and reports back;
 * the fresh file appears in the Reels tab's Repurposed section. The download
 * link still rides along for anyone who wants the source by hand.
 */
async function repurpose(modelId: string, post: Record<string, unknown>, body: Record<string, unknown>, askedPlan: unknown) {
  const destination = typeof body.destination === 'string' && DESTINATIONS.has(body.destination)
    ? body.destination
    : 'trial'

  const folder = post.folder as string | null
  const base = folder ? await mediaBase() : null
  const download = base && folder ? linksFor(base, folder).download : null

  await queueRepurposeRender({
    modelId,
    jobId: String(post.id),
    destination: destination as 'trial' | 'main' | 'both',
    note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
  })

  // On her week too, labelled Repurpose (2026-09-27): she saves it and posts
  // it again, no filming. Same week rule as Recreate. A week that cannot take
  // it (already sent) still leaves the repost marked and the render queued.
  const target = await recreateTarget(modelId, askedPlan)
  const onWeek = 'error' in target
    ? { added: 0, week_of: null, week_note: target.error }
    : {
        added: await appendItems(target.planId, modelId, [String(post.id)], () => ({
          bucket: 'repurpose',
          axis: null,
          source_post: shortcodeOf(post.webpage_url as string | null),
          source_url: (post.webpage_url as string | null) ?? null,
          hold: REPURPOSE_HOLD,
        })),
        week_of: target.weekOf,
        week_note: null,
      }

  return NextResponse.json({
    repurposed: true,
    ...onWeek,
    destination,
    download,
    render: 'queued',
    // Said plainly rather than returning a dead link: the source video lives
    // on the Mac, and a sleeping Mac is the one reason this comes back empty.
    note: download ? null : 'The Mac is offline, so there is no source file to download yet — the render gets queued either way.',
  })
}

/** The shortcode in an Instagram URL — what `plan_items.source_post` holds. */
function shortcodeOf(url: string | null): string | null {
  const match = /\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/.exec(url ?? '')
  return match ? match[1] : null
}
