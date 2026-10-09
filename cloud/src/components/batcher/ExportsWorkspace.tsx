'use client'

import { memo, useEffect, useState } from 'react'
import { getBatcherEngine } from '@/lib/batcher/engine'
import { useBatcher } from '@/lib/batcher/use-batcher'
import { Icon } from '@/components/console/ConsoleIcons'
import { formatBytes, formatDuration, formatRelative } from './format'
import type { OutputRecord } from '@/lib/batcher/types'

function OutputRow({ output }: { output: OutputRecord }) {
  const engine = getBatcherEngine()
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return () => {
      if (preview) engine.releasePreview(output.id)
    }
    // The preview URL is engine-owned; releasing on unmount is the cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openPreview = async () => {
    if (preview) {
      engine.releasePreview(output.id)
      setPreview(null)
      return
    }
    setBusy(true)
    const url = await engine.previewUrl(output.id)
    setBusy(false)
    setPreview(url)
  }

  return (
    <li className="vb-output">
      <div className="vb-output-row">
        <button type="button" className="vb-output-thumb" onClick={() => void openPreview()} aria-label={`Preview ${output.name}`}>
          <Icon name={preview ? 'pause' : 'play'} size={14} />
        </button>
        <div className="vb-output-copy">
          <b title={output.name}>{output.name}</b>
          <span>
            {output.width}×{output.height}
            {' · '}
            {formatDuration(output.durationSeconds)}
            {' · '}
            {formatBytes(output.sizeBytes)}
            {' · '}
            {formatRelative(output.createdAt)}
          </span>
        </div>
        <div className="vb-output-act">
          {busy && <em>loading…</em>}
          <button type="button" className="pill" onClick={() => void engine.downloadOutput(output.id)}>
            <Icon name="download" size={13} /> Download
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => void engine.downloadOutput(output.id, true)}
            title="Choose where to save (File System Access)"
          >
            <Icon name="folder" size={13} /> Save to…
          </button>
          <button
            type="button"
            className="vb-iconbtn vb-iconbtn-danger"
            aria-label={`Delete ${output.name}`}
            onClick={() => void engine.deleteOutput(output.id)}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
      {preview && (
        <div className="vb-output-preview">
          <video src={preview} controls playsInline preload="metadata" />
        </div>
      )}
    </li>
  )
}

/** Exports — everything finished, available the moment each variation lands
 *  (§30), with per-file download and a folder save where the browser allows. */
export const ExportsWorkspace = memo(function ExportsWorkspace() {
  const outputs = useBatcher((snapshot) => snapshot.outputs)
  const stats = useBatcher((snapshot) => snapshot.stats)
  const batch = useBatcher((snapshot) => snapshot.batch)
  const engine = getBatcherEngine()

  const active = batch?.status === 'running' || batch?.status === 'paused'
  const totalBytes = outputs.reduce((sum, output) => sum + output.sizeBytes, 0)

  return (
    <div className="vb-exports">
      {active && stats && (
        <div className="vb-card vb-exports-active">
          <header className="vb-card-head">
            <h4>Active batch</h4>
            <span>
              {stats.completed}/{stats.total} complete
            </span>
          </header>
          <div className="vb-exports-active-body">
            <div className="vb-progress-track">
              <i style={{ width: `${Math.max(1, Math.round(stats.overall * 100))}%` }} />
            </div>
            <span>
              {stats.processing} processing · {stats.queued} queued
              {stats.failed ? ` · ${stats.failed} failed` : ''}
            </span>
          </div>
        </div>
      )}

      <div className="vb-effects-head">
        <div className="vb-effects-title">
          <h3>Exports</h3>
          <p>
            {outputs.length
              ? `${outputs.length} variation${outputs.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)} in local storage`
              : 'Finished variations land here the moment they complete.'}
          </p>
        </div>
        <div className="vb-effects-actions">
          <button
            type="button"
            className="pill"
            data-primary="true"
            disabled={!outputs.length}
            onClick={() => void engine.downloadAll()}
          >
            <Icon name="download" size={13} /> Download all
          </button>
        </div>
      </div>

      {outputs.length === 0 ? (
        <div className="vb-empty">
          <p>Nothing exported yet. Generate a batch and the first variation will appear here as soon as it renders.</p>
        </div>
      ) : (
        <ul className="vb-output-list">
          {outputs.map((output) => (
            <OutputRow key={output.id} output={output} />
          ))}
        </ul>
      )}
    </div>
  )
})
