import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { blueprintFor } from '@/lib/blueprint'

type Params = { params: Promise<{ id: string }> }

/** Her monthly Blueprint, assembled from what is already measured. */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const blueprint = await blueprintFor(id)
  if (!blueprint) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(blueprint)
}
