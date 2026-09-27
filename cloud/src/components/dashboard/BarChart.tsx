'use client'

import { compact, tickLabel, shortDay } from './format'
import { ticks, useChartHover } from './useChartHover'

type Point = { day: string; value: number }

const W = 720
const H = 200
const PAD = { top: 12, right: 12, bottom: 28, left: 52 }

/** Views on the reels posted each day. Bars start at zero; a day with nothing
 *  posted is simply empty. */
export default function BarChart({ series, label, emptyNote }: { series: Point[]; label: string; emptyNote: string }) {
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
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
          {scale.map((t) => (
            <g key={t} className="dash-grid">
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{tickLabel(t, scale[1] !== undefined ? scale[1] - scale[0] : t)}</text>
            </g>
          ))}
          {series.map((p, i) => p.value > 0 && (
            <rect key={p.day} className="dash-bar" data-on={at === i}
              x={cx(i) - bar / 2} y={y(p.value)} width={bar} height={Math.max(1, PAD.top + plotH - y(p.value))} rx="2" />
          ))}
          {series.map((p, i) => (i % labelEvery === 0 || i === series.length - 1) && (
            <text key={p.day} className="dash-axis" x={cx(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}>{shortDay(p.day)}</text>
          ))}
        </svg>
        {shown && at !== null && (
          <div className="dash-tip" style={{ left: `${(cx(at) / W) * 100}%` }} role="status">
            <b>{shortDay(shown.day)}</b>
            <span>{shown.value.toLocaleString('en-US')} views</span>
          </div>
        )}
      </div>
    </figure>
  )
}
