'use client'

import { useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import Queue from './Queue'
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

      <section className="well">
        <textarea
          className="well-input"
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submitLinks()
          }}
          placeholder="Paste links here — as many as you like, mixed in with whatever notes came along with them."
          aria-label="Paste links"
          rows={3}
        />
        <div className="well-actions">
          <button className="btn" onClick={submitLinks} disabled={busy || !paste.trim()}>
            {busy ? 'Working' : 'Add'}
          </button>
          <label className="btn btn-quiet" style={{ textAlign: 'center' }}>
            Add files
            <input
              type="file"
              accept="video/*,audio/*"
              multiple
              hidden
              onChange={(event) => void submitFiles([...(event.target.files ?? [])])}
            />
          </label>
          {note && <span className="hint" data-tone={note.bad ? 'bad' : undefined}>{note.text}</span>}
          {!note && !workerOnline && (
            <span className="hint">These will wait here and run when the Mac wakes.</span>
          )}
          {!note && workerOnline && (
            <span className="hint">
              Everything gets listened to — the pass takes about a second, and each
              row below says what it heard.
            </span>
          )}
        </div>
      </section>

      <div className="section-head">
        <h2>In flight</h2>
        <span className="tally" style={{ color: 'var(--sc-ink-300)' }}>
          {pending.length} item{pending.length === 1 ? '' : 's'}
        </span>
      </div>

      {pending.length > 0 ? (
        <Queue items={pending} onOpen={onOpen} onChanged={onChanged} />
      ) : (
        <div className="empty"><p>Nothing waiting. The queue is clear.</p></div>
      )}
    </div>
  )
}
