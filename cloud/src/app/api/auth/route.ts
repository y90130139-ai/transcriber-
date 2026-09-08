import { NextResponse } from 'next/server'
import { checkPassword, endSession, startSession } from '@/lib/auth'

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({ password: '' }))
  if (typeof password !== 'string' || !checkPassword(password)) {
    return NextResponse.json({ error: 'Wrong password.' }, { status: 401 })
  }
  await startSession()
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  await endSession()
  return NextResponse.json({ ok: true })
}
