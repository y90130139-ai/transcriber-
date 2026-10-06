import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { trendsBoard } from '@/lib/trends'
import { answerTrends, MAX_QUESTION_CHARS } from '@/lib/trends-ask'
import { cleanRange } from '@/lib/trends-feed'

/** One question against the board — the same window the tab is showing, and
 *  `web: true` to let it search past the board (Anthropic key only; the
 *  Workers fallback answers board-only and says so). Console-only; the model
 *  error comes back as itself, never swallowed into a generic 500. */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) return NextResponse.json({ error: 'ask something' }, { status: 400 })
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: `keep it under ${MAX_QUESTION_CHARS} characters` }, { status: 400 })
  }

  try {
    const board = await trendsBoard(cleanRange(body?.days))
    const answered = await answerTrends(question, board, { web: body?.web === true })
    return NextResponse.json(answered)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }
}
