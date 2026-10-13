import { NextResponse } from 'next/server'

/**
 * Sign-out. There is no server-side session to kill — her phone holds the
 * bearer token and discards it — so this exists so the app has one honest
 * endpoint to call and the console has one place to hang a "revoked" note if
 * that day comes.
 */
export async function POST() {
  return NextResponse.json({ ok: true })
}
