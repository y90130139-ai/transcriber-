/**
 * Roster Health, the half that touches the database: the payload the bot
 * shared, and the tool the assistant calls. The arithmetic, the instructions
 * and the access rule are in ./roster-health, which stays pure so the rules
 * that decide who sees fan ids can be tested without a database.
 */
import { sql } from '@/lib/db'
import type { ToolSpec } from './core'
import { GUIDANCE, audienceFor, slice, type Payload } from './roster-health'

/** The payload the bot last shared, or why there is none. */
export async function loadPayload(): Promise<{ payload: Payload | null; note?: string }> {
  const [row] = await sql.query(`select generated_at, topics from transcriber.bot_snapshot where id = 'latest'`)
  if (!row) return { payload: null, note: 'The bot has not shared its reports yet (it does so hourly).' }
  const raw = (row.topics as Record<string, string>)?.roster_health
  if (!raw) return { payload: null, note: 'Roster Health is not in the bot\'s last snapshot: it is switched off in the calendar (roster_health.enabled), or its Infloww mirror is empty.' }
  try {
    return { payload: JSON.parse(raw) as Payload }
  } catch {
    return { payload: null, note: 'The bot shared a Roster Health payload this run that could not be read.' }
  }
}

/**
 * The tool, per question, because what it may hand back depends on the chat
 * the question was asked in. The desk instructions ride on the first call and
 * not the ones after it - they are long, and the model has them by then.
 */
export function rosterHealthTools(ctx: { chat_id: string }): ToolSpec[] {
  let briefed = false
  return [
    {
      name: 'roster_health',
      description: [
        'The Red October board: how many creators are finishing this month below their own previous month, who can still be turned, and the play to run on each.',
        'Use it for: "who is in the red", "are we going to make the goal", "flip board", "who can we turn", "brief for <name>", "how is the win-back going", "which hours went quiet", anything about the month against last month.',
        'Call it with no arguments first - that is the board: the agency line, the roster, the goal, and a thin row for every creator in trouble. Then call it again with `tier` (hold, push, stretch, not_this_month, at_risk) or `creator` for the full cards, which carry the plays, the idle fans and the whales.',
        'Every figure in it was computed by the bot from the Infloww transaction mirror. Net is the creator\'s own, after OnlyFans\' cut - never Gosian\'s margin. The first call also returns the instructions for how to write the answer; follow them.',
      ].join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          tier: { type: 'string', enum: ['hold', 'push', 'stretch', 'not_this_month', 'at_risk'], description: 'Full cards for one band of the board.' },
          creator: { type: 'string', description: 'One creator, as the board spells her name.' },
        },
      },
      run: async (input: Record<string, unknown>) => {
        const who = audienceFor(ctx.chat_id)
        if ('refusal' in who) return { refused: who.refusal }
        const { payload, note } = await loadPayload()
        if (!payload) return { note }
        const body = slice(payload, { tier: input.tier as string | undefined, creator: input.creator as string | undefined }, who.fans)
        if (briefed) return body
        briefed = true
        return { guidance: GUIDANCE, ...body }
      },
    },
  ]
}
