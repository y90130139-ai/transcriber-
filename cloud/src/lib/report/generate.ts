/**
 * Turn one model's evidence into her Creator Intelligence report and keep
 * it on her row (`models.about`).
 *
 * Engine order, same policy as the Trends box: Anthropic when the key is on
 * Vercel — this is the feature that most wants the strong model, a 24-section
 * strategy is judgment work — and gpt-oss-120b on Workers AI until then,
 * clearly labelled, because a first draft Geno can correct still beats
 * nothing. Corrections saved on the report ride into every regeneration as
 * part of the permanent correction layer the template demands.
 */
import Anthropic from '@anthropic-ai/sdk'
import { sql } from '../db'
import { aiReady, askText, STRONG_WRITER_MODEL } from '../ai'
import { gatherEvidence } from './evidence'
import { readReport, REPORT_PROMPT, type AboutDoc } from './spec'

const ANTHROPIC_MODEL = 'claude-opus-5-5'
const MAX_REPORT_TOKENS = 8_000

export async function loadAbout(modelId: string): Promise<AboutDoc | null> {
  const [row] = await sql.query(`select about from transcriber.models where id = $1`, [modelId])
  if (!row) throw new Error('no such model')
  const about = row.about as AboutDoc | null
  return about && typeof about === 'object' && about.report ? about : null
}

export async function generateReport(modelId: string, paste?: string): Promise<AboutDoc> {
  const [held, evidence] = await Promise.all([loadAbout(modelId), gatherEvidence(modelId, paste)])
  const corrections = held?.corrections ?? []

  const correctionBlock = corrections.length
    ? `\n\n### STANDING CORRECTIONS (from the team — these override anything the other evidence suggests)\n${corrections
        .map((c) => `- (${c.at.slice(0, 10)}) ${c.note}`)
        .join('\n')}`
    : ''

  const prompt = `${REPORT_PROMPT}\n\n=== EVIDENCE ===\n${evidence.text}${correctionBlock}`

  let answer: string | null = null
  let engine: AboutDoc['engine']
  if (process.env.ANTHROPIC_API_KEY) {
    engine = 'anthropic'
    const client = new Anthropic({ timeout: 240_000, maxRetries: 1 })
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_REPORT_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
    answer = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  } else {
    engine = 'workers'
    if (!aiReady()) throw new Error('no AI is configured — set ANTHROPIC_API_KEY or the Cloudflare AI token')
    answer = await askText(prompt, { model: STRONG_WRITER_MODEL, maxTokens: MAX_REPORT_TOKENS, temperature: 0.3 })
  }
  if (!answer) throw new Error('the model answered with no text')

  const match = /\{[\s\S]*\}/.exec(answer.replace(/```json|```/g, ''))
  const report = match ? readReport(safeParse(match[0])) : null
  if (!report) throw new Error('the model did not answer with a usable report — try again')

  const about: AboutDoc = {
    report,
    generated_at: new Date().toISOString(),
    engine,
    corrections,
    sources: evidence.sources,
  }
  await sql.query(`update transcriber.models set about = $2::jsonb, updated_at = now() where id = $1`, [
    modelId,
    JSON.stringify(about),
  ])
  return about
}

/** A correction is permanent: it survives every regeneration and is shown
 *  to the model as an override. The report text itself is not edited — the
 *  next generation folds the correction in. */
export async function addCorrection(modelId: string, note: string): Promise<AboutDoc> {
  const held = await loadAbout(modelId)
  if (!held) throw new Error('no report yet — generate one first')
  const about: AboutDoc = {
    ...held,
    corrections: [...held.corrections, { at: new Date().toISOString(), note: note.slice(0, 600) }],
  }
  await sql.query(`update transcriber.models set about = $2::jsonb, updated_at = now() where id = $1`, [
    modelId,
    JSON.stringify(about),
  ])
  return about
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
