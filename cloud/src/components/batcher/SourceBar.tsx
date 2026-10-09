'use client'

import { memo, useCallback, useRef, useState } from 'react'
import { getBatcherEngine } from '@/lib/batcher/engine'
import { useBatcher } from '@/lib/batcher/use-batcher'
import { Icon } from '@/components/console/ConsoleIcons'
import { formatBytes, formatDuration } from './format'
import type { SourceFile } from '@/lib/batcher/types'

function SourceRow({ source }: { source: SourceFile }) {
  const engine = getBatcherEngine()
  const probe = source.probe
  const facts = probe
    ? [
        formatDuration(probe.durationSeconds),
        probe.width && probe.height ? `${probe.width}×${probe.height}` : null,
        probe.fps ? `${probe.fps} fps` : null,
        probe.videoCodec,
        probe.audioCodec,
      ]
        .filter(Boolean)
        .join(' · ')
    : formatBytes(source.size)

  return (
    <li className="vb-source" data-status={source.status}>
      <span className="vb-source-mark">
        <Icon name="film" size={15} />
      </span>
      <div className="vb-source-copy">
        <b title={source.name}>{source.name}</b>
        <span className="vb-source-facts">{source.status === 'error' ? source.error : facts}</span>
      </div>
      <span className="vb-source-state">
        {source.status === 'probing' && 'Reading…'}
        {source.status === 'ready' && formatBytes(source.size)}
        {source.status === 'error' && 'Unsupported'}
      </span>
      <button
        type="button"
        className="vb-iconbtn"
        aria-label={`Remove ${source.name}`}
        onClick={() => engine.removeSource(source.id)}
      >
        <Icon name="x" size={14} />
      </button>
    </li>
  )
}

const SourceList = memo(function SourceList({ sources }: { sources: SourceFile[] }) {
  return (
    <ul className="vb-source-list">
      {sources.map((source) => (
        <SourceRow key={source.id} source={source} />
      ))}
    </ul>
  )
})

/** Sources on the left, outputs/engine on the right — the desktop app's top
 *  strip, worn with the console's surfaces. */
export const SourceBar = memo(function SourceBar() {
  const sources = useBatcher((snapshot) => snapshot.sources)
  const outputs = useBatcher((snapshot) => snapshot.outputs)
  const engineStatus = useBatcher((snapshot) => snapshot.engine)
  const multithreaded = useBatcher((snapshot) => snapshot.multithreaded)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const engine = getBatcherEngine()

  const onBrowse = useCallback(() => inputRef.current?.click(), [])

  const onDrop = useCallback((event: React.DragEvent) => {
    // The page handles the actual file intake; this only clears the local
    // highlight and lets the event keep bubbling to the page drop handler.
    event.preventDefault()
    setDragOver(false)
  }, [])

  const readyCount = sources.filter((source) => source.status === 'ready').length

  return (
    <div className="vb-top">
      <section className="vb-panel vb-panel-sources">
        <header className="vb-panel-head">
          <h3>Source Files</h3>
          <span className="vb-panel-note">
            {sources.length ? `${readyCount}/${sources.length} ready` : 'MP4, MOV, M4V, WEBM, MKV'}
          </span>
        </header>

        <div
          className="vb-drop"
          data-over={dragOver}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <p>Drag &amp; drop videos here</p>
          <button type="button" className="pill" data-primary="true" onClick={onBrowse}>
            <Icon name="plus" size={14} /> Browse
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.m4v,.webm,.mkv,.avi"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              if (files.length) engine.addFiles(files)
              event.target.value = ''
            }}
          />
        </div>

        {sources.length > 0 && <SourceList sources={sources} />}
        {sources.length > 1 && (
          <button type="button" className="vb-linkbtn" onClick={() => engine.clearSources()}>
            Clear all
          </button>
        )}
      </section>

      <section className="vb-panel vb-panel-output">
        <header className="vb-panel-head">
          <h3>Output</h3>
          <span className="vb-panel-note">
            <Icon name="folder" size={13} /> This browser
          </span>
        </header>
        <div className="vb-output-copy">
          <p>
            Variations are processed locally and stored in this browser. Nothing is uploaded.
          </p>
          <p className="vb-output-note">
            {outputs.length
              ? `${outputs.length} output${outputs.length === 1 ? '' : 's'} ready to download.`
              : 'Finished variations appear in Exports, downloadable one by one or all at once.'}
          </p>
        </div>
        <div className="vb-engine" data-status={engineStatus}>
          <span className="vb-engine-beacon" aria-hidden />
          <b>Processing Engine</b>
          <span>
            {engineStatus === 'ready' ? 'Ready' : null}
            {engineStatus === 'loading' ? 'Loading…' : null}
            {engineStatus === 'idle' ? 'Not started' : null}
            {engineStatus === 'limited' ? 'Limited Browser Mode' : null}
            {engineStatus === 'error' ? 'Unavailable' : null}
          </span>
          {engineStatus === 'ready' && (
            <em>{multithreaded ? 'multithreaded' : 'single-threaded'}</em>
          )}
        </div>
      </section>
    </div>
  )
})
