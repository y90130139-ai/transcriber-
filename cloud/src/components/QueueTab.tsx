'use client'

import { useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import Queue from './Queue'
import { StuckList, WaitingList } from './QueueHeld'
import { queueState } from '@/lib/queue-state'
import type { LibraryItem } from '@/lib/format'

export default function QueueTab({
  pending,
  workerOnline,
  onChanged,
  onOpen,
}: {
  pending: LibraryItem[]
  workerOnline: boolean
  onChanged: () => void
  onOpen: (item: LibraryItem) => void
}) {
  const [paste, setPaste] = useState('')
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const inFlight = pending.filter((item) => queueState(item) === 'flight')
  const waiting = pending.filter((item) => queueState(item) === 'viewer')
  const stuck = pending.filter((item) => queueState(item) === 'stuck')

  async function submitLinks() {
    if (!paste.trim()) return
    setBusy(true)
    setNote(null)
    const response = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: paste }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not queue those.', bad: true })
    } else {
      setPaste('')
      const skipped = body.skipped ? `, ${body.skipped} already in the library` : ''
      setNote({ text: `Added ${body.added}${skipped}.` })
      onChanged()
    }
    setBusy(false)
  }

  async function submitFiles(files: File[]) {
    const videos = files.filter((file) => /^(video|audio)\//.test(file.type))
    if (videos.length === 0) {
      setNote({ text: 'Those were not video or audio files.', bad: true })
      return
    }
    setBusy(true)
    setNote({ text: `Uploading ${videos.length} file${videos.length > 1 ? 's' : ''}…` })
    try {
      for (const file of videos) {
        await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/uploads',
        })
      }
      setNote({ text: `Added ${videos.length} file${videos.length > 1 ? 's' : ''}.` })
      onChanged()
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Upload failed.', bad: true })
    }
    setBusy(false)
  }

  return (
    <div
      className="queue-page"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1
        if (dragDepth.current <= 0) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        void submitFiles([...event.dataTransfer.files])
      }}
    >
      {dragging && <div className="dropveil"><span>Drop it</span></div>}

      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title">Queue</h2>
          <p className="dash-sub">
            {pending.length === 0
              ? 'Nothing waiting'
              : `${inFlight.length} in flight · ${waiting.length} waiting · ${stuck.length} stuck`}
          </p>
        </div>
      </header>

      <section className="queue-composer" aria-label="Add to the queue">
        <textarea
          className="queue-input"
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submitLinks()
          }}
          placeholder="Paste links here — as many as you like, mixed in with whatever notes came along with them."
          aria-label="Paste links"
          rows={3}
        />
        <div className="queue-composer-foot">
          <span className="hint" data-tone={note?.bad ? 'bad' : undefined}>
            {note
              ? note.text
              : workerOnline
                ? 'The pass takes about a second; each row says what it heard.'
                : 'Will run when the Mac wakes.'}
          </span>
          <span className="queue-composer-actions">
            <label className="pill">
              Add files
              <input
                type="file"
                accept="video/*,audio/*"
                multiple
                hidden
                onChange={(event) => void submitFiles([...(event.target.files ?? [])])}
              />
            </label>
            <button className="pill" data-primary="true" onClick={submitLinks} disabled={busy || !paste.trim()}>
              {busy ? 'Working' : 'Add'}
            </button>
          </span>
        </div>
      </section>

      <section className="dash-panel" aria-labelledby="queue-flight">
        <header className="dash-panel-head">
          <h2 id="queue-flight">In flight</h2>
          <p>{inFlight.length} item{inFlight.length === 1 ? '' : 's'} downloading or listening</p>
        </header>
        {inFlight.length > 0 ? (
          <Queue items={inFlight} onOpen={onOpen} onChanged={onChanged} />
        ) : (
          <p className="dash-empty">Nothing downloading right now.</p>
        )}
      </section>

      <WaitingList items={waiting} onOpen={onOpen} />
      <StuckList items={stuck} onOpen={onOpen} onChanged={onChanged} />
    </div>
  )
}
