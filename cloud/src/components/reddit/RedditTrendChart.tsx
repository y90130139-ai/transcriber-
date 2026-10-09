'use client'

import { useId, useMemo, useState, type PointerEvent } from 'react'
import { shortBucket } from './bits'

export type ChartPoint = { bucket: string; interest: number | null; activity: number; engagement: number }

const W = 880
const H = 300
const PAD = { top: 18, right: 18, bottom: 32, left: 48 }

type XY = { x: number; y: number }

/** Catmull-Rom → cubic bezier, control points clamped into the plot. */
function smoothPath(points: XY[], floor: number, ceiling: number): string {
  if (!points.length) return ''
  if (points.length === 1) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  const clamp = (value: number) => Math.min(ceiling, Math.max(floor, value))
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)},${clamp(p1.y + (p2.y - p0.y) / 6).toFixed(1)}`
      + ` ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)},${clamp(p2.y - (p3.y - p1.y) / 6).toFixed(1)}`
      + ` ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

const compact = (value: number) => Intl.NumberFormat('en-US', { notation: 'compact' }).format(Math.round(value))

/**
 * The Overview graph. Both modes are lines: interest (0–100, right at its
 * own normal while baselines build) and activity (mentions discovered per
 * hour/day — the line that actually moves from day one). The x-axis fits
 * the collected range, so a fresh install's two readings fill the width
 * instead of hiding in the last pixel of the window.
 */
export default function RedditTrendChart({
  points, mode, bucketSize, previous,
}: {
  points: ChartPoint[]
  mode: 'interest' | 'activity'
  bucketSize: 'hour' | 'day'
  previous: { bucket: string; activity: number }[]
}) {
  const [at, setAt] = useState<number | null>(null)
  const gradientId = useId()

  // Fit to the data: trim leading empty buckets so the line uses the width.
  const view = useMemo(() => {
    if (!points.length) return { points: [] as ChartPoint[], previous: [] as { bucket: string; activity: number }[] }
    let first = -1
    points.forEach((point, index) => {
      if (first !== -1) return
      if (mode === 'interest') {
        if (point.interest !== null && Number.isFinite(point.interest)) first = index
      } else if (point.activity > 0) {
        first = index
      }
    })
    if (first === -1) return { points: [], previous: [] }
    const start = Math.max(0, first - (mode === 'interest' ? 0 : 1))
    const trimmed = points.slice(start)
    const prev = previous.length === points.length ? previous.slice(start) : previous
    return { points: trimmed, previous: prev }
  }, [points, previous, mode])

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const viewPoints = view.points
  const viewPrevious = view.previous

  const interestValues = useMemo(
    () => viewPoints.map((point) => point.interest),
    [viewPoints],
  )
  const activityValues = useMemo(
    () => viewPoints.map((point) => point.activity),
    [viewPoints],
  )

  const activityMax = useMemo(
    () => Math.max(1, ...activityValues, ...viewPrevious.map((point) => point.activity)) * 1.15,
    [activityValues, viewPrevious],
  )

  const x = (index: number) => PAD.left + (viewPoints.length > 1 ? (index / (viewPoints.length - 1)) * plotW : plotW / 2)
  const yInterest = (value: number) => PAD.top + plotH - (Math.min(100, Math.max(0, value)) / 100) * plotH
  const yActivity = (value: number) => PAD.top + plotH - (Math.min(value, activityMax) / activityMax) * plotH

  const interestPoints = useMemo(
    () => viewPoints
      .map((_, index) => ({ index, value: interestValues[index] }))
      .filter((entry): entry is { index: number; value: number } => entry.value !== null && Number.isFinite(entry.value))
      .map((entry) => ({ x: x(entry.index), y: yInterest(entry.value) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewPoints, interestValues, plotW, plotH],
  )

  const interestPath = interestPoints.length > 1
    ? smoothPath(interestPoints, PAD.top, PAD.top + plotH)
    : ''
  const interestArea = interestPoints.length > 1
    ? `${interestPath} L${interestPoints[interestPoints.length - 1].x.toFixed(1)},${PAD.top + plotH} L${interestPoints[0].x.toFixed(1)},${PAD.top + plotH} Z`
    : ''
  const activityPath = smoothPath(
    activityValues.map((value, index) => ({ x: x(index), y: yActivity(value) })),
    PAD.top,
    PAD.top + plotH,
  )
  const activityArea = activityValues.length > 1
    ? `${activityPath} L${x(activityValues.length - 1).toFixed(1)},${PAD.top + plotH} L${x(0).toFixed(1)},${PAD.top + plotH} Z`
    : ''
  const previousPath = viewPrevious.length > 1
    ? smoothPath(viewPrevious.map((point, index) => ({ x: x(index), y: yActivity(point.activity) })), PAD.top, PAD.top + plotH)
    : ''

  const labelEvery = Math.max(1, Math.ceil(viewPoints.length / 7))
  const shown = at === null ? null : viewPoints[at]
  const shownInterest = at === null ? null : interestValues[at]
  const shownActivity = at === null ? null : activityValues[at]
  const leftPct = at === null ? 50 : (x(at) / W) * 100

  function move(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || viewPoints.length === 0) return
    const px = ((event.clientX - rect.left) / rect.width) * W
    const index = Math.round(((px - PAD.left) / plotW) * (viewPoints.length - 1))
    setAt(Math.max(0, Math.min(viewPoints.length - 1, index)))
  }

  if (!viewPoints.length) return <div className="rt-chart-empty">No readings yet</div>

  const gridLines = mode === 'interest' ? [0, 50, 100] : [0, activityMax / 2, activityMax]
  const lastInterest = interestPoints[interestPoints.length - 1] ?? null

  return (
    <figure className="rt-chart">
      <figcaption className="rt-legend">
        {mode === 'interest'
          ? <span data-series="now">Interest index</span>
          : <span data-series="now">Mentions discovered</span>}
        {mode === 'activity' && previousPath && <span data-series="prev">Previous period</span>}
      </figcaption>
      <div className="rt-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={mode === 'interest' ? 'Reddit interest over time' : 'Mentions discovered over time'}
          onPointerMove={move} onPointerLeave={() => setAt(null)}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--sc-ember)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--sc-ember)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridLines.map((value, index) => (
            <g key={index} className="rt-grid" data-strong={mode === 'interest' && value === 50 ? 'true' : undefined}>
              <line x1={PAD.left} x2={W - PAD.right}
                y1={mode === 'interest' ? yInterest(value) : yActivity(value)}
                y2={mode === 'interest' ? yInterest(value) : yActivity(value)} />
              <text x={PAD.left - 10} y={(mode === 'interest' ? yInterest(value) : yActivity(value)) + 4} textAnchor="end">
                {mode === 'interest' ? value : compact(value)}
              </text>
            </g>
          ))}

          {viewPoints.map((point, index) => (index % labelEvery === 0) && (
            <text key={point.bucket} className="rt-axis" x={x(index)} y={H - 8}
              textAnchor={index === 0 ? 'start' : index === viewPoints.length - 1 ? 'end' : 'middle'}>
              {shortBucket(point.bucket, bucketSize)}
            </text>
          ))}

          {mode === 'interest' ? (
            <>
              {interestArea && <path className="rt-area" d={interestArea} fill={`url(#${gradientId})`} />}
              {interestPath && <path className="rt-line" d={interestPath} />}
              {interestPoints.map((point, index) => <circle key={index} className="rt-dot-sm" cx={point.x} cy={point.y} r="2.4" />)}
              {lastInterest && (
                <>
                  <circle className="rt-dot-halo" cx={lastInterest.x} cy={lastInterest.y} r="8" />
                  <circle className="rt-dot" cx={lastInterest.x} cy={lastInterest.y} r="3.5" />
                </>
              )}
            </>
          ) : (
            <>
              {activityArea && <path className="rt-area" d={activityArea} fill={`url(#${gradientId})`} />}
              {previousPath && <path className="rt-line-prev" d={previousPath} />}
              {activityPath && <path className="rt-line" d={activityPath} />}
              <circle className="rt-dot" cx={x(activityValues.length - 1)} cy={yActivity(activityValues[activityValues.length - 1])} r="3.5" />
            </>
          )}

          {shown && at !== null && (
            <g className="rt-cross">
              <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + plotH} />
              {mode === 'interest' && shownInterest !== null && <circle cx={x(at)} cy={yInterest(shownInterest)} r="4.5" />}
              {mode === 'activity' && <circle cx={x(at)} cy={yActivity(activityValues[at])} r="4.5" />}
            </g>
          )}
        </svg>

        {shown && at !== null && (
          <div className="rt-tip" style={{
            left: `${leftPct}%`,
            transform: `translateX(${leftPct < 14 ? '0%' : leftPct > 86 ? '-100%' : '-50%'})`,
          }} role="status">
            <b>{shortBucket(shown.bucket, bucketSize)}</b>
            {mode === 'interest' && (
              <span><i className="rt-dot-legend rt-dot-now" aria-hidden />Interest <b>{shownInterest === null ? '—' : shownInterest.toFixed(1)}</b></span>
            )}
            <span><i className="rt-dot-legend rt-dot-now" aria-hidden /><b>{shownActivity ?? 0}</b> mentions</span>
            <span className="rt-dim">{shown.engagement} posts · {shown.interest === null ? 'baseline building' : `interest ${shown.interest.toFixed(1)}`}</span>
            {mode === 'activity' && viewPrevious[at] && (
              <span className="rt-dim">previous: {viewPrevious[at].activity} mentions</span>
            )}
          </div>
        )}
      </div>
    </figure>
  )
}
