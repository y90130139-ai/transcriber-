/**
 * What the bot's shared reports may hand over. Pure and on its own, like the
 * Roster Health access rule beside it, so the thing that decides who sees what
 * can be tested without a database.
 */
/**
 * The reports bot_reports may hand over, as an allow-list rather than a
 * deny-list.
 *
 * The bot shares every report in one bag, and this tool is reachable by anyone
 * who can ask the assistant a question - which since the merger means a staff
 * group with people from the FansLink side in it. roster_health sits in that
 * same bag and is the whole Red October board: agency-wide money, each
 * creator's net, and what individual fans spend, by fan id. It reaches the
 * model only through the roster_health tool, which checks the chat first.
 *
 * An allow-list because the failure modes are not symmetrical: a new report
 * the bot starts sharing is unreadable here until someone adds it, which
 * somebody notices and nobody is harmed by. A deny-list would hand the next
 * sensitive report to everyone until somebody remembered.
 */
export const PUBLIC_TOPICS = new Set([
  'today',
  'open_requests_and_questions',
  'upcoming_calendar',
  'campaign_rsvps',
  'birthdays_next_90_days',
  'stories_and_streaks',
  'drive_pipeline',
  'content_snare',
])

/** One shape either way, so a caller does not have to narrow a union to find
 *  out it was refused. */
export type Report = { topic?: string; report?: string; available_topics?: string[]; note?: string }

/** Pure, so the rule above can be tested without a database. */
export function reportFor(topics: Record<string, string>, wanted: string): Report {
  const available = Object.keys(topics).filter((t) => PUBLIC_TOPICS.has(t))
  if (wanted && available.includes(wanted)) return { topic: wanted, report: topics[wanted] }
  // Naming a report it will not serve is not a leak - the system prompt
  // already says the board exists - and it stops the model trying again.
  const held = wanted && Object.hasOwn(topics, wanted)
  return {
    available_topics: available,
    ...(held ? { note: `${wanted} is not readable through this tool: it has its own, which checks the chat the question was asked in.` } : {}),
  }
}
