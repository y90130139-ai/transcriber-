/**
 * The assistant's alert tools. They are per question because a proposal
 * belongs to the chat it was asked in, and the bot needs the proposal ids to
 * put Save / Cancel buttons under the answer.
 */
import type { ToolSpec } from './core'
import { KIND_NAMES } from './watch-kinds'
import { propose, listWatches } from './watches'

export type AlertContext = { chat_id: string; asker: string | null; proposals: Array<{ id: string; label: string }> }

export function alertTools(ctx: AlertContext): ToolSpec[] {
  return [
    {
      name: 'propose_alert',
      description: [
        'Propose an alert the team asked for ("tell me when...", "let me know if..."). Nothing is watched until someone taps Save under your answer, so say that.',
        'Kinds (the only ones possible):',
        '- questionnaire_answered: a model finishes the questionnaire. Optional model.',
        '- questionnaire_opened: a model opens it. Optional model.',
        "- plan_not_opened: a sent plan is still unopened after `days` days (1-7). Optional model.",
        '- week_net_below: a model closes a Monday-Sunday week under `usd` dollars OnlyFans net. Optional model (else every active model).',
        '- reel_over_usual: a reel gets `times`x (1.5-100) her usual views. Optional model.',
        '- failed_downloads_above: failed reel downloads go above `count`. Whole library only.',
        'Do NOT propose what the bot already alerts OPS about: earnings days/weeks down 25%+, accounts gone from Infloww, Content Snare hand-ins or overdue items, the Drive pipeline, Instagram login problems, model questions on plans, shout-outs, scorecards. Say it already comes to OPS instead.',
        'Anything else: say it cannot be watched yet.',
      ].join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KIND_NAMES },
          model: { type: 'string', description: 'One model, if the alert is about one.' },
          days: { type: 'integer' }, usd: { type: 'number' }, times: { type: 'number' }, count: { type: 'integer' },
        },
        required: ['kind'],
      },
      run: async (input) => {
        const result = await propose(ctx.chat_id, ctx.asker, input.kind, input)
        if ('proposal_id' in result && result.proposal_id) ctx.proposals.push({ id: result.proposal_id, label: result.label })
        return result
      },
    },
    {
      name: 'list_alerts',
      description: 'The alerts saved in this chat: what each watches, since when, who set it, how many times it has fired.',
      input_schema: { type: 'object', properties: {} },
      run: () => listWatches(ctx.chat_id),
    },
  ]
}
