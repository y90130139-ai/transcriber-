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
                <a href={task.source_url} target="_blank" rel="noreferrer">the winner</a>
                <span className="hint"> — {task.move} </span>
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
