/**
 * The "Trends AI" box: a question in plain English, answered only from the
 * board's own data — Google's terms, the library's breakouts, the sounds.
 *
 * Two engines, strongest available first:
 *   anthropic   when ANTHROPIC_API_KEY is set (the same key decision as the
 *               OPS /q assistant — not on Vercel yet as of 2026-10-06)
 *   workers     gpt-oss-120b on Workers AI, already live for captions. On
 *               demand and single-shot, so a day of questions costs a sliver
 *               of the shared free allowance, never a sweep.
 *
 * One round, no tools: the grounding rides in the prompt, because everything
 * the answer may use is already on the board. What the data cannot answer,
 * the model is told to say it cannot answer.
 */
import Anthropic from '@anthropic-ai/sdk'
import { aiReady, askText, STRONG_WRITER_MODEL } from './ai'
import type { TrendsBoard } from './trends-feed'

const ANTHROPIC_MODEL = 'claude-sonnet-5-5'
const MAX_ANSWER_TOKENS = 700
export const MAX_QUESTION_CHARS = 500

export const TRENDS_PROMPT = `You are the Trends panel of a content console for an agency whose creators make short-form Instagram reels. Answer the team's question using ONLY the data below. Rules:
- Every claim must trace to a line in the data. No outside knowledge about what is trending; if the data cannot answer, say so plainly.
- When you name a trend, say which list it came from (Google search, library breakout, or sound).
- Useful answers connect lists: a Google term that matches a breakout's caption or a spreading sound is worth pointing out.
- Suggest at most 2–3 concrete video angles only when asked for ideas, each tied to a named data point.
- Plain text, short lines, no markdown headers or tables. Lead with the answer.`

/** The board as the model sees it. Pure, so tests can pin what leaks in —
 *  handles and captions from the library are fine; nothing else rides along. */
export function groundingText(board: TrendsBoard): string {
  const lines: string[] = []
  lines.push(`Data captured ${board.captured_on ?? 'never — no Google pull has run yet'}.`)
  lines.push('', `GOOGLE SEARCH TRENDS (US, today's top searches):`)
  if (board.terms.length === 0) lines.push('  (none stored yet)')
  for (const term of board.terms) {
    const bits = [`${term.rank}. ${term.term}`]
    if (term.traffic) bits.push(`~${term.traffic} searches`)
    if (term.rising) bits.push('NEW this week')
    if (term.news[0]) bits.push(`context: ${term.news[0].title}`)
    lines.push(`  ${bits.join(' · ')}`)
  }
  lines.push('', `LIBRARY BREAKOUTS (watched accounts' reels at 2x+ their usual plays, last 14 days):`)
  if (board.breakouts.length === 0) lines.push('  (none in the window)')
  for (const reel of board.breakouts) {
    const bits = [`@${reel.handle} at ${reel.multiple}x usual (${reel.plays.toLocaleString('en-US')} plays)`]
    if (reel.audio_title) bits.push(`sound: ${reel.audio_title}`)
    if (reel.caption) bits.push(`caption: ${reel.caption}`)
    lines.push(`  ${bits.join(' · ')}`)
  }
  lines.push('', `SOUNDS SPREADING (used by 2+ different watched creators, last 14 days):`)
  if (board.sounds.length === 0) lines.push('  (none in the window)')
  for (const sound of board.sounds) {
    lines.push(
      `  "${sound.title}"${sound.artist ? ` — ${sound.artist}` : ''} · ${sound.creators} creators · ` +
        `${sound.plays.toLocaleString('en-US')} plays · e.g. ${sound.sample_handles.map((h) => `@${h}`).join(', ')}`,
    )
  }
  return lines.join('\n')
}

export type TrendsAnswer = { answer: string; engine: 'anthropic' | 'workers' }

export async function answerTrends(question: string, board: TrendsBoard): Promise<TrendsAnswer> {
  const prompt = `${TRENDS_PROMPT}\n\n=== DATA ===\n${groundingText(board)}\n\n=== QUESTION ===\n${question}`

  if (process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 })
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_ANSWER_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
    const answer = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()
    if (!answer) throw new Error('the model answered with no text')
    return { answer, engine: 'anthropic' }
  }

  if (!aiReady()) throw new Error('no AI is configured — set ANTHROPIC_API_KEY or the Cloudflare AI token')
  const answer = await askText(prompt, { model: STRONG_WRITER_MODEL, maxTokens: MAX_ANSWER_TOKENS, temperature: 0.3 })
  if (!answer) throw new Error('the model answered with no text')
  return { answer, engine: 'workers' }
}
