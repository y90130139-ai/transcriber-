import { sql } from './db'

/**
 * Push, through Expo's push service (Geno, 2026-10-12).
 *
 * Every device she signed in on carries an Expo push token (registered by
 * `/api/app/device` and kept in `transcriber.model_devices`). This sends one
 * message to all of them in a single request and prunes the tokens Expo tells
 * us are dead — a phone she wiped stops being phoned.
 *
 * Failure is silent by design: a push that does not go out must never fail
 * the reply or the send that triggered it.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

type Ticket = { status?: string; details?: { error?: string } }

export async function pushToModel(
  modelId: string,
  message: { title: string; body: string; data?: Record<string, unknown> },
): Promise<{ sent: number; pruned: number }> {
  const rows = await sql.query(
    `select token from transcriber.model_devices where model_id = $1`,
    [modelId],
  )
  const tokens = rows.map((row) => String(row.token)).filter((token) => token.length > 0)
  if (tokens.length === 0) return { sent: 0, pruned: 0 }

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(
      tokens.map((token) => ({
        to: token,
        title: message.title,
        body: message.body,
        sound: 'default',
        data: message.data ?? {},
      })),
    ),
  }).catch(() => null)
  if (!response?.ok) return { sent: 0, pruned: 0 }

  const body = (await response.json().catch(() => null)) as { data?: Ticket[] } | null
  const tickets = Array.isArray(body?.data) ? body.data : []

  let sent = 0
  const dead: string[] = []
  tickets.forEach((ticket, index) => {
    if (ticket?.status === 'ok') {
      sent += 1
      return
    }
    if (ticket?.details?.error === 'DeviceNotRegistered') dead.push(tokens[index])
  })
  if (dead.length > 0) {
    await sql.query(`delete from transcriber.model_devices where token = any($1::text[])`, [dead])
  }
  return { sent, pruned: dead.length }
}
