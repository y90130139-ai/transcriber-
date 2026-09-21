import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { blueprintFor } from '@/lib/blueprint'

type Params = { params: Promise<{ id: string }> }

/** Her monthly Blueprint, assembled from what is already measured. */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const blueprint = await blueprintFor(id)
  if (!blueprint) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(blueprint)
}
