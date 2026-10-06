import { ImageResponse } from 'next/og'

type Params = { params: Promise<{ size: string }> }

/** The home-screen icon: the ember mark on ink, drawn on demand so no
 *  binary lives in the repo. Two sizes only. */
export async function GET(_request: Request, { params }: Params) {
  const { size } = await params
  const px = size === '512' ? 512 : size === '192' ? 192 : null
  if (!px) return new Response('not found', { status: 404 })
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#060605',
          color: '#E8663A',
          fontSize: px * 0.52,
          fontWeight: 700,
          fontFamily: 'Helvetica, Arial, sans-serif',
        }}
      >
        S.
      </div>
    ),
    { width: px, height: px, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
  )
}
