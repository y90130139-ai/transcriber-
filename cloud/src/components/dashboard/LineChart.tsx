'use client'

import { compact, tickLabel, shortDay, signed } from './format'
import { ticks, useChartHover } from './useChartHover'

type Point = { day: string; value: number }

const W = 720
const H = 240
const PAD = { top: 12, right: 12, bottom: 28, left: 52 }

/**
 * One measure over the period, the previous period dashed behind it when there
 * is one. A single y axis, always — two measures get two charts.
 */
export default function LineChart({
  series, previous = [], label, emptyNote,
}: {
  series: Point[]
  previous?: Point[]
  label: string
  emptyNote: string
}) {
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const hover = useChartHover(series.length, PAD.left, plotW, W)
  if (series.length < 2) return <p className="dash-empty">{emptyNote}</p>

  const prev = previous.length >= 2 ? previous : []
  const all = [...series, ...prev].map((p) => p.value)
  const scale = ticks(Math.min(...all), Math.max(...all))
  const lo = scale[0]
  const hi = scale[scale.length - 1] === lo ? lo + 1 : scale[scale.length - 1]
  const x = (i: number, n: number) => PAD.left + (n > 1 ? (i / (n - 1)) * plotW : 0)
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH
  const path = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i, pts.length).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${path(series)} L${x(series.length - 1, series.length)},${PAD.top + plotH} L${PAD.left},${PAD.top + plotH} Z`
  const labelEvery = Math.max(1, Math.ceil(series.length / 6))
  const at = hover.index
  const shown = at === null ? null : series[at]

  return (
    <figure className="dash-chart">
      {prev.length > 0 && (
        <figcaption className="dash-legend">
          <span data-series="now">This period</span>
          <span data-series="prev">Previous period</span>
        </figcaption>
      )}
      <div className="dash-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}
          onPointerMove={hover.onMove} onPointerLeave={hover.onLeave}>
          {scale.map((t) => (
            <g key={t} className="dash-grid">
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{tickLabel(t, scale[1] !== undefined ? scale[1] - scale[0] : t)}</text>
            </g>
          ))}
          {series.map((p, i) => (i % labelEvery === 0 || i === series.length - 1) && (
            <text key={p.day} className="dash-axis" x={x(i, series.length)} y={H - 8} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}>{shortDay(p.day)}</text>
          ))}
          {prev.length > 0 && <path className="dash-line-prev" d={path(prev)} />}
          <path className="dash-area" d={area} />
          <path className="dash-line" d={path(series)} />
          <circle className="dash-dot" cx={x(series.length - 1, series.length)} cy={y(series[series.length - 1].value)} r="4" />
          {shown && at !== null && (
            <g className="dash-cross">
              <line x1={x(at, series.length)} x2={x(at, series.length)} y1={PAD.top} y2={PAD.top + plotH} />
              <circle cx={x(at, series.length)} cy={y(shown.value)} r="5" />
            </g>
          )}
        </svg>
        {shown && at !== null && (
          <div className="dash-tip" style={{ left: `${(x(at, series.length) / W) * 100}%` }} role="status">
            <b>{shortDay(shown.day)}</b>
            <span>{shown.value.toLocaleString('en-US')}</span>
            {at > 0 && <span className="dash-tip-sub">{signed(shown.value - series[at - 1].value)} that day</span>}
            {prev[at] && <span className="dash-tip-sub">Previous: {compact(prev[at].value)}</span>}
          </div>
        )}
      </div>
    </figure>
  )
}
