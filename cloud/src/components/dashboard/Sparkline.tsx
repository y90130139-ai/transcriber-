'use client'

import { useState, type PointerEvent } from 'react'

/** A trend at row height, or the lead card's area chart. No axis — the card's
 *  own numbers carry the values. Pass `format` and it also hovers: the value
 *  under the cursor, in the caller's own words. */
export default function Sparkline({ values, width = 96, height = 28, area = false, format }: {
  values: number[]
  width?: number
  height?: number
  area?: boolean
  format?: (value: number, index: number) => string
}) {
  const [at, setAt] = useState<number | null>(null)
  if (values.length < 2) return <span className="dash-spark-none" aria-hidden>—</span>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 2
  const x = (index: number) => pad + (index / (values.length - 1)) * (width - pad * 2)
  const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2)
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`)
  const rising = values[values.length - 1] >= values[0]
  const [lastX, lastY] = points[points.length - 1].split(',')

  function move(e: PointerEvent<HTMLSpanElement>) {
    if (!format) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const px = ((e.clientX - rect.left) / rect.width) * width
    const index = Math.round(((px - pad) / (width - pad * 2)) * (values.length - 1))
    setAt(Math.max(0, Math.min(values.length - 1, index)))
  }

  const frac = at === null || values.length < 2 ? 0 : at / (values.length - 1)
  const left = Math.min(Math.max(frac * 100, 14), 86)

  return (
    <span className="dash-spark-wrap" data-hover={format ? 'true' : undefined}
      onPointerMove={move} onPointerLeave={() => setAt(null)}>
      <svg className="dash-spark" data-rising={rising} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
        {area && <polygon className="dash-spark-fill" points={`${points.join(' ')} ${width - pad},${height} ${pad},${height}`} />}
        <polyline points={points.join(' ')} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {area && <circle cx={lastX} cy={lastY} r="3.5" />}
        {at !== null && format && <circle className="dash-spark-dot" cx={x(at)} cy={y(values[at])} r="4" />}
      </svg>
      {at !== null && format && (
        <span className="dash-spark-tip" style={{ left: `${left}%` }} role="status">{format(values[at], at)}</span>
      )}
    </span>
  )
}
