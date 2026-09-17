'use client'

import { HEAT_MARK, SITUATION_LABEL } from '@/lib/engagement'
import type { Standing } from '@/lib/standing'

/**
 * Her standing on the roster card, in one line: heat, priority, situation.
 *
 * A priority Geno set is shown plainly; one the console only suggests is shown
 * as a question, so a suggestion is never mistaken for a decision. The reason
 * sits in the title, because a 🧊 with no reason is an accusation.
 */
export default function StandingBadge({ standing }: { standing: Standing | undefined }) {
  if (!standing) return null
  const { engagement, suggestion, priority } = standing
  // Too new to read, unranked and nothing carried: say nothing. The card's
  // "not sent" flag already carries that, and a line repeated on seventeen
  // cards is a line nobody reads.
  if (engagement.heat === 'new' && !priority && !suggestion.priority && standing.backlog === 0) return null
  const mark = HEAT_MARK[engagement.heat]
  const situation = suggestion.situation ? SITUATION_LABEL[suggestion.situation] : null

  return (
    <span className="standing" data-heat={engagement.heat} title={engagement.why}>
      {mark && <span className="standing-mark" aria-label={engagement.heat === 'fire' ? 'On fire' : 'Cold'}>{mark}</span>}
      {priority ? (
        <b className="standing-tier">{priority}</b>
      ) : suggestion.priority ? (
        <span className="standing-tier" data-suggested="true">{suggestion.priority}?</span>
      ) : null}
      <span className="standing-why">
        {situation ?? (engagement.heat === 'new' ? engagement.why : engagement.score !== null ? `score ${engagement.score}` : '')}
      </span>
      {standing.backlog > 0 && <span className="standing-backlog">{standing.backlog} carried</span>}
    </span>
  )
}
