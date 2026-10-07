/** Mini bars under a stat — one per day of the period. Decoration only; the
 *  number above is the truth. */
export default function MicroBars({ values, tone, count = 10 }: { values: number[]; tone?: 'amber'; count?: number }) {
  const slice = values.slice(-count)
  const max = Math.max(...slice, 1)
  return (
    <div className="dash-micro" data-tone={tone} aria-hidden>
      {slice.map((value, index) => (
        <i key={index} style={{ height: `${Math.max((value / max) * 100, 16)}%` }} />
      ))}
    </div>
  )
}
