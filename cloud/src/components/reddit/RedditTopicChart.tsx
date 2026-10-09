'use client'

import { useId, useMemo, useState, type PointerEvent } from 'react'
import type { TopicDetail } from '@/lib/reddit/queries'

const W = 880
const H = 300
const PAD = { top: 18, right: 46, bottom: 32, left: 48 }

type Reading = TopicDetail['history'][number]
type XY = { x: number; y: number }

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

function timeLabel(iso: string, hourResolution: boolean): string {
  const date = new Date(iso)
  if (hourResolution) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

/**
 * One topic's growth: two lines over its own scored readings — mentions on
 * the left scale, the interest index (0–100) on the right. Every point is a
 * real reading; nothing is interpolated beyond drawing the line itself.
 */
export default function RedditTopicChart({ history }: { history: Reading[] }) {
  const [at, setAt] = useState<number | null>(null)
  const gradientId = useId()

  const readings = useMemo(
    () => [...history]
      .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at))
      .slice(-64),
    [history],
  )

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const mentionsMax = Math.max(1, ...readings.map((reading) => reading.mentions)) * 1.15
  const hourResolution = readings.length > 1
    ? (Date.parse(readings[readings.length - 1].captured_at) - Date.parse(readings[0].captured_at)) < 48 * 3_600_000
    : true

  const x = (index: number) => PAD.left + (readings.length > 1 ? (index / (readings.length - 1)) * plotW : plotW / 2)
  const yMentions = (value: number) => PAD.top + plotH - (Math.min(value, mentionsMax) / mentionsMax) * plotH
  const yInterest = (value: number) => PAD.top + plotH - (Math.min(100, Math.max(0, value)) / 100) * plotH

  const mentionsPoints = useMemo(
    () => readings.map((reading, index) => ({ x: x(index), y: yMentions(reading.mentions) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readings, plotW, plotH],
  )
  const interestRuns = useMemo(() => {
    const runs: XY[][] = []
    let run: XY[] = []
    readings.forEach((reading, index) => {
      if (reading.interest !== null && Number.isFinite(reading.interest)) {
        run.push({ x: x(index), y: yInterest(reading.interest) })
      } else if (run.length) { runs.push(run); run = [] }
    })
    if (run.length) runs.push(run)
    return runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings, plotW, plotH])

  const labelEvery = Math.max(1, Math.ceil(readings.length / 7))
  const shown = at === null ? null : readings[at]
  const leftPct = at === null ? 50 : (x(at) / W) * 100
  const lastInterest = interestRuns.length ? interestRuns[interestRuns.length - 1].at(-1) ?? null : null

  function move(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const px = ((event.clientX - rect.left) / rect.width) * W
    const index = Math.round(((px - PAD.left) / plotW) * (readings.length - 1))
    setAt(Math.max(0, Math.min(readings.length - 1, index)))
  }

  if (readings.length < 2) return <div className="rt-chart-empty">Building history</div>

  const compact = (value: number) => Intl.NumberFormat('en-US', { notation: 'compact' }).format(Math.round(value))

  return (
    <figure className="rt-chart">
      <figcaption className="rt-legend">
        <span data-series="grid">Mentions</span>
        <span data-series="now">Interest index</span>
      </figcaption>
      <div className="rt-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Topic growth over time"
          onPointerMove={move} onPointerLeave={() => setAt(null)}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--sc-ember)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--sc-ember)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((fraction) => {
            const value = mentionsMax * fraction
            return (
              <g key={fraction} className="rt-grid">
                <line x1={PAD.left} x2={W - PAD.right} y1={yMentions(value)} y2={yMentions(value)} />
                <text x={PAD.left - 10} y={yMentions(value) + 4} textAnchor="end">{compact(value)}</text>
              </g>
            )
          })}
          {[0, 50, 100].map((value) => (
            <g key={value} className="rt-grid rt-grid-right">
              <text x={W - PAD.right + 10} y={yInterest(value) + 4} textAnchor="start">{value}</text>
            </g>
          ))}

          {readings.map((reading, index) => (index % labelEvery === 0) && (
            <text key={reading.captured_at} className="rt-axis" x={x(index)} y={H - 8}
              textAnchor={index === 0 ? 'start' : index === readings.length - 1 ? 'end' : 'middle'}>
              {timeLabel(reading.captured_at, hourResolution)}
            </text>
          ))}

          {/* mentions: a quiet line so the ember interest line reads first */}
          <path className="rt-line-muted" d={smoothPath(mentionsPoints, PAD.top, PAD.top + plotH)} />
          {mentionsPoints.map((point, index) => <circle key={index} className="rt-dot-muted" cx={point.x} cy={point.y} r="2" />)}

          {interestRuns.map((run, index) => {
            const line = smoothPath(run, PAD.top, PAD.top + plotH)
            const area = run.length > 1
              ? `${line} L${run[run.length - 1].x.toFixed(1)},${PAD.top + plotH} L${run[0].x.toFixed(1)},${PAD.top + plotH} Z`
              : ''
            return (
              <g key={index}>
                {area && <path className="rt-area" d={area} fill={`url(#${gradientId})`} />}
                <path className="rt-line" d={line} />
              </g>
            )
          })}
          {lastInterest && (
            <>
              <circle className="rt-dot-halo" cx={lastInterest.x} cy={lastInterest.y} r="8" />
              <circle className="rt-dot" cx={lastInterest.x} cy={lastInterest.y} r="3.5" />
            </>
          )}

          {at !== null && (
            <g className="rt-cross">
              <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + plotH} />
            </g>
          )}
        </svg>

        {shown && at !== null && (
          <div className="rt-tip" style={{
            left: `${leftPct}%`,
            transform: `translateX(${leftPct < 14 ? '0%' : leftPct > 86 ? '-100%' : '-50%'})`,
          }} role="status">
            <b>{timeLabel(shown.captured_at, hourResolution)}</b>
            <span><i className="rt-dot-legend rt-dot-bar" aria-hidden /><b>{shown.mentions}</b> mentions · {shown.authors} authors</span>
            <span><i className="rt-dot-legend rt-dot-now" aria-hidden />Interest <b>{shown.interest === null ? '—' : shown.interest.toFixed(1)}</b></span>
            <span className="rt-dim">
              {shown.communities} communities
              {shown.velocity !== null ? ` · ${Math.round(shown.velocity).toLocaleString('en-US')}/h` : ''}
              {shown.growth !== null ? ` · ${shown.growth > 0 ? '+' : ''}${Math.round(shown.growth * 100)}%` : ''}
            </span>
          </div>
        )}
      </div>
    </figure>
  )
}
