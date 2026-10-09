'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { getBatcherEngine } from '@/lib/batcher/engine'
import { useBatcher } from '@/lib/batcher/use-batcher'
import { Icon, type IconName } from '@/components/console/ConsoleIcons'
import { SourceBar } from './SourceBar'
import { EffectsWorkspace } from './EffectsWorkspace'
import { ExportsWorkspace } from './ExportsWorkspace'
import { PresetsWorkspace } from './PresetsWorkspace'
import { MetadataWorkspace } from './MetadataWorkspace'
import { PhaseTwoWorkspace } from './PhaseTwoWorkspace'
import { JobsPanel, ProcessingBar } from './ProcessingBar'
import { Diagnostics } from './Diagnostics'
import { Toasts } from './Toasts'

type TabId = 'effects' | 'captions' | 'audio' | 'watermark' | 'metadata' | 'presets' | 'exports'

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'effects', label: 'Effects', icon: 'sliders' },
  { id: 'captions', label: 'Captions', icon: 'type' },
  { id: 'audio', label: 'Audio', icon: 'music' },
  { id: 'watermark', label: 'Watermark', icon: 'image' },
  { id: 'metadata', label: 'Metadata', icon: 'tag' },
  { id: 'presets', label: 'Presets', icon: 'folder' },
  { id: 'exports', label: 'Exports', icon: 'download' },
]

function Workspace({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'effects':
      return <EffectsWorkspace />
    case 'captions':
      return <PhaseTwoWorkspace kind="captions" />
    case 'audio':
      return <PhaseTwoWorkspace kind="audio" />
    case 'watermark':
      return <PhaseTwoWorkspace kind="watermark" />
    case 'metadata':
      return <MetadataWorkspace />
    case 'presets':
      return <PresetsWorkspace />
    case 'exports':
      return <ExportsWorkspace />
    default:
      return null
  }
}

/** The Video Batcher page. The engine is a module singleton that outlives this
 *  component — unmounting (navigating the console) must never stop a batch. */
export const BatcherPage = memo(function BatcherPage() {
  const [tab, setTab] = useState<TabId>('effects')
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const engine = getBatcherEngine()
  const outputsCount = useBatcher((snapshot) => snapshot.outputs.length)
  const jobsCount = useBatcher((snapshot) => snapshot.jobs.length)

  useEffect(() => {
    engine.open()
    return () => engine.close()
  }, [engine])

  const tabBadge = useMemo(
    () => ({ exports: outputsCount, effects: jobsCount || undefined }) as Partial<Record<TabId, number | undefined>>,
    [outputsCount, jobsCount],
  )

  return (
    <div
      className="vb"
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepth.current += 1
        if (event.dataTransfer?.types?.includes('Files')) setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (files.length) engine.addFiles(files)
      }}
    >
      <header className="vb-head">
        <div className="vb-head-copy">
          <h2>Video Batcher</h2>
          <p>Drop a video, dial in the effects, and render a batch of variations — locally, in this browser.</p>
        </div>
        <Diagnostics />
      </header>

      <SourceBar />

      <nav className="tabs vb-tabs" aria-label="Workspaces">
        {TABS.map((item) => (
          <button
            type="button"
            key={item.id}
            className="tab"
            data-on={tab === item.id}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} size={14} />
            {item.label}
            {tabBadge[item.id] ? <b>{tabBadge[item.id]}</b> : null}
          </button>
        ))}
      </nav>

      <section className="vb-workspace" key={tab}>
        <Workspace tab={tab} />
      </section>

      <JobsPanel />

      <ProcessingBar />

      <Toasts />

      {dragging && (
        <div className="vb-dropveil" aria-hidden>
          <span>Drop to add videos</span>
        </div>
      )}
    </div>
  )
})
