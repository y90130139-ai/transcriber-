import { NextResponse, type NextRequest } from 'next/server'

/**
 * CORS for the app-facing API only (Geno, 2026-10-12).
 *
 * The native app has no origin and never needed this. The web build — and
 * every design preview run in a browser — does: without these headers the
 * browser preflights every authed fetch and blocks it. Only `/api/app/*` and
 * the photo redirect are opened; the console is untouched.
 *
 * Tokens still travel as explicit Authorization headers; no cookies are
 * allowed across origins, so reflecting the origin costs nothing.
 */
const cors = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
})

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin') ?? '*'

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors(origin) })
  }

  const response = NextResponse.next()
  for (const [key, value] of Object.entries(cors(origin))) response.headers.set(key, value)
  return response
}

export const config = {
  matcher: ['/api/app/:path*', '/api/photo/:path*'],
}
