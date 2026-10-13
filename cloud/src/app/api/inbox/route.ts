import { NextResponse } from 'next/server'
import { currentSession } from '@/lib/auth'
import { addThreadMembers, createThread, threadsForTeam, type ThreadMember } from '@/lib/inbox'
import { listTeamMembers } from '@/lib/team-auth'

/**
 * The console inbox (Geno, 2026-10-12): every thread, the people a new one
 * can be started with, and who "me" is (the signed-in member's own hides
 * and the rail's You marker read that — 2026-10-13).
 */
export async function GET() {
  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const [threads, team] = await Promise.all([threadsForTeam(session.id), listTeamMembers()])
  return NextResponse.json({
    threads,
    team,
    me: { id: session.id, name: session.name, email: session.email },
  })
}

export async function POST(request: Request) {
  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const asked = Array.isArray(body?.members) ? (body.members as Record<string, unknown>[]) : []
  const members: ThreadMember[] = asked
    .map((one) => ({
      type: one?.type === 'team' ? ('team' as const) : ('model' as const),
      id: String(one?.id ?? ''),
      name: typeof one?.name === 'string' ? one.name : null,
    }))
    .filter((one) => one.id.length > 0)

  if (members.length === 0) {
    return NextResponse.json({ error: 'Pick at least one person.' }, { status: 400 })
  }

  const id = await createThread({
    title: typeof body?.title === 'string' ? body.title : null,
    createdBy: session.id,
    members,
  })
  // The creator is in the room - the rail shows them from the first open.
  await addThreadMembers(id, [{ type: 'team', id: session.id, name: session.name ?? null }])
  return NextResponse.json({ ok: true, id })
}
