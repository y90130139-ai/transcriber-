import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { previewBatch, writeBatch } from '@/lib/batch'
import { currentWeekOf } from '@/lib/dates'
import { readWeekOf } from '@/lib/models'

export const maxDuration = 60

/**
 * Build every active model's week, unattended.
 *
 * The console route takes its picks from the client, deliberately, so that
 * what gets written is exactly what a human just looked at. Nobody is looking
 * here, so this one previews and writes in the same pass.
 *
 * **It can only ever produce drafts.** `writeBatch` has no parameter that
 * would send one, and a draft is invisible to the model until a human marks it
 * sent. That is the entire safety argument for letting this run on a timer:
 * the worst outcome is a week of suggestions nobody uses, and topping up an
 * existing week is a no-op per reel because of the unique index.
 *
 * Authenticated with the worker secret rather than a browser session, because
 * the caller is a scheduler on the Mac, not a person.
 */
export async function POST(request: Request) {
  if (!isWorker(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const asked = new URL(request.url).searchParams.get('week')
  const weekOf = readWeekOf(asked, currentWeekOf())

  const batch = await previewBatch(weekOf)
  const picks = batch.rows
    .map((row) => ({ model_id: row.model_id, job_ids: row.picks.map((pick) => pick.job_id) }))
    .filter((row) => row.job_ids.length > 0)

  const result = await writeBatch(weekOf, picks)

  // `short` is the number a model is still missing after the library ran out
  // of things that fit her — usually an unfilled profile, not a dry library.
  // Surfaced here because nobody is watching the screen when this runs.
  return NextResponse.json({
    ...result,
    models: batch.rows.length,
    short: batch.rows.filter((row) => row.short > 0).map((row) => ({ name: row.name, short: row.short })),
  })
}
