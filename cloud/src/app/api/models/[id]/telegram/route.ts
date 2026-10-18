import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { autoSurveyOnLink } from '@/lib/survey/store'

type Params = { params: Promise<{ id: string }> }

/**
 * Link a model to one of the bot's Telegram groups — `{ chat_id }`, or
 * `{ chat_id: null }` to unlink. Only a group the bot has shared can be
 * linked, so a typo can never point her week at someone else's chat.
 */
export async function PUT(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const chatId = typeof body.chat_id === 'string' && body.chat_id ? body.chat_id : null

  if (chatId) {
    const [group] = await sql.query(`select 1 from transcriber.telegram_groups where chat_id = $1`, [chatId])
    if (!group) return NextResponse.json({ error: 'That group is not on the bot.' }, { status: 404 })
  }
  const [model] = await sql.query(
    `update transcriber.models set telegram_chat_id = $2, updated_at = now()
      where id = $1 returning telegram_chat_id`,
    [id, chatId],
  )
  if (!model) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // First link of a new model: her questionnaire goes out with it (lib/survey).
  // A failure here must not undo the link, which already saved.
  let questionnaire = false
  if (chatId) {
    try {
      questionnaire = (await autoSurveyOnLink(id)).queued
    } catch (error) {
      console.error('auto questionnaire on link failed', error)
    }
  }
  return NextResponse.json({ telegram_chat_id: model.telegram_chat_id, questionnaire_queued: questionnaire })
}
