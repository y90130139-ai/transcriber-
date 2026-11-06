import { NextResponse, type NextRequest } from 'next/server'
import { canonicalFor } from './lib/retired-host'

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

/** The two API scopes the headers above are for, and only those. */
const CORS_SCOPES = ['/api/app', '/api/photo']
const wantsCors = (pathname: string) =>
  CORS_SCOPES.some((scope) => pathname === scope || pathname.startsWith(`${scope}/`))

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // The retired Vercel host hands every page over to plan.gosianmedia.com
  // (see lib/retired-host). `x-forwarded-host` is what the proxy in front of
  // the function saw; `host` is the fallback for a direct call. 308 rather
  // than 302 so the browser remembers it and keeps the method.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const canonical = canonicalFor(host, pathname, search)
  if (canonical) return NextResponse.redirect(canonical, 308)

  // A page on the live domain reaches here only because the matcher below has
  // to be wide enough to catch navigations. Nothing to add to it.
  if (!wantsCors(pathname)) return NextResponse.next()

  const origin = request.headers.get('origin') ?? '*'

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors(origin) })
  }

  const response = NextResponse.next()
  for (const [key, value] of Object.entries(cors(origin))) response.headers.set(key, value)
  return response
}

export const config = {
  matcher: [
    '/api/app/:path*',
    '/api/photo/:path*',
    // Every page navigation, so the retired host can hand it over. `api` is
    // excluded here as well as in `canonicalFor`, so the bot's endpoints do
    // not even enter this function. `_next` is left out because those are a
    // rendered page's own asset requests, and the page that asked for them is
    // already on the new domain.
    '/((?!api|_next/static|_next/image|_next/data).*)',
  ],
}
