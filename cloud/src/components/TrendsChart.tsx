'use client'

/**
 * The interest-over-time graph — Google Trends' own instrument in the
 * console's clothes (2026-10-08, Geno's "pulls up the graph" ask): one
 * area + line per term, a hairline grid, and a crosshair that reads every
 * series at the hovered point. Hand-drawn SVG; the codebase carries no
 * chart dependency and does not want one.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { interestStamp, interestTick, type InterestPoint, type InterestRange } from '@/lib/trends-feed'

/** Series one through five, in the console's palette — ember first, then
 *  hues chosen to stay apart on the near-black ground. */
export const SERIES_COLORS = ['#E8663A', '#4E9E76', '#C0942A', '#E0685E', '#A8A29A']

const H = 340
const PAD = { top: 16, right: 18, bottom: 32, left: 40 }
const GRID = [25, 50, 75, 100]

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
    const innerH = H - PAD.top - PAD.bottom
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
    const ticks = [0, 0.25, 0.5, 0.75, 1]
      .map((fraction) => Math.round(fraction * (points.length - 1)))
      .filter((index, position, all) => all.indexOf(index) === position)
    return { xAt, yAt, lines, areas, ticks }
  }, [width, points, terms])

  const flat = points.length > 0 && terms.every((_, series) => points.every((point) => (point.v[series] ?? 0) === 0))
  const thin = points.length > 0 && points.length < 2
  const shown = !loading && !error && !flat && !thin && chart !== null
  const tipLeft = hover !== null && chart ? Math.max(10, Math.min(chart.xAt(hover) + 16, width - 200)) : 0

  return (
    <div className="trends-chart-box" ref={box}>
      {loading && <p className="trends-chart-veil">Reading Google Trends…</p>}
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
          height={H}
          role="img"
          aria-label={`Search interest over time for ${terms.join(', ')}`}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const fraction = (event.clientX - rect.left - PAD.left) / (width - PAD.left - PAD.right)
            setHover(Math.max(0, Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))))
          }}
          onMouseLeave={() => setHover(null)}
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
              y={H - 10}
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
          {hover !== null && (
            <g>
              <line x1={chart.xAt(hover)} x2={chart.xAt(hover)} y1={PAD.top} y2={H - PAD.bottom} className="trends-cursor" />
              {terms.map((_, series) => (
                <circle
                  key={series}
                  cx={chart.xAt(hover)}
                  cy={chart.yAt(points[hover].v[series] ?? 0)}
                  r={3.5}
                  className="trends-cursor-dot"
                  style={{ fill: SERIES_COLORS[series] }}
                />
              ))}
            </g>
          )}
        </svg>
      )}
      {shown && hover !== null && (
        <div className="trends-tip" style={{ left: tipLeft }}>
          <p className="trends-tip-when">{interestStamp(points[hover].t, range)}</p>
          {terms.map((term, series) => (
            <p key={term} className="trends-tip-row">
              <i style={{ background: SERIES_COLORS[series] }} />
              <span>{term}</span>
              <b>{points[hover].v[series] ?? 0}</b>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
