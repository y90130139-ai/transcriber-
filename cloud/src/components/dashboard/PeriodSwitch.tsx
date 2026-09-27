export const PERIODS = [7, 30, 90] as const
export type Period = (typeof PERIODS)[number]

export default function PeriodSwitch({ value, onChange }: { value: Period; onChange: (next: Period) => void }) {
  return (
    <div className="dash-periods" role="group" aria-label="Period">
      {PERIODS.map((days) => (
        <button key={days} className="chip" data-on={value === days} aria-pressed={value === days} onClick={() => onChange(days)}>
          {days} days
        </button>
      ))}
    </div>
  )
}
