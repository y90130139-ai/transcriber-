/**
 * The Trends ask: a question in plain English, answered only from the board's
 * own data — Google's terms, the library's breakouts, the sounds.
 *
 * Engines, strongest available first:
 *   azure     Azure AI Foundry (the invoice app's deployment; Geno,
 *             2026-10-08) when AZURE_AI_FOUNDRY_* is configured
 *   workers   gpt-oss-120b on Workers AI, already live for captions, as the
 *             fallback so the box keeps answering if the key is absent
 *
 * One round, no tools: the grounding rides in the prompt, because everything
 * the answer may use is already on the board. The answer must show its work —
 * the exact figures each claim is built on — and what the data cannot answer,
 * the model is told to say it cannot answer.
 */
import { azureChat, azureReady } from './azure-ai'
import { aiReady, askText, STRONG_WRITER_MODEL } from './ai'
import { startedLabel, volumeLabel, type TrendsBoard } from './trends-feed'

/** Enough of the live list to answer with; 2,000 rows would drown it. */
const LIVE_GROUNDING_ROWS = 40

const MAX_ANSWER_TOKENS = 700
export const MAX_QUESTION_CHARS = 500

export const TRENDS_PROMPT = `You are the Trends panel of a content console for an agency whose creators make short-form Instagram reels. Answer the team's question using ONLY the data below. Rules:
- Show the data: quote the exact figures each claim is built on (the term and its volume or +%, the reel's plays and multiple, the sound's creator count).
- Every claim must trace to a line in the data. No outside knowledge about what is trending; if the data cannot answer, say so plainly.
- When you name a trend, say which list it came from (Google search, library breakout, or sound).
- Useful answers connect lists: a Google term that matches a breakout's caption or a spreading sound is worth pointing out.
- Suggest at most 2–3 concrete video angles only when asked for ideas, each tied to a named data point.
- Plain text, short lines, no markdown headers or tables. Lead with the answer.`

/** The board as the model sees it. Pure, so tests can pin what leaks in —
 *  handles and captions from the library are fine; nothing else rides along. */
export function groundingText(board: TrendsBoard): string {
  const window = board.days === 1 ? 'the past 24 hours' : `the past ${board.days} days`
  const lines: string[] = []

  // Google's own live Trending Now list carries the most signal — volume,
  // the spike, and the breakdown terms that say what each trend is about.
  // The daily archive only speaks when the live endpoint would not answer.
  const live = (board.live ?? []).slice(0, LIVE_GROUNDING_ROWS)
  if (live.length > 0) {
    const where = board.geo && board.geo !== 'US' ? board.geo : 'US'
    lines.push(`GOOGLE TRENDING NOW (${where}, ${window}; by search volume):`)
    for (const trend of [...live].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))) {
      const bits = [trend.term]
      if (trend.volume !== null) bits.push(`${volumeLabel(trend.volume)} searches`)
      if (trend.pct !== null) bits.push(`+${trend.pct.toLocaleString('en-US')}%`)
      const since = startedLabel(trend.started)
      if (since) bits.push(`started ${since}`)
      if (trend.breakdown.length > 0) bits.push(`about: ${trend.breakdown.slice(0, 5).join(', ')}`)
      lines.push(`  ${bits.join(' · ')}`)
    }
  } else {
    lines.push(`GOOGLE SEARCH TRENDS (US daily archive, captured ${board.captured_on ?? 'never'}):`)
    if (board.terms.length === 0) lines.push('  (none stored yet)')
    for (const term of board.terms) {
      const bits = [`${term.rank}. ${term.term}`]
      if (term.traffic) bits.push(`~${term.traffic} searches`)
      if (term.rising) bits.push('NEW this week')
      if (board.days > 1) bits.push(`charted ${term.days_seen} of ${board.days} days, trend ${term.direction}`)
      if (term.news[0]) bits.push(`context: ${term.news[0].title}`)
      lines.push(`  ${bits.join(' · ')}`)
    }
  }
  lines.push('', `LIBRARY BREAKOUTS (watched accounts' reels at 2x+ their usual plays, ${window}):`)
  if (board.breakouts.length === 0) lines.push('  (none in the window)')
  for (const reel of board.breakouts) {
    const bits = [`@${reel.handle} at ${reel.multiple}x usual (${reel.plays.toLocaleString('en-US')} plays)`]
    if (reel.audio_title) bits.push(`sound: ${reel.audio_title}`)
    if (reel.caption) bits.push(`caption: ${reel.caption}`)
    lines.push(`  ${bits.join(' · ')}`)
  }
  lines.push('', `SOUNDS SPREADING (used by 2+ different watched creators, ${window}):`)
  if (board.sounds.length === 0) lines.push('  (none in the window)')
  for (const sound of board.sounds) {
    lines.push(
      `  "${sound.title}"${sound.artist ? ` — ${sound.artist}` : ''} · ${sound.creators} creators (trend ${sound.direction}) · ` +
        `${sound.plays.toLocaleString('en-US')} plays · e.g. ${sound.sample_handles.map((h) => `@${h}`).join(', ')}`,
    )
  }
  return lines.join('\n')
}

export type TrendsAnswer = {
  answer: string
  engine: 'azure' | 'workers'
}

export async function answerTrends(question: string, board: TrendsBoard): Promise<TrendsAnswer> {
  const data = `=== DATA ===\n${groundingText(board)}\n\n=== QUESTION ===\n${question}`

  if (azureReady()) {
    const answer = await azureChat(TRENDS_PROMPT, data)
    if (!answer) throw new Error('the model answered with no text')
    return { answer, engine: 'azure' }
  }

  if (!aiReady()) throw new Error('no AI is configured — set the Azure AI Foundry keys or the Cloudflare AI token')
  const prompt = `${TRENDS_PROMPT}\n\n${data}`
  const answer = await askText(prompt, { model: STRONG_WRITER_MODEL, maxTokens: MAX_ANSWER_TOKENS, temperature: 0.3 })
  if (!answer) throw new Error('the model answered with no text')
  return { answer, engine: 'workers' }
}
