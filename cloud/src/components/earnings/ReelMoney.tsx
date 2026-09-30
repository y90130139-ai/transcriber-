'use client'

import type { ReelDay, ReelSummary } from '@/lib/earnings/reels'
import { money, niceDay } from '@/lib/earnings/report'

const views = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

/** One posting day: her reels and what the next two days made. */
export function ReelDayRow({ d, name }: { d: ReelDay & { model_name?: string }; name?: boolean }) {
  const top = d.reels[0]
  return (
    <li className="reel-day" data-hit={d.hit || undefined} data-moved={d.moved || undefined}>
      <div className="reel-day-when">
        {name && d.model_name && <b>{d.model_name}</b>}
        <span>{niceDay(d.day)}</span>
      </div>
      <div className="reel-day-reel">
        {top && (
          <a href={top.url} target="_blank" rel="noopener noreferrer">
            {top.caption?.trim() || `@${top.handle}`}
          </a>
        )}
        <small>
          {top ? `${views(top.plays)} views` : ''}
          {top?.multiple != null && ` · ${top.multiple}× her usual`}
          {d.reels.length > 1 && ` · +${d.reels.length - 1} more that day`}
        </small>
      </div>
      <div className="reel-day-money">
        <b>{money(d.net)}</b>
        <small>
          {d.moneyMultiple != null ? `${d.moneyMultiple}× her usual 2 days` : 'no baseline yet'}
          {` · ${d.subs} subs`}
          {!d.complete && ' · still counting'}
        </small>
      </div>
    </li>
  )
}

/** Her reels against her money. Internal: a coincidence in time, not proof. */
export default function ReelMoney({ days, summary }: { days: ReelDay[]; summary: ReelSummary }) {
  if (days.length === 0) return <p className="dash-empty">No reels of hers in this period, or her Instagram is not linked.</p>
  const verdict = summary.hitAvg !== null && summary.otherAvg !== null
    ? `After her hit reels (2×+ views) her next two days averaged ${summary.hitAvg}× her usual; after her other reels, ${summary.otherAvg}×.`
    : summary.hitDays === 0
      ? 'No hit reels (2×+ her usual views) in this period yet.'
      : 'Not enough days yet to compare hits with her other reels.'
  return (
    <>
      <p className="reel-verdict">{verdict}</p>
      <ul className="reel-days">
        {days.slice(0, 12).map((d) => <ReelDayRow key={d.day} d={d} />)}
      </ul>
      <p className="dash-foot">Money is the day she posted and the day after, against her usual two days. Timing, not proof: other things happen on those days too.</p>
    </>
  )
}
