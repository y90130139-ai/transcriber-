'use client'

import { useEffect, useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import Queue from './Queue'
import { StuckList, WaitingList } from './QueueHeld'
import { GERMAN_FORMAT_TAG, GERMAN_TYPES, findGerman } from '@/lib/german'
import { queueState } from '@/lib/queue-state'
import { taxonomy } from '@/lib/taxonomy'
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
  /** The three-column composer (Geno, 2026-10-08): what it is, which kind,
   *  then the links or files — so everything arrives already identified. */
  const [format, setFormat] = useState('')
  const [germanNo, setGermanNo] = useState('')
  const [name, setName] = useState('')
  const [customFormats, setCustomFormats] = useState<{ id: string; label: string }[]>([])
  const [newFormat, setNewFormat] = useState<string | null>(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    fetch('/api/formats')
      .then((response) => (response.ok ? response.json() : { formats: [] }))
      .then((body) => setCustomFormats(body.formats ?? []))
      .catch(() => setCustomFormats([]))
  }, [])

  /** "+ Make a new format": saved once, offered forever, tagged like any. */
  async function saveFormat() {
    const label = (newFormat ?? '').trim()
    if (!label) return
    const response = await fetch('/api/formats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not save that format.', bad: true })
      return
    }
    setCustomFormats((current) => {
      const rest = current.filter((entry) => entry.id !== body.format.id)
      return [...rest, body.format].sort((a, b) => a.label.localeCompare(b.label))
    })
    setFormat(String(body.format.id))
    setNewFormat(null)
  }
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
      body: JSON.stringify({
        text: paste,
        format: format || undefined,
        variant: germanNo || undefined,
        name: name || undefined,
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not queue those.', bad: true })
    } else {
      setPaste('')
      const skipped = body.skipped ? `, ${body.skipped} already in the library` : ''
      const as = germanNo && findGerman(germanNo)
        ? ` as German #${germanNo}` : name ? ` as “${name}”` : ''
      setNote({ text: `Added ${body.added}${as}${skipped}.` })
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
          clientPayload: JSON.stringify({
            format: format || undefined,
            variant: germanNo || undefined,
            name: name || undefined,
          }),
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
        {/* Three columns (Geno, 2026-10-08): the format, which kind it is,
            then the links or files — so every row below arrives labeled
            instead of being sorted out later. Both left columns optional:
            a plain paste works exactly as it always did. */}
        <div className="queue-composer-grid">
          <div className="queue-composer-col">
            <label className="axis-name" htmlFor="queue-format">Format</label>
            <select
              id="queue-format"
              className="field"
              value={format}
              onChange={(event) => {
                const picked = event.target.value
                if (picked === '__new') { setNewFormat(''); return }
                setFormat(picked)
                if (picked !== GERMAN_FORMAT_TAG) setGermanNo('')
              }}
            >
              <option value="">No format — label later</option>
              {taxonomy.format.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.label}</option>
              ))}
              {customFormats.length > 0 && (
                <optgroup label="Our own">
                  {customFormats.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.label}</option>
                  ))}
                </optgroup>
              )}
              <option value="__new">+ Make a new format…</option>
            </select>
            {newFormat !== null && (
              <span className="queue-newformat">
                <input
                  className="field"
                  value={newFormat}
                  autoFocus
                  placeholder="Name the format"
                  onChange={(event) => setNewFormat(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void saveFormat() }}
                />
                <button className="pill" onClick={() => void saveFormat()}>Save</button>
                <button className="pill" onClick={() => setNewFormat(null)}>Cancel</button>
              </span>
            )}
          </div>

          <div className="queue-composer-col">
            <label className="axis-name" htmlFor="queue-kind">What it is</label>
            {format === GERMAN_FORMAT_TAG ? (
              <select
                id="queue-kind"
                className="field"
                value={germanNo}
                onChange={(event) => setGermanNo(event.target.value)}
              >
                <option value="">Which German format?</option>
                {GERMAN_TYPES.map((type) => (
                  <optgroup key={type.id} label={type.label}>
                    {type.formats.map((entry) => (
                      <option key={entry.no} value={entry.no}>#{entry.no} · {entry.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <input
                id="queue-kind"
                className="field"
                value={name}
                placeholder="Optional — names every row in this paste"
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </div>

          <div className="queue-composer-col queue-composer-paste">
            <label className="axis-name" htmlFor="queue-paste">Links or files</label>
            <textarea
              id="queue-paste"
              className="queue-input"
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submitLinks()
              }}
              placeholder="Paste links here — as many as you like, mixed in with whatever notes came along with them. Or drop files anywhere."
              aria-label="Paste links"
              rows={3}
            />
          </div>
        </div>
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
