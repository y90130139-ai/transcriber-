'use client'

import { useId } from 'react'
import { compact, tickLabel, shortDay } from './format'
import { ticks, useChartHover } from './useChartHover'

type Point = { day: string; value: number }

const W = 720
const H = 200
/* Left and right gutters match so the plot sits centred in the panel. */
const PAD = { top: 12, right: 52, bottom: 28, left: 52 }

/** Views on the reels posted each day. Bars start at zero; a day with nothing
 *  posted is simply empty. `format` words the hover value (money, views). */
export default function BarChart({ series, label, emptyNote, format }: { series: Point[]; label: string; emptyNote: string; format?: (value: number) => string }) {
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const hover = useChartHover(series.length, PAD.left, plotW, W)
  if (!series.some((p) => p.value > 0)) return <p className="dash-empty">{emptyNote}</p>

  const scale = ticks(0, Math.max(...series.map((p) => p.value)))
  const hi = scale[scale.length - 1] || 1
  const slot = plotW / series.length
  const bar = Math.max(2, slot - 2)
  const cx = (i: number) => PAD.left + (series.length > 1 ? (i / (series.length - 1)) * (plotW - slot) + slot / 2 : plotW / 2)
  const y = (v: number) => PAD.top + plotH - (v / hi) * plotH
  const labelEvery = Math.max(1, Math.ceil(series.length / 6))
  const at = hover.index
  const shown = at === null ? null : series[at]

  return (
    <figure className="dash-chart">
      <div className="dash-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}
          onPointerMove={hover.onMove} onPointerLeave={hover.onLeave}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--sc-ember)" stopOpacity="0.95" />
              <stop offset="1" stopColor="var(--sc-ember)" stopOpacity="0.45" />
            </linearGradient>
          </defs>
          {scale.map((t) => (
            <g key={t} className="dash-grid">
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{tickLabel(t, scale[1] !== undefined ? scale[1] - scale[0] : t)}</text>
            </g>
          ))}
          {series.map((p, i) => p.value > 0 && (
            <rect key={p.day} className="dash-bar" data-on={at === i} fill={`url(#${gid})`}
              x={cx(i) - bar / 2} y={y(p.value)} width={bar} height={Math.max(1, PAD.top + plotH - y(p.value))} rx="3"
              style={{ animationDelay: `${Math.min(i * 10, 300)}ms` }} />
          ))}
          {series.map((p, i) => (i % labelEvery === 0 || i === series.length - 1) && (
            <text key={p.day} className="dash-axis" x={cx(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}>{shortDay(p.day)}</text>
          ))}
        </svg>
        {shown && at !== null && (
          <div className="dash-tip" style={{ left: `${(cx(at) / W) * 100}%` }} role="status">
            <b>{shortDay(shown.day)}</b>
            <span>{format ? format(shown.value) : `${shown.value.toLocaleString('en-US')} views`}</span>
          </div>
        )}
      </div>
    </figure>
  )
}
