/**
 * Where a not-yet-landed job stands, in the queue's words.
 *
 * A "failed" job is usually not broken. Most are reels Instagram would not
 * hand a logged-out downloader; the viewer (src/viewer.py, /api/worker/viewed)
 * opens those signed in and puts them back in the queue on its own. Showing
 * them as red errors made 110 reels that were being handled look like 110
 * problems. Only what the viewer cannot help with needs a person.
 */

/** Tries the viewer gives one reel, a day apart. /api/worker/viewed stops here too. */
export const VIEW_TRIES = 3

/** A link to one post, the only shape the viewer can open. */
const POST_LINK = /\/(reels?|p)\/[A-Za-z0-9_-]+/

type Job = {
  status: string
  source: string
  error: string | null
  view_tries?: number | null
}

export type QueueState = 'flight' | 'viewer' | 'stuck'

export function queueState(job: Job): QueueState {
  if (job.status !== 'failed') return 'flight'
  const blocked = (job.error ?? '').startsWith('could not download')
  const viewable = blocked && POST_LINK.test(job.source)
  return viewable && (job.view_tries ?? 0) < VIEW_TRIES ? 'viewer' : 'stuck'
}

export function waitingLine(job: { view_tries?: number | null }): string {
  const tries = job.view_tries ?? 0
  return tries === 0
    ? 'Next in line for a signed-in look'
    : `Viewer found no video yet · try ${tries} of ${VIEW_TRIES}`
}

export function stuckReason(job: Omit<Job, 'status'>): string {
  const error = job.error ?? ''
  if (!POST_LINK.test(job.source)) return 'A profile link, not a video — add the reel’s own link'
  if (error.includes('photo media')) return 'A photo post — there is no video to transcribe'
  if (error.startsWith('gave up after')) return 'The Mac was interrupted three times — retry it'
  if (error.startsWith('could not download')) return 'No video after three signed-in looks — likely deleted or private'
  return error.split('\n')[0].trim() || 'Failed'
}
