'use client'

import { labelOfPlatform, showCount } from '@/lib/socials'
import { deltaOf, reachByPlatform, sparkHeights, type Reading } from './reach'

/**
 * The strip under her name: reach per account, and what the library holds.
 *
 * Follower counts are typed in by hand today — Instagram will not hand them
 * over until App Review clears, and that has not been submitted. That is not a
 * placeholder: a figure somebody read off a phone on a Monday is a real
 * reading, and two of them a fortnight apart answer the only question worth
 * asking here, which is whether the weeks we plan are moving her. When Insights
 * lands it writes into the same table with `source = 'insights'` and this
 * component does not change.
 */
export default function ProfileFigures({
  readings,
  posts,
  week,
  onRecord,
}: {
  readings: Reading[]
  /** How many of her own posts the library already holds. */
  posts: number
  /** This week at a glance, when the sheet was opened from the roster. Null on
   *  a model being created, who has no week yet. */
  week: { items: number; filmed: number } | null
  /** Takes you to the box where a reading is recorded. */
  onRecord: () => void
}) {
  const reach = reachByPlatform(readings)

  return (
    <div className="sheet-stats">
      {reach.length === 0 ? (
        <div className="sheet-stat">
          <u>Followers</u>
          <b>—</b>
          <button className="axis-confirm" onClick={onRecord} style={{ textAlign: 'left' }}>
            Record one
          </button>
        </div>
      ) : (
        reach.map((row) => {
          const delta = deltaOf(row)
          const heights = sparkHeights(row.series)
          return (
            <div className="sheet-stat" key={row.platform}>
              <u>{labelOfPlatform(row.platform)}</u>
              <b>{showCount(row.now)}</b>
              <span className="sheet-delta" data-way={delta?.way}>
                {delta ? delta.text : 'first reading'}
              </span>
              {heights.length > 1 && (
                <span
                  className="sheet-spark"
                  aria-label={`${row.series.length} readings, ${showCount(row.series[0])} to ${showCount(row.now)}`}
                >
                  {heights.map((height, index) => (
                    <i key={index} style={{ height: `${height}%` }} />
                  ))}
                </span>
              )}
            </div>
          )
        })
      )}

      <div className="sheet-stat">
        <u>Her posts here</u>
        <b>{posts}</b>
        <span className="sheet-delta">
          {posts === 0 ? 'none ingested' : 'in the library'}
        </span>
      </div>

      {week && (
        <div className="sheet-stat">
          <u>This week</u>
          <b>{week.filmed}/{week.items}</b>
          <span className="sheet-delta">filmed</span>
        </div>
      )}
    </div>
  )
}
