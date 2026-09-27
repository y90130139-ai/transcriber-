'use client'

import { useCallback, useState, type PointerEvent } from 'react'

/** Which point the pointer is over, snapped to the nearest index across the
 *  plot's width — the crosshair's job, shared by the line and the bars. */
export function useChartHover(count: number, left: number, plotWidth: number, viewWidth: number) {
  const [index, setIndex] = useState<number | null>(null)
  const onMove = useCallback((event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * viewWidth
    const step = count > 1 ? plotWidth / (count - 1) : plotWidth
    const next = Math.round((x - left) / step)
    setIndex(Math.max(0, Math.min(count - 1, next)))
  }, [count, left, plotWidth, viewWidth])
  return { index, onMove, onLeave: () => setIndex(null) }
}

/** Four round steps from zero-or-min to max, for a recessive y axis. */
export function ticks(min: number, max: number, count = 4): number[] {
  if (max === min) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const out: number[] = []
  // Up to the first step at or above the max, so the highest point is inside
  // the plot rather than cut off by its top edge.
  for (let v = start; out.length === 0 || out[out.length - 1] < max - step * 0.001; v += step) out.push(v)
  return out
}
