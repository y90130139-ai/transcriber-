import { NextResponse } from 'next/server'
import { modelSessionFrom } from '@/lib/model-auth'
import { loadPlanForModel, modelById } from '@/lib/plans'

/**
 * Her week, for the app — the same load the portal's `/p/[token]` renders.
 *
 * The session carries the model id; nothing in the request can widen it. An
 * account whose model has no sent plan yet gets `plan: null` and an empty
 * list, which the app shows as "your week is being built", not an error.
 */
export async function GET(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const model = await modelById(session.modelId)
  if (!model) return NextResponse.json({ error: 'no_model' }, { status: 404 })

  const loaded = await loadPlanForModel(model)
  return NextResponse.json({
    ok: true,
    model: {
      id: model.id,
      name: model.name,
      photo_url: model.photo_url,
      filming_days: model.filming_days,
      weekly_target: model.weekly_target,
      drive_url: model.drive_url,
      delivery_note: model.delivery_note,
      // Her saved look — the same value the web portal themes itself with.
      portal_style: model.portal_style ?? null,
    },
    plan: loaded?.plan ?? null,
    items: loaded?.items ?? [],
  })
}
