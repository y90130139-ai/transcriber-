/**
 * A screenshot of an OnlyFans or Infloww stats screen → numbers, via Claude.
 *
 * The reader's one hard rule is that it copies printed numbers and never
 * estimates from a chart. OnlyFans draws most daily series as bars with the
 * value only in a hover tooltip; a reader that "reads" bar heights produces
 * plausible, wrong days, which is worse than no days. What was only visible as
 * a chart is listed in `chart_only`, and the review screen says so.
 *
 * Nothing extracted is saved until a person confirms it on the review screen.
 *
 * Server only. Needs ANTHROPIC_API_KEY.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { DAY_METRICS, METRIC_INFO, type Day, type DayMetric, type Link } from './metrics'

export const READER_MODEL = 'claude-opus-5'

export function readerReady(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const n = z.number().nullable()
const metricShape = Object.fromEntries(DAY_METRICS.map((m) => [m, n])) as Record<DayMetric, typeof n>

const Reading = z.object({
  screen: z.enum([
    'of_reach', 'of_earnings', 'of_statements', 'of_fans', 'of_engagement', 'of_tracking_links',
    'of_trial_links', 'of_mass_messages', 'of_post_stats', 'of_profile',
    'infloww_creator_report', 'infloww_tracking_links', 'infloww_trial_links', 'infloww_fan_report', 'other',
  ]),
  range_from: z.string().nullable().describe('YYYY-MM-DD, the first day of the date range shown on screen'),
  range_to: z.string().nullable().describe('YYYY-MM-DD, the last day of the date range shown on screen'),
  days: z.array(z.object({ day: z.string().describe('YYYY-MM-DD'), ...metricShape })),
  totals: z.object(metricShape),
  links: z.array(z.object({
    name: z.string(),
    kind: z.enum(['tracking', 'trial']),
    source: z.string().nullable(),
    clicks: n, subs: n, earnings: n, spenders: n, cost: n,
  })),
  messages: z.array(z.object({
    day: z.string().nullable(), label: z.string().nullable(),
    sent: n, viewed: n, purchases: n, price: n, revenue: n,
  })),
  page_type: z.enum(['free', 'paid']).nullable(),
  subscription_price: n,
  chart_only: z.array(z.string()).describe('Metrics visible only as a chart shape, with no printed number — NOT read'),
  warnings: z.array(z.string()),
})

export type Reading = z.infer<typeof Reading>

const GLOSSARY = DAY_METRICS.map((m) => `- ${m}: ${METRIC_INFO[m].label} — ${METRIC_INFO[m].definition}`).join('\n')

const INSTRUCTIONS = `You read screenshots of OnlyFans creator statistics and Infloww reports for an agency, and copy the numbers into a fixed structure.

Rules — accuracy matters more than completeness:
1. Copy only numbers printed as text on the screen (table cells, totals, labels, an open tooltip). Never estimate a value from the height of a bar or the position of a line. If a metric appears only as a chart, add its key to chart_only and leave it null.
2. Leave anything not shown as null. Do not compute a number that is not printed, except that "1.2K" means 1200 and "$1.2K" means 1200.
3. Money is in dollars without symbols. If the screen offers gross and net and shows gross, say so in warnings.
4. Days are YYYY-MM-DD. If the year is not shown, infer it from the date range and say so in warnings. A per-day value goes in days; a value for the whole range shown goes in totals.
5. Map labels to these keys:
${GLOSSARY}
6. Tracking links and free-trial links go in links (trial "claims" go in subs). Mass messages go in messages. Put the link's traffic source (Instagram, Reddit, TikTok…) in source when its name or a tag makes it clear.
7. Warn about anything that could mislead: a range grouped into weeks or months instead of days, a cropped table, a partially covered number, a time zone shown, numbers you are unsure of.`

/** Read one screenshot. `image` is raw bytes; `mediaType` its type. */
export async function readScreenshot(image: Buffer, mediaType: 'image/png' | 'image/jpeg' | 'image/webp', hint?: string): Promise<Reading> {
  const client = new Anthropic()
  const response = await client.beta.messages.parse({
    model: READER_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { format: betaZodOutputFormat(Reading), effort: 'medium' },
    system: INSTRUCTIONS,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
        { type: 'text', text: hint ? `Context from the person uploading: ${hint}` : 'Read this screen.' },
      ],
    }],
  })
  if (response.stop_reason === 'refusal') throw new Error('The reader declined this image.')
  if (response.stop_reason === 'max_tokens') throw new Error('The screen held more than the reader could copy in one go — crop it into two screenshots.')
  if (!response.parsed_output) throw new Error('The reader returned nothing usable.')
  return response.parsed_output
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Drop nulls so a reading merges over stored days without blanking them. */
export function readingToDays(reading: Reading): Day[] {
  return reading.days
    .filter((d) => ISO.test(d.day))
    .map((d) => {
      const day: Day = { day: d.day }
      for (const m of DAY_METRICS) {
        const value = d[m]
        if (typeof value === 'number' && Number.isFinite(value)) day[m] = value
      }
      return day
    })
    .filter((d) => Object.keys(d).length > 1)
}

export function readingToLinks(reading: Reading): Link[] {
  return reading.links.map((l) => ({ ...l, name: l.name.trim() })).filter((l) => l.name)
}
