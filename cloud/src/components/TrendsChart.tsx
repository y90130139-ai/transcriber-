'use client'

/**
 * The interest-over-time graph — Google Trends' own instrument in the
 * console's clothes (2026-10-08, Geno's "pulls up the graph" ask): one
 * area + line per term, a hairline grid, and a crosshair that reads every
 * series at the hovered point. Hand-drawn SVG; the codebase carries no
 * chart dependency and does not want one.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { interestStamp, interestTick, type InterestPoint, type InterestRange } from '@/lib/trends-feed'

/** Series one through five, in the console's palette — ember first, then
 *  hues chosen to stay apart on the near-black ground. */
export const SERIES_COLORS = ['var(--sc-ember)', 'var(--sc-positive)', 'var(--sc-caution)', 'var(--sc-critical)', 'var(--sc-ink-500)']

const H = 300
const MOBILE_H = 240
const PAD = { top: 16, right: 18, bottom: 32, left: 40 }
const GRID = [0, 25, 50, 75, 100]

type Props = {
  terms: string[]
  points: InterestPoint[]
  range: InterestRange
  loading: boolean
  error: string | null
  onRetry: () => void
}

export default function TrendsChart({ terms, points, range, loading, error, onRetry }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const height = width > 0 && width < 520 ? MOBILE_H : H

  // The chart draws at real pixel width — no viewBox stretching, so the
  // axis type stays crisp at every page width.
  useEffect(() => {
    const element = box.current
    if (!element) return
    const update = () => setWidth(element.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => setHover(null), [points])

  const chart = useMemo(() => {
    if (width < 120 || points.length < 2) return null
    const innerW = width - PAD.left - PAD.right
    const innerH = height - PAD.top - PAD.bottom
    const xAt = (index: number) => PAD.left + (index / (points.length - 1)) * innerW
    const yAt = (value: number) => PAD.top + innerH - (Math.max(0, Math.min(value, 100)) / 100) * innerH
    const lines = terms.map((_, series) =>
      points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)} ${yAt(point.v[series] ?? 0).toFixed(1)}`)
        .join(' '),
    )
    const base = (PAD.top + innerH).toFixed(1)
    const areas = lines.map(
      (line) => `${line} L${xAt(points.length - 1).toFixed(1)} ${base} L${PAD.left.toFixed(1)} ${base} Z`,
    )
    const ticks = (width < 520 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1])
      .map((fraction) => Math.round(fraction * (points.length - 1)))
      .filter((index, position, all) => all.indexOf(index) === position)
    return { xAt, yAt, lines, areas, ticks }
  }, [width, height, points, terms])

  const flat = points.length > 0 && terms.every((_, series) => points.every((point) => (point.v[series] ?? 0) === 0))
  const thin = points.length < 2
  const shown = !loading && !error && !flat && !thin && chart !== null
  const hoveredPoint = hover === null ? undefined : points[hover]
  const tipWidth = Math.min(240, Math.max(0, width - 16))
  const tipLeft = hover !== null && chart ? Math.max(8, Math.min(chart.xAt(hover) + 16, width - tipWidth - 8)) : 0

  function inspectPoint(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientX - rect.left - PAD.left) / (width - PAD.left - PAD.right)
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))))
  }

  return (
    <div className="trends-chart-box" ref={box} style={{ minHeight: `calc(${height}px + var(--sc-space-3) + 1px)` }} aria-busy={loading}>
      {loading && <p className="trends-chart-veil" role="status">Reading Google Trends…</p>}
      {!loading && error && (
        <div className="trends-chart-veil">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      )}
      {!loading && !error && (flat || thin) && (
        <p className="trends-chart-veil">
          Not enough search data for {terms.length === 1 ? `“${terms[0]}”` : 'this comparison'} in this window —
          try a wider range.
        </p>
      )}
      {shown && (
        <svg
          width={width}
          height={height}
          role="img"
          tabIndex={0}
          aria-label={`Search interest over time for ${terms.join(', ')}. Use the left and right arrow keys to inspect readings.`}
          onPointerDown={inspectPoint}
          onPointerMove={inspectPoint}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover((current) => current ?? points.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') return setHover(null)
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            setHover((current) => {
              if (event.key === 'Home') return 0
              if (event.key === 'End') return points.length - 1
              return Math.max(0, Math.min(points.length - 1, (current ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1)))
            })
          }}
        >
          {GRID.map((value) => (
            <g key={value}>
              <line x1={PAD.left} x2={width - PAD.right} y1={chart.yAt(value)} y2={chart.yAt(value)} className="trends-grid-line" />
              <text x={PAD.left - 8} y={chart.yAt(value) + 3.5} className="trends-axis" textAnchor="end">{value}</text>
            </g>
          ))}
          {chart.ticks.map((index) => (
            <text
              key={index}
              x={chart.xAt(index)}
              y={height - 10}
              className="trends-axis"
              textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
            >
              {interestTick(points[index].t, range)}
            </text>
          ))}
          {terms.map((_, series) => (
            <path key={`area-${series}`} d={chart.areas[series]} className="trends-area" style={{ fill: SERIES_COLORS[series] }} />
          ))}
          {terms.map((_, series) => (
            <path key={`line-${series}`} d={chart.lines[series]} className="trends-line" style={{ stroke: SERIES_COLORS[series] }} />
          ))}
          {hover !== null && hoveredPoint && (
            <g>
              <line x1={chart.xAt(hover)} x2={chart.xAt(hover)} y1={PAD.top} y2={height - PAD.bottom} className="trends-cursor" />
              {terms.map((_, series) => (
                <circle
                  key={series}
                  cx={chart.xAt(hover)}
                  cy={chart.yAt(hoveredPoint.v[series] ?? 0)}
                  r={3.5}
                  className="trends-cursor-dot"
                  style={{ fill: SERIES_COLORS[series] }}
                />
              ))}
            </g>
          )}
        </svg>
      )}
      {shown && hover !== null && hoveredPoint && (
        <div className="trends-tip" style={{ left: tipLeft, width: tipWidth }}>
          <p className="trends-tip-when">{interestStamp(hoveredPoint.t, range)}</p>
          {terms.map((term, series) => (
            <p key={term} className="trends-tip-row">
              <i style={{ background: SERIES_COLORS[series] }} />
              <span>{term}</span>
              <b>{hoveredPoint.v[series] ?? 0}</b>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
