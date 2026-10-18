import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { azureChatMessages, azureReady } from '@/lib/azure-ai'
import { SECTIONS, SETTINGS_LEAF } from '@/components/console/nav'

/** The rail search's AI half (Geno, 2026-10-13): "where do I find…" routed
 *  to one page of the console. GPT on Azure AI Foundry picks the page; when
 *  Foundry is not configured — or the call fails — a local scorer answers
 *  instead, so the row in the palette always lands somewhere sensible. The
 *  catalog is the rail itself (components/console/nav.ts), never a
 *  client-supplied list. */

/** The one deployment this feature is pinned to (Geno, 2026-10-13). */
const MODEL = 'gpt-5.2'

type Destination = { name: string; group: string; href: string }

const CATALOG: Destination[] = [
  ...SECTIONS.flatMap((section) =>
    section.items.map((item) => ({ name: item.label, group: section.label, href: item.href })),
  ),
  { name: SETTINGS_LEAF.label, group: 'Console', href: SETTINGS_LEAF.href },
]

/** Token overlap, name hits weighted — the same ladder the invoice app's
 *  fallback uses. Null when nothing scores at all. */
function pickLocally(query: string): Destination | null {
  const q = query.toLowerCase()
  const tokens = q.split(/\s+/).filter(Boolean)
  let best: Destination | null = null
  let bestScore = 0
  for (const dest of CATALOG) {
    const blob = `${dest.name} ${dest.group} ${dest.href}`.toLowerCase()
    const name = dest.name.toLowerCase()
    let score = 0
    for (const token of tokens) if (blob.includes(token)) score += 10
    if (name === q) score += 50
    else if (name.includes(q)) score += 25
    if (score > bestScore) {
      bestScore = score
      best = dest
    }
  }
  return bestScore >= 10 ? best : null
}

function settle(pick: Destination, source: 'ai' | 'fallback', label?: unknown, subtitle?: unknown) {
  const named = String(label ?? '').trim().slice(0, 40)
  const sub = String(subtitle ?? '').trim().slice(0, 60)
  return NextResponse.json({
    ok: true,
    href: pick.href,
    label: named || pick.name,
    subtitle: sub || pick.group,
    source,
  })
}

export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local'
  if (!rateLimit(`nav-assistant:${ip}`, 60)) {
    return NextResponse.json({ error: 'Too many asks — give it a minute.' }, { status: 429 })
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const query = String(body?.query ?? '').trim().slice(0, 200)
  if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 })

  const local = pickLocally(query)
  if (!azureReady()) return settle(local ?? CATALOG[0], 'fallback')

  const catalogLines = CATALOG.map((dest) => `- ${dest.name} → ${dest.href} (${dest.group})`).join('\n')
  try {
    const said = await azureChatMessages([
      {
        role: 'system',
        content: `You route a teammate to the single best page in a media-app console called Social Transcriber.
Reply ONLY with JSON: {"href":"/path","label":"Short label","subtitle":"Section name"}
Rules:
- href must be copied exactly from the catalog; never invent a path.
- Pick the most specific page for the request. Media tools live under Studio, research under Research; models and everything that touches them (invites, app accounts, inbox) live under Clients on the Client side tab.
- label is a 1-4 word name for where you are sending them; subtitle is the catalog's group.

Catalog:
${catalogLines}`,
      },
      { role: 'user', content: `Where should I go for: "${query}"` },
    ], MODEL)
    const json = /\{[\s\S]*\}/.exec(said.replace(/```json|```/g, ''))
    const parsed = json ? (JSON.parse(json[0]) as { href?: string; label?: string; subtitle?: string }) : {}
    const match = CATALOG.find((dest) => dest.href === String(parsed.href ?? ''))
    if (match) return settle(match, 'ai', parsed.label, parsed.subtitle)
    return settle(local ?? CATALOG[0], 'fallback')
  } catch {
    return settle(local ?? CATALOG[0], 'fallback')
  }
}
