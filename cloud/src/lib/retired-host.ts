/**
 * The Vercel host is retired — the live app is plan.gosianmedia.com (2026-10-27).
 *
 * Every plan link the bot has ever sent, and every link a model has saved,
 * carries `transcriber-ten-zeta.vercel.app`. So the old host cannot simply stop
 * answering: it has to hand each visitor to the same path on the new domain.
 *
 * `/api/*` is deliberately exempt. The bot calls those endpoints on the Vercel
 * host with a bearer token, and a cross-host redirect is exactly where an
 * `Authorization` header goes missing — a redirect is a new request, and
 * whether a client re-sends credentials to a different origin is its choice,
 * not ours. The API keeps answering where it always has.
 */
export const LIVE_ORIGIN = 'https://plan.gosianmedia.com'

/**
 * True only for the retired deployment's own hostnames.
 *
 * Matched on the suffix with its dot, so `vercel.app.example.com` — a host
 * that merely contains the words — is not one of ours. The port is dropped
 * because a `Host` header may carry one and the name is what identifies the
 * deployment.
 */
export function isRetiredHost(host: string | null | undefined): boolean {
  if (!host) return false
  return host.trim().toLowerCase().split(':')[0].endsWith('.vercel.app')
}

/** The API answers on the retired host unchanged; everything else moves. */
const isApi = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/')

/**
 * Where this request belongs, or `null` to leave it exactly as it is.
 *
 * The fragment never appears here — browsers keep it across a redirect without
 * ever sending it — so a link into a plan's section survives on its own.
 */
export function canonicalFor(
  host: string | null | undefined,
  pathname: string,
  search: string,
): string | null {
  if (!isRetiredHost(host) || isApi(pathname)) return null

  const target = new URL(LIVE_ORIGIN)
  // Assigned, not joined. `new URL('//evil.com/x', LIVE_ORIGIN)` reads the
  // leading double slash as a host and resolves to evil.com — an open redirect
  // handed to anyone who can get a link clicked. The pathname setter cannot
  // change the host, whatever the path starts with.
  target.pathname = pathname
  target.search = search
  return target.toString()
}
