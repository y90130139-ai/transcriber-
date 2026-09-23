'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatDate } from '@/lib/dates'
import type { EditorQueue } from '@/lib/editor'

/** The editor's work on her winners: edit reskins every 3 days, and trial reels
 *  at her current rollout stage. None of it needs her to film anything. */
export default function EditorTab({ modelId }: { modelId: string }) {
  const [queue, setQueue] = useState<EditorQueue | null>(null)
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}/editor`)
    if (response.ok) setQueue(await response.json())
  }, [modelId])

  useEffect(() => { void load() }, [load])

  async function post(body: Record<string, unknown>) {
    await fetch(`/api/models/${modelId}/editor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    void load()
  }

  if (!queue) return <p className="hint">Building the queue from her winners…</p>
  const open = queue.tasks.filter((task) => !task.done)
  const shown = showDone ? queue.tasks : open

  return (
    <div className="brand">
      <section className="axis">
        <div className="axis-head">
          <span className="axis-name">Trial reels · stage {queue.stage} · {queue.trials_per_day} a day</span>
          <span>
            {[1, 2, 3].map((stage) => (
              <button
                key={stage}
                className="chip"
                data-on={queue.stage === stage}
                onClick={() => post({ action: 'stage', stage })}
              >
                {stage === 1 ? '5' : stage === 2 ? '10' : '15'}/day
              </button>
            ))}
          </span>
        </div>
        <span className="hint">
          Move up a stage once this one is running smoothly. Trial reels can be posted in one batch.
        </span>
      </section>

      <section className="axis">
        <div className="axis-head"><span className="axis-name">What this queue is</span></div>
        <span className="hint">
          Editing work on reels she has <b>already filmed</b> — she films nothing for any of
          this, which is why it is here and not on her week. Each <b>Edit</b> line is her
          winning clip re-cut one way and posted again; the cadence is one every three days.
          Each <b>Trial</b> line is one of five different cuts of the same winner, posted as
          trial reels. <b>Get the video</b> downloads the clip to run through the batcher,
          and <b>Done</b> is you ticking it off once it is posted — that is all Done means,
          and the line then hides unless you show done.
        </span>
      </section>

      <section className="axis">
        <div className="axis-head">
          <span className="axis-name">Queue · {open.length} open</span>
          <button className="axis-confirm" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Hide done' : 'Show done'}
          </button>
        </div>
        {shown.length === 0 ? (
          <span className="hint">
            {queue.tasks.length === 0
              ? 'No winners yet — edit reskins start the week she has a reel past 10× her normal.'
              : 'All done.'}
          </span>
        ) : (
          <ul className="brand-list">
            {shown.map((task) => (
              <li key={task.id}>
                <b>{task.kind === 'edit' ? 'Edit' : 'Trial'}</b>
                <span>{formatDate(task.due_date)} · </span>
                <a href={task.source_url} target="_blank" rel="noreferrer">the winner on Instagram</a>
                <span className="hint"> — {task.move} </span>
                {task.download ? (
                  <a className="axis-confirm" href={task.download}>Get the video</a>
                ) : (
                  <span className="hint" title="The clip lives on the Mac, and the Mac is asleep or never fetched this reel">
                    (no file — Mac offline)
                  </span>
                )}
                <button className="axis-confirm" onClick={() => post({ action: 'done', task_id: task.id, done: !task.done })}>
                  {task.done ? 'Undo' : 'Done'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
