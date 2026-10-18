'use client'

import { useEffect, useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import Queue from './Queue'
import DropSelect from './dashboard/DropSelect'
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
  /** How videos arrive: pasted links, or files — one clear path at a time.
   *  The old composer mixed both into one corner and neither read well. */
  const [mode, setMode] = useState<'links' | 'files'>('links')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateLabel, setTemplateLabel] = useState('')
  const [templateBody, setTemplateBody] = useState('')
  /** The three-column composer (Geno, 2026-10-08): what it is, which kind,
   *  then the links or files — so everything arrives already identified. */
  const [format, setFormat] = useState('')
  /** The picked "what it is": a German playbook number, or `k:<id>` for a
   *  saved kind. Resolved to variant/name at submit. */
  const [kind, setKind] = useState('')
  const [customFormats, setCustomFormats] = useState<{ id: string; label: string }[]>([])
  const [kinds, setKinds] = useState<{ id: string; format: string; label: string }[]>([])
  const [newFormat, setNewFormat] = useState<string | null>(null)
  const [newKind, setNewKind] = useState<string | null>(null)
  /** A German playbook entry added here is a template, not just a name
   *  (Geno, 2026-10-16): instructions and version rows are asked with it. */
  const [newKindBody, setNewKindBody] = useState('')
  const [newKindVersions, setNewKindVersions] = useState<{ outfit: string; caption: string }[]>([
    { outfit: '', caption: '' },
  ])
  const dragDepth = useRef(0)

  useEffect(() => {
    fetch('/api/formats')
      .then((response) => (response.ok ? response.json() : { formats: [], kinds: [] }))
      .then((body) => { setCustomFormats(body.formats ?? []); setKinds(body.kinds ?? []) })
      .catch(() => { setCustomFormats([]); setKinds([]) })
  }, [])

  /** What the current pick means for the API: a German playbook number, or
   *  a saved kind's label that names every row. */
  const picked = (() => {
    if (!kind) return { variant: undefined as string | undefined, name: undefined as string | undefined }
    if (kind.startsWith('k:')) {
      const entry = kinds.find((row) => `k:${row.id}` === kind)
      return { variant: undefined, name: entry?.label }
    }
    return { variant: kind, name: undefined }
  })()

  function stageFiles(files: File[]) {
    const videos = files.filter((file) => /^(video|audio)\//.test(file.type))
    if (videos.length === 0) {
      setNote({ text: 'Those were not video or audio files.', bad: true })
      return
    }
    setMode('files')
    setPendingFiles((current) => [...current, ...videos])
    const rejected = files.length - videos.length
    setNote({
      text: `${videos.length} file${videos.length === 1 ? '' : 's'} ready. Nothing has been added yet${rejected ? ` · ${rejected} unsupported file${rejected === 1 ? '' : 's'} skipped` : ''}.`,
    })
  }

  function removePendingFile(index: number) {
    if (pendingFiles.length === 1) {
      setSaveAsTemplate(false)
      setTemplateLabel('')
      setTemplateBody('')
    }
    setPendingFiles((current) => current.filter((_, at) => at !== index))
  }

  async function savePendingBatch() {
    if (pendingFiles.length === 0 || busy) return
    if (saveAsTemplate && !templateLabel.trim()) {
      setNote({ text: 'Name the template or turn off “Save as template”.', bad: true })
      return
    }

    const files = [...pendingFiles]
    const metadata = { format: format || undefined, variant: picked.variant, name: picked.name }
    let templateSaved = false
    let uploaded = 0
    const completed = new Set<File>()
    setBusy(true)

    if (saveAsTemplate) {
      setNote({ text: 'Saving template…' })
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: templateLabel.trim(), format: format || undefined, body: templateBody }),
      }).catch(() => null)
      const body = await response?.json().catch(() => ({})) ?? {}
      if (!response?.ok || !body.template) {
        setNote({ text: body.error ?? 'Could not save that template; nothing was queued.', bad: true })
        setBusy(false)
        return
      }
      templateSaved = true
      setSaveAsTemplate(false)
      setTemplateLabel('')
      setTemplateBody('')
    }

    try {
      for (const file of files) {
        setNote({ text: `Uploading ${uploaded + 1} of ${files.length}…` })
        await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/uploads',
          clientPayload: JSON.stringify(metadata),
        })
        uploaded += 1
        completed.add(file)
      }

      setPendingFiles([])
      setSaveAsTemplate(false)
      setNote({
        text: `Added ${uploaded} file${uploaded === 1 ? '' : 's'}${templateSaved ? ' · template saved' : ''}.`,
      })
      onChanged()
    } catch (error) {
      setPendingFiles((current) => current.filter((file) => !completed.has(file)))
      const detail = error instanceof Error ? error.message : 'Upload failed.'
      const partial = [
        uploaded ? `Uploaded ${uploaded} of ${files.length} files.` : '',
        templateSaved ? 'The template was saved.' : '',
      ].filter(Boolean).join(' ')
      setNote({ text: `${partial ? `${partial} ` : ''}${detail}`, bad: true })
      if (uploaded > 0) onChanged()
    }
    setBusy(false)
  }

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

  /** "+ Add what it is": saved under the picked format — or as a general
   *  kind when none is picked — offered forever, picked now. A German entry
   *  carries its instructions and versions too, so it prefills like the
   *  doc's own in the plan editor (Geno, 2026-10-16). */
  async function saveKind() {
    const label = (newKind ?? '').trim()
    if (!label) return
    const german = format === GERMAN_FORMAT_TAG
    const versions = german
      ? newKindVersions
        .map((row) => ({ outfit: row.outfit.trim(), caption: row.caption.trim() }))
        .filter((row) => row.outfit || row.caption)
      : []
    const response = await fetch('/api/formats/kinds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: format || '',
        label,
        body: german ? newKindBody : undefined,
        versions: german && versions.length > 0 ? versions : undefined,
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not save that.', bad: true })
      return
    }
    setKinds((current) => {
      const rest = current.filter((entry) => entry.id !== body.kind.id)
      return [...rest, body.kind].sort((a, b) => a.label.localeCompare(b.label))
    })
    setKind(`k:${body.kind.id}`)
    setNewKind(null)
    setNewKindBody('')
    setNewKindVersions([{ outfit: '', caption: '' }])
    setNote({
      text: german
        ? `Saved “${label}” — instructions and versions ride it in the plan editor.`
        : `Saved “${label}” — it sits in the type list from now on.`,
    })
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
        variant: picked.variant,
        name: picked.name,
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not queue those.', bad: true })
    } else {
      setPaste('')
      const skipped = body.skipped ? `, ${body.skipped} already in the library` : ''
      const as = picked.variant && findGerman(picked.variant)
        ? ` as German #${picked.variant}` : picked.name ? ` as “${picked.name}”` : ''
      setNote({ text: `Added ${body.added}${as}${skipped}.` })
      onChanged()
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
        stageFiles([...event.dataTransfer.files])
      }}
    >
      {dragging && <div className="dropveil"><span>Drop it</span></div>}

      <header className="dash-head">
        <div>
          <p className="dash-kicker">Workspace</p>
          <h2 className="dash-title">Queue</h2>
          <p className="dash-sub">
            {pending.length === 0
              ? 'Nothing waiting'
              : `${inFlight.length} in flight · ${waiting.length} waiting · ${stuck.length} stuck`}
          </p>
        </div>
        {/* The worker's state, up beside the title (2026-10-13 redesign): it
            used to live only in the composer's hint, where a glance never
            found it. */}
        <div className="dash-head-tools">
          <span className="queue-worker" data-on={workerOnline ? 'true' : undefined}>
            {workerOnline ? 'Worker online' : 'Will run when the Mac wakes'}
          </span>
        </div>
      </header>

      <section className="queue-composer" aria-label="Add to the queue">
        <div className="queue-composer-grid">
          <div className="queue-composer-col">
            <span className="axis-name">Video format</span>
            <DropSelect
              label="Video format"
              value={format}
              onChange={(chosen) => {
                if (chosen === '__new') { setNewFormat(''); return }
                setFormat(chosen)
                setKind('')
                setNewKind(null)
              }}
              options={[
                { value: '', label: 'No format' },
                ...taxonomy.format.tags.map((tag) => ({ value: tag.id, label: tag.label })),
                ...customFormats.map((entry) => ({ value: entry.id, label: entry.label, group: 'Our own' })),
                { value: '__new', label: 'Add format' },
              ]}
            />
            {newFormat !== null && (
              <span className="queue-newformat">
                <input
                  className="field"
                  value={newFormat}
                  autoFocus
                  placeholder="Format name"
                  onChange={(event) => setNewFormat(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void saveFormat() }}
                />
                <button type="button" className="pill" onClick={() => void saveFormat()}>Save</button>
                <button type="button" className="pill" onClick={() => setNewFormat(null)}>Cancel</button>
              </span>
            )}
          </div>

          <div className="queue-composer-col">
            <span className="axis-name">{format === GERMAN_FORMAT_TAG ? 'German playbook' : 'Content type'}</span>
            <div className="queue-picker-row">
              <DropSelect
                label={format === GERMAN_FORMAT_TAG ? 'German playbook' : 'Content type'}
                value={kind}
                onChange={(chosen) => {
                  if (chosen === '__new') { setNewKind(''); return }
                  setKind(chosen)
                }}
                options={[
                  {
                    value: '',
                    label: format === GERMAN_FORMAT_TAG
                      ? newKind !== null ? 'Adding…' : 'Choose a playbook entry'
                      : 'No type',
                  },
                  ...(format === GERMAN_FORMAT_TAG
                    ? GERMAN_TYPES.flatMap((type) => type.formats.map((entry) => ({
                        value: String(entry.no),
                        label: `#${entry.no} · ${entry.name}`,
                        group: type.label,
                      })))
                    : []),
                  ...kinds
                    .filter((entry) => entry.format === format || entry.format === '')
                    .map((entry) => ({
                      value: `k:${entry.id}`,
                      label: entry.label,
                      group: format === GERMAN_FORMAT_TAG ? 'Our playbook' : 'Our own',
                    })),
                  { value: '__new', label: format === GERMAN_FORMAT_TAG ? 'Add playbook entry' : 'Add type' },
                ]}
              />
              {/* The add button is the German lane's own (Geno, 2026-10-16):
                  the playbook list is 57 rows, so the door sits beside the
                  picker. Every other format adds from the dropdown's last
                  option, exactly as before. */}
              {format === GERMAN_FORMAT_TAG && (
                <button
                  type="button"
                  className="pill"
                  title={newKind !== null ? 'Close the new playbook entry' : 'Add a new playbook entry'}
                  onClick={() => {
                    // Clicking again while the form is open closes it — it
                    // never wipes what has been typed.
                    if (newKind !== null) {
                      setNewKind(null)
                      setNewKindBody('')
                      setNewKindVersions([{ outfit: '', caption: '' }])
                      return
                    }
                    setNewKind('')
                    setNewKindBody('')
                    setNewKindVersions([{ outfit: '', caption: '' }])
                    setNote(null)
                  }}
                >{newKind !== null ? 'Close' : '+ Add'}</button>
              )}
            </div>
            {newKind !== null && format !== GERMAN_FORMAT_TAG && (
              <span className="queue-newformat">
                <input
                  className="field"
                  value={newKind}
                  autoFocus
                  placeholder="Type name"
                  onChange={(event) => setNewKind(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void saveKind() }}
                />
                <button type="button" className="pill" onClick={() => void saveKind()}>Save</button>
                <button type="button" className="pill" onClick={() => setNewKind(null)}>Cancel</button>
              </span>
            )}
          </div>
        </div>

        {/* A German entry asks for the brief, not just a name (Geno,
            2026-10-16): instructions and versions are saved with it and come
            back in the plan editor's German lane, like the doc's own 57. */}
        {newKind !== null && format === GERMAN_FORMAT_TAG && (
          <section className="queue-playbook-form" aria-label="New German playbook entry">
            <header className="queue-playbook-head">
              <strong>New playbook entry</strong>
              <span>Saved for German and offered here and in the plan editor's German lane.</span>
            </header>
            <div className="queue-playbook-fields">
              <label className="queue-composer-col">
                <span className="axis-name">Playbook entry name</span>
                <input
                  className="field"
                  value={newKind}
                  autoFocus
                  maxLength={120}
                  placeholder="German #68 · Shower reveal"
                  onChange={(event) => setNewKind(event.target.value)}
                />
              </label>
              <label className="queue-composer-col">
                <span className="axis-name">Instructions — what she films</span>
                <textarea
                  className="field"
                  rows={2}
                  value={newKindBody}
                  maxLength={4000}
                  placeholder="How the reel is filmed, in the doc's own words"
                  onChange={(event) => setNewKindBody(event.target.value)}
                />
              </label>
            </div>
            <div className="queue-composer-col">
              <span className="axis-name">Versions — what changes each time</span>
              <div className="queue-playbook-vers">
                {newKindVersions.map((row, at) => (
                  <div className="queue-ver" key={at}>
                    <span className="queue-ver-no">V{at + 1}</span>
                    <input
                      className="field"
                      value={row.outfit}
                      placeholder="Outfit"
                      aria-label={`Version ${at + 1} outfit`}
                      onChange={(event) => setNewKindVersions((list) => list.map((v, i) => (i === at ? { ...v, outfit: event.target.value } : v)))}
                    />
                    <input
                      className="field"
                      value={row.caption}
                      placeholder="Caption"
                      aria-label={`Version ${at + 1} caption`}
                      onChange={(event) => setNewKindVersions((list) => list.map((v, i) => (i === at ? { ...v, caption: event.target.value } : v)))}
                    />
                    <button
                      type="button"
                      className="queue-ver-x"
                      disabled={newKindVersions.length <= 1}
                      aria-label={`Remove version ${at + 1}`}
                      title={`Remove version ${at + 1}`}
                      onClick={() => setNewKindVersions((list) => list.filter((_, i) => i !== at))}
                    >×</button>
                  </div>
                ))}
                {newKindVersions.length < 8 && (
                  <button
                    type="button"
                    className="pill queue-vers-add"
                    onClick={() => setNewKindVersions((list) => [...list, { outfit: '', caption: '' }])}
                  >+ Add version</button>
                )}
              </div>
            </div>
            <div className="queue-playbook-foot">
              <span className="hint">Nothing is saved until you press Save entry.</span>
              <span className="queue-composer-actions">
                <button
                  type="button"
                  className="pill"
                  onClick={() => {
                    setNewKind(null)
                    setNewKindBody('')
                    setNewKindVersions([{ outfit: '', caption: '' }])
                  }}
                >Cancel</button>
                <button type="button" className="pill" data-primary="true" disabled={!newKind.trim()} onClick={() => void saveKind()}>
                  Save entry
                </button>
              </span>
            </div>
          </section>
        )}

        <div className="queue-intake">
          <span className="axis-name">Add videos</span>
          <div className="queue-mode-tabs" role="group" aria-label="How the videos arrive">
            <button
              type="button"
              className="queue-mode-tab"
              data-on={mode === 'links' || undefined}
              aria-pressed={mode === 'links'}
              onClick={() => setMode('links')}
            >Paste links</button>
            <button
              type="button"
              className="queue-mode-tab"
              data-on={mode === 'files' || undefined}
              aria-pressed={mode === 'files'}
              onClick={() => setMode('files')}
            >
              Upload files
              {pendingFiles.length > 0 && <b className="queue-mode-count">{pendingFiles.length}</b>}
            </button>
          </div>

          {mode === 'links' && (
            <div className="queue-links">
              <textarea
                id="queue-paste"
                className="queue-input"
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submitLinks()
                }}
                placeholder="Paste Instagram, TikTok or X links — one per line. Notes and extra text can ride along."
                aria-label="Paste links"
                rows={3}
              />
              <div className="queue-links-foot">
                <span className="hint">Ctrl/⌘ + Enter adds them.</span>
                <button type="button" className="pill" data-primary="true" onClick={() => void submitLinks()} disabled={busy || !paste.trim()}>
                  {busy ? 'Working' : 'Add links'}
                </button>
              </div>
            </div>
          )}

          {mode === 'files' && (
            <div className="queue-files">
              {pendingFiles.length === 0 ? (
                <label className="queue-dropzone" data-busy={busy || undefined}>
                  <input
                    className="sr-only"
                    type="file"
                    accept="video/*,audio/*"
                    multiple
                    disabled={busy}
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])]
                      event.target.value = ''
                      stageFiles(files)
                    }}
                  />
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
                    <path d="M5 14.5v4A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-4" />
                  </svg>
                  <strong>{busy ? 'Uploading…' : 'Drop video or audio files here'}</strong>
                  <span>or click to browse — video and audio, up to 500 MB each</span>
                  <em>Nothing enters the queue until you press Save</em>
                </label>
              ) : (
                <section className="queue-pending-batch" aria-labelledby="queue-pending-title">
                  <header className="queue-pending-head">
                    <div className="queue-pending-title">
                      <strong id="queue-pending-title">{pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} ready to add</strong>
                      <span>Nothing enters the queue until you press Save.</span>
                    </div>
                    <label className="pill">
                      Add more
                      <input
                        type="file"
                        accept="video/*,audio/*"
                        multiple
                        disabled={busy}
                        hidden
                        onChange={(event) => {
                          const files = [...(event.target.files ?? [])]
                          event.target.value = ''
                          stageFiles(files)
                        }}
                      />
                    </label>
                  </header>
                  <div className="queue-pending-list" role="list" aria-label="Files waiting to be added">
                    {pendingFiles.map((file, index) => (
                      <div className="queue-pending-file" role="listitem" key={`${file.name}:${file.lastModified}:${index}`}>
                        <span className="queue-pending-file-name" title={file.name}>{file.name}</span>
                        <span className="queue-pending-file-size">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                        <button type="button" className="pill" disabled={busy} onClick={() => removePendingFile(index)}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  <label className="queue-template-option">
                    <input type="checkbox" checked={saveAsTemplate} disabled={busy} onChange={(event) => setSaveAsTemplate(event.target.checked)} />
                    <span>Also save this setup as a reusable template <small>(optional)</small></span>
                  </label>

                  {saveAsTemplate && (
                    <div className="queue-save-template-fields">
                      <label className="queue-composer-col">
                        <span className="axis-name">Template name</span>
                        <input
                          className="field"
                          value={templateLabel}
                          maxLength={120}
                          disabled={busy}
                          onChange={(event) => setTemplateLabel(event.target.value)}
                          placeholder="Name this reusable template"
                        />
                      </label>
                      <label className="queue-composer-col">
                        <span className="axis-name">Directions</span>
                        <textarea
                          className="field"
                          value={templateBody}
                          maxLength={4000}
                          disabled={busy}
                          onChange={(event) => setTemplateBody(event.target.value)}
                          placeholder="Add directions to keep with this template"
                          rows={2}
                        />
                      </label>
                    </div>
                  )}

                  <div className="queue-pending-foot">
                    <span className="hint">Template uses the selected format; content type labels queued videos.</span>
                    <span className="queue-composer-actions">
                      <button type="button" className="pill" disabled={busy} onClick={() => {
                        setPendingFiles([])
                        setSaveAsTemplate(false)
                        setTemplateLabel('')
                        setTemplateBody('')
                        setNote(null)
                      }}>Cancel</button>
                      <button type="button" className="pill" data-primary="true" disabled={busy || (saveAsTemplate && !templateLabel.trim())} onClick={() => void savePendingBatch()}>
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </span>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="queue-composer-foot">
          <span className="hint" role="status" aria-live="polite" data-tone={note?.bad ? 'bad' : undefined}>
            {note
              ? note.text
              : workerOnline
                ? 'The pass takes about a second; each row says what it heard.'
                : 'Will run when the Mac wakes.'}
          </span>
        </div>
      </section>

      {/* A queue with nothing in it shows no sections at all (2026-10-13
          redesign) — the panel's "0 items / nothing downloading" was two
          lines of filler under the composer's own "Nothing waiting". */}
      {pending.length > 0 && (
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
      )}

      {/* Needs a person first, then the parked ones (2026-10-13 redesign):
          a stuck row is the only thing here that cannot clear itself. */}
      <StuckList items={stuck} onOpen={onOpen} onChanged={onChanged} />
      <WaitingList items={waiting} onOpen={onOpen} />
    </div>
  )
}
