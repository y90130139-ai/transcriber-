'use client'

import { memo, useCallback, useRef, useState } from 'react'
import { getBatcherEngine } from '@/lib/batcher/engine'
import { useBatcher } from '@/lib/batcher/use-batcher'
import { Icon } from '@/components/console/ConsoleIcons'
import { formatElapsed, formatEta, formatSpeed } from './format'
import type { Job, JobProgress } from '@/lib/batcher/types'

const ROW_HEIGHT = 46
const VIEWPORT = 238

/* ---------------------------------------------------------------- job rows */

function JobStatusMark({ job, ratio }: { job: Job; ratio: number | null }) {
  if (job.status === 'processing') {
    return (
      <span className="vb-job-ring" aria-hidden style={{ '--vb-p': `${Math.round((ratio ?? 0) * 100)}%` } as React.CSSProperties}>
        <Icon name="play" size={10} />
      </span>
    )
  }
  if (job.status === 'completed') return <Icon name="checkCircle" size={15} />
  if (job.status === 'failed') return <Icon name="alert" size={15} />
  if (job.status === 'cancelled') return <Icon name="x" size={15} />
  return <Icon name="clock" size={15} />
}

const JobRow = memo(function JobRow({
  job,
  progress,
  style,
}: {
  job: Job
  progress: JobProgress | null
  style: React.CSSProperties
}) {
  const engine = getBatcherEngine()
  const ratio = job.status === 'processing' ? progress?.ratio ?? 0 : job.status === 'completed' ? 1 : 0

  return (
    <div className="vb-job" data-status={job.status} style={style}>
      <span className="vb-job-mark">
        <JobStatusMark job={job} ratio={ratio} />
      </span>
      <span className="vb-job-name" title={job.manifest.export.outputName}>
        {job.manifest.export.outputName}
      </span>
      <span className="vb-job-stage">
        {job.status === 'queued' && (job.stage === 'waiting-source' ? 'waiting for source' : 'queued')}
        {job.status === 'processing' && (
          <span className="vb-job-progress">
            <span className="vb-mini-bar">
              <i style={{ width: `${Math.round(ratio * 100)}%` }} />
            </span>
            <b>{Math.round(ratio * 100)}%</b>
            <em>{formatSpeed(progress?.fps ?? null)}</em>
          </span>
        )}
        {job.status === 'completed' && 'done'}
        {job.status === 'cancelled' && 'cancelled'}
        {job.status === 'failed' && <span className="vb-job-fail">{job.error}</span>}
      </span>
      <span className="vb-job-act">
        {job.status === 'completed' && job.outputId && (
          <button
            type="button"
            className="vb-iconbtn"
            title="Download"
            aria-label={`Download ${job.manifest.export.outputName}`}
            onClick={() => void engine.downloadOutput(job.outputId!)}
          >
            <Icon name="download" size={13} />
          </button>
        )}
      </span>
    </div>
  )
})

/** The processing file list. Virtualized: a 500-job queue stays a 500-row
 *  scroll region, not a 500-node DOM tree (§33). */
export const JobsPanel = memo(function JobsPanel() {
  const jobs = useBatcher((snapshot) => snapshot.jobs)
  const progress = useBatcher((snapshot) => snapshot.progress)
  const [collapsed, setCollapsed] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const scrollRef = useRef<number>(0)

  if (!jobs.length) return null

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4)
  const end = Math.min(jobs.length, start + Math.ceil(VIEWPORT / ROW_HEIGHT) + 8)
  const visible = jobs.slice(start, end)

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const next = event.currentTarget.scrollTop
    if (Math.abs(next - scrollRef.current) > 8) {
      scrollRef.current = next
      setScrollTop(next)
    }
  }

  return (
    <section className="vb-card vb-jobs" data-collapsed={collapsed}>
      <header className="vb-card-head vb-jobs-head">
        <button type="button" className="vb-details-toggle" onClick={() => setCollapsed((value) => !value)}>
          <Icon name="chevron" size={14} />
          <h4>Variations</h4>
          <span className="vb-jobs-count">{jobs.length}</span>
        </button>
        <span className="vb-jobs-legend">
          {jobs.filter((job) => job.status === 'completed').length} done
          {jobs.filter((job) => job.status === 'failed').length > 0 &&
            ` · ${jobs.filter((job) => job.status === 'failed').length} failed`}
        </span>
      </header>
      {!collapsed && (
        <div className="vb-jobs-viewport" style={{ height: VIEWPORT }} onScroll={onScroll}>
          <div className="vb-jobs-spacer" style={{ height: jobs.length * ROW_HEIGHT }}>
            {visible.map((job, index) => (
              <JobRow
                key={job.id}
                job={job}
                progress={progress[job.id] ?? null}
                style={{
                  position: 'absolute',
                  top: (start + index) * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
})

/* ------------------------------------------------------------- settings bar */

function NumberField({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="vb-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10)
          if (Number.isFinite(parsed)) onChange(Math.max(min, Math.min(max, parsed)))
        }}
      />
    </label>
  )
}

function SelectField<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <label className="vb-field">
      <span>{label}</span>
      <select className="vb-select" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The persistent processing controls — the desktop app's render bar. */
export const ProcessingBar = memo(function ProcessingBar() {
  const config = useBatcher((snapshot) => snapshot.config.render)
  const stats = useBatcher((snapshot) => snapshot.stats)
  const batch = useBatcher((snapshot) => snapshot.batch)
  const engineState = useBatcher((snapshot) => snapshot.engine)
  const notice = useBatcher((snapshot) => snapshot.notice)
  const sources = useBatcher((snapshot) => snapshot.sources)
  const engine = getBatcherEngine()
  const [generating, setGenerating] = useState(false)

  const generate = useCallback(() => {
    setGenerating(true)
    // Yield one frame so the button's pressed state paints before the
    // manifests build (they are synchronous and fast, but 500 × 16 effects
    // is still worth a paint).
    window.setTimeout(() => {
      engine.generate()
      setGenerating(false)
    }, 0)
  }, [engine])

  const running = batch?.status === 'running'
  const paused = batch?.status === 'paused'
  const active = running || paused
  const failedCount = stats?.failed ?? 0
  const readySources = sources.filter((source) => source.status === 'ready').length

  const workerOptions = [
    { value: 'auto', label: 'Auto' },
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    { value: '4', label: '4' },
  ]

  return (
    <div className="vb-bar">
      {notice && <p className="vb-bar-notice">{notice}</p>}

      {active && stats && (
        <div className="vb-progress">
          <div className="vb-progress-track" role="progressbar" aria-valuenow={Math.round(stats.overall * 100)}>
            <i style={{ width: `${Math.max(1, Math.round(stats.overall * 100))}%` }} />
          </div>
          <div className="vb-progress-facts">
            <b>{Math.round(stats.overall * 100)}%</b>
            <span>
              variation {Math.min(stats.total, stats.completed + stats.failed + stats.cancelled + stats.processing)}/{stats.total}
            </span>
            <span>{formatElapsed(stats.elapsedSeconds)} elapsed</span>
            <span>{stats.etaSeconds != null ? `~${formatEta(stats.etaSeconds)} left` : 'estimating…'}</span>
            <span>
              {stats.activeWorkers}/{stats.workers} workers
            </span>
            {stats.failed > 0 && <span className="vb-progress-fail">{stats.failed} failed</span>}
          </div>
        </div>
      )}

      <div className="vb-bar-controls">
        <NumberField
          label="Variations"
          value={config.variations}
          min={1}
          max={500}
          onChange={(value) => engine.setRender({ variations: value })}
        />
        <SelectField
          label="Workers"
          value={config.workers === 'auto' ? 'auto' : String(config.workers)}
          options={workerOptions}
          onChange={(value) => engine.setRender({ workers: value === 'auto' ? 'auto' : Number(value) })}
        />
        <SelectField
          label="Quality"
          value={config.quality}
          options={[
            { value: 'high', label: 'High' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'smaller', label: 'Smaller' },
          ]}
          onChange={(value) => engine.setRender({ quality: value as typeof config.quality })}
        />
        <SelectField
          label="Resolution"
          value={config.maxResolution}
          options={[
            { value: 'original', label: 'Original' },
            { value: '1080p', label: '1080p' },
            { value: '720p', label: '720p' },
          ]}
          onChange={(value) => engine.setRender({ maxResolution: value as typeof config.maxResolution })}
        />

        <div className="vb-bar-actions">
          {active && (
            <>
              <button type="button" className="pill" onClick={() => (running ? engine.pause() : engine.resume())}>
                <Icon name={running ? 'pause' : 'play'} size={13} />
                {running ? 'Pause queue' : 'Resume'}
              </button>
              <button type="button" className="pill" onClick={() => engine.cancel()}>
                <Icon name="stop" size={13} /> Cancel
              </button>
            </>
          )}
          {!active && failedCount > 0 && (
            <button type="button" className="pill" onClick={() => engine.retryFailed()}>
              <Icon name="refresh" size={13} /> Retry failed
            </button>
          )}
          <button
            type="button"
            className="vb-generate"
            disabled={engineState !== 'ready' || !readySources || active || generating}
            onClick={generate}
            title={
              engineState !== 'ready'
                ? 'Waiting for the processing engine'
                : !readySources
                  ? 'Add a video first'
                  : undefined
            }
          >
            <Icon name="sliders" size={14} />
            {generating ? 'Preparing…' : 'Generate Variations'}
          </button>
        </div>
      </div>

      <p className="vb-bar-hint">
        {active
          ? 'Rendering continues if you navigate around the console — this page is just the controls.'
          : engineState === 'loading'
            ? 'Loading the processing engine in the background — you can already add files and configure effects.'
            : 'Everything runs in this tab. Keep it open while a batch renders.'}
      </p>
    </div>
  )
})
