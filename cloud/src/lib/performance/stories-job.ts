/**
 * Writing the weekly story read out: the one impure half of stories.ts, kept
 * apart so the thresholds and the wording stay testable without a database.
 */
import { loadBoard } from './load'
import { alert } from '../earnings/store'
import { eastern } from './shoutouts'
import { addDays } from '../dates'
import { composeStoryCadence, standingFor, STORY_CADENCE, type StoryStanding } from './stories'

/**
 * Monday's read, written as one social alert the bot picks up. Keyed by the
 * Monday so a second call in the same week does nothing.
 */
export async function storyCadenceAlerts(now = Date.now()) {
  const board = await loadBoard(STORY_CADENCE.windowDays, undefined, now)
  const standings = board.models.map(standingFor).filter((s): s is StoryStanding => s !== null)
  const et = eastern(now)
  const monday = addDays(et.date, -((et.weekday + 6) % 7))
  const body = composeStoryCadence(standings, `last ${STORY_CADENCE.windowDays} days`)
  if (!body) return { week_of: monday, models: standings.length, sent: false }
  await alert(`stories:${monday}`, body, 'social')
  return { week_of: monday, models: standings.length, sent: true }
}
