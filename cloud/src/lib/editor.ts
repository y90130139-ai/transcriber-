/**
 * The editor's queue — Edit Reskins and Trial Reels.
 *
 * Both are the manual's Double Down system applied to a clip that already
 * exists, so neither needs her to film anything and neither belongs in her
 * 21-card week (at up to 105 trial reels a week they would bury it):
 *
 *   Edit Reskin   the same winning clip, re-cut, reposted every 3 days —
 *                 one of the manual's eight edit moves each time
 *   Trial Reel    5 differently edited versions of a winner, posted as trial
 *                 reels, batch-posting allowed
 *
 * The queue is generated from her Winners Bank and is idempotent: a winner
 * gets each move once, keyed on (model, post, kind, move).
 */
import { nanoid } from 'nanoid'
import { sql } from './db'
import { addDays, todayIn } from './dates'
import { bankFor } from './bank'
import { linksFor, mediaBase } from './media'

/** The manual's specific edit moves, in the order it lists them. */
export const EDIT_MOVES = [
  'Start the clip from a different moment — not the same opening',
  'Use a different first frame, a different way in',
  'Tighten or extend one section so the pacing changes',
  'Remove or swap a small segment so the flow feels different',
  'Swap the order of two quick moments, if it still makes sense',
  'Swap the sound for one with the same vibe',
  'Rewrite the on-screen hook text, same concept',
  'End it differently — a different last frame, or cut earlier',
] as const

/** Every 3 days, the manual's edit-reskin cadence. */
export const EDIT_EVERY_DAYS = 3

/** Five edited versions per winner, posted as trial reels. */
export const TRIALS_PER_WINNER = 5

/** Trial reels a day at each stage of the manual's progressive rollout. */
export const TRIAL_STAGE_PER_DAY = [5, 10, 15] as const

export type EditorTask = {
  id: string
  source_post: string
  source_url: string
  /** The clip itself, off the Mac, for the batcher. Null when the Mac is
   *  asleep or the reel never made it into the library — every one of these
   *  tasks is "re-cut this video", so a task with no video to open is the one
   *  thing the queue must not pretend it has. */
  download: string | null
  kind: 'edit' | 'trial'
  move: string
  due_date: string
  done: boolean
}

export type EditorQueue = {
  model_id: string
  stage: number
  trials_per_day: number
  tasks: EditorTask[]
  added: number
}

/** Top up the queue from her current winners, then return it. */
export async function editorQueueFor(modelId: string): Promise<EditorQueue | null> {
  const bank = await bankFor(modelId)
  if (!bank) return null
  const [model] = await sql.query(`select trial_stage, timezone from transcriber.models where id = $1`, [modelId])
  const stage = Math.min(Math.max(Number(model?.trial_stage ?? 1), 1), TRIAL_STAGE_PER_DAY.length)
  const today = todayIn(String(model?.timezone ?? 'America/New_York'))

  const rows: { id: string; post: string; kind: string; move: string; due: string }[] = []
  for (const winner of bank.winners) {
    EDIT_MOVES.forEach((move, index) => {
      rows.push({ id: nanoid(12), post: winner.post_id, kind: 'edit', move, due: addDays(today, index * EDIT_EVERY_DAYS) })
    })
    for (let n = 1; n <= TRIALS_PER_WINNER; n += 1) {
      rows.push({
        id: nanoid(12), post: winner.post_id, kind: 'trial',
        move: `Trial version ${n} of ${TRIALS_PER_WINNER} — a different cut from the other four`,
        due: today,
      })
    }
  }

  let added = 0
  if (rows.length > 0) {
    const inserted = await sql.query(
      `insert into transcriber.editor_tasks (id, model_id, source_post, kind, move, due_date)
       select x.id, $1, x.post, x.kind, x.move, x.due::date
         from jsonb_to_recordset($2::jsonb) as x(id text, post text, kind text, move text, due text)
       on conflict (model_id, source_post, kind, move) do nothing
       returning id`,
      [modelId, JSON.stringify(rows)],
    )
    added = inserted.length
  }

  const tasks = await sql.query(
    `select id, source_post, kind, move, to_char(due_date, 'YYYY-MM-DD') as due_date,
            (done_at is not null) as done
       from transcriber.editor_tasks
      where model_id = $1
      order by (done_at is not null), due_date, kind, move`,
    [modelId],
  )

  // The folder each winner's clip lives in on the Mac, keyed by shortcode.
  // Matched on the job's source URL, the same way `hers.ts` binds her posts:
  // the shortcode is what both sides agree on.
  const base = await mediaBase()
  const folders = new Map<string, string>()
  if (base && tasks.length > 0) {
    const codes = [...new Set(tasks.map((task) => String(task.source_post)))]
    const rows = await sql.query(
      `select x.code, t.folder
         from unnest($1::text[]) as x(code)
         join transcriber.jobs j on j.source like '%/' || x.code || '/%'
         join transcriber.transcripts t on t.job_id = j.id
        where t.folder is not null`,
      [codes],
    )
    for (const row of rows) folders.set(String(row.code), String(row.folder))
  }

  return {
    model_id: modelId,
    stage,
    trials_per_day: TRIAL_STAGE_PER_DAY[stage - 1],
    added,
    tasks: tasks.map((task) => ({
      id: String(task.id),
      source_post: String(task.source_post),
      source_url: `https://www.instagram.com/reel/${task.source_post}/`,
      download: base && folders.has(String(task.source_post))
        ? linksFor(base, folders.get(String(task.source_post))!).download
        : null,
      kind: task.kind === 'trial' ? 'trial' : 'edit',
      move: String(task.move),
      due_date: String(task.due_date),
      done: Boolean(task.done),
    })),
  }
}
