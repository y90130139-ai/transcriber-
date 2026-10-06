import { modelForToken } from '@/lib/plans'

type Params = { params: Promise<{ token: string }> }

/**
 * Her plan as a home-screen app (Geno, 2026-10-06: "add it to the home
 * screen... always there for them to open"). The manifest is per token so
 * the icon opens HER plan, and there is deliberately NO service worker —
 * every open fetches fresh, which is exactly the staleness worry this
 * design answers.
 */
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params
  const model = await modelForToken(token)
  if (!model) return new Response('not found', { status: 404 })
  return Response.json(
    {
      name: 'Your content plan',
      short_name: 'Your plan',
      start_url: `/p/${token}`,
      scope: `/p/${token}`,
      display: 'standalone',
      background_color: '#060605',
      theme_color: '#060605',
      icons: [
        { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'private, no-store' } },
  )
}
