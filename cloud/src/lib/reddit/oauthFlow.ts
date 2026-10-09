import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'
import {
  exchangeOAuthCode,
  oauthAuthorizeUrl,
  redditRedirectUri,
  redditUserOAuthConfigured,
} from './client'
import { oauthStatus, saveOAuthAccount, touchOAuthAccount } from './requirementStore'

/**
 * The optional Reddit account flow, shared by both callback paths: the one
 * under `/api/reddit/oauth` and the alias at whatever `REDDIT_REDIRECT_URI`
 * names (this deployment registers `/api/auth/reddit/callback` on the
 * Reddit app). Authorization code grant, `read` scope, `permanent` duration
 * so a refresh token comes back; the token is stored server-side and used
 * for exactly one endpoint — the moderator list that reveals an installed
 * Bot Bouncer.
 */

const STATE_COOKIE = 'reddit_oauth_state'
export const OAUTH_RETURN_PATH = '/reddit-trends/requirements'

export async function oauthStatusPayload() {
  return { oauth: await oauthStatus(redditUserOAuthConfigured(), redditRedirectUri()) }
}

/** Send the operator to Reddit's consent page, with a CSRF state cookie. */
export async function startOAuth(): Promise<Response> {
  if (!redditUserOAuthConfigured()) {
    return NextResponse.json({
      error: 'Set REDDIT_REDIRECT_URI on the server — it must exactly match the redirect URI registered on the Reddit app',
    }, { status: 400 })
  }
  const state = randomBytes(16).toString('hex')
  const store = await cookies()
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return NextResponse.redirect(oauthAuthorizeUrl(state))
}

/** Exchange the consent code for tokens and store them. Always redirects
 *  back to the board with a query flag, never an error page — the page
 *  renders the outcome. */
export async function handleOAuthCallback(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const back = new URL(OAUTH_RETURN_PATH, url.origin)
  const error = url.searchParams.get('error')
  if (error) {
    back.searchParams.set('connect_error', error)
    return NextResponse.redirect(back)
  }
  const state = url.searchParams.get('state') ?? ''
  const code = url.searchParams.get('code') ?? ''
  const store = await cookies()
  const expected = store.get(STATE_COOKIE)?.value
  store.delete(STATE_COOKIE)
  if (!code || !state || state !== expected) {
    back.searchParams.set('connect_error', 'state-mismatch')
    return NextResponse.redirect(back)
  }
  try {
    const account = await exchangeOAuthCode(code)
    await saveOAuthAccount({ username: account.username, refresh_token: account.refreshToken, scope: account.scope })
    back.searchParams.set('connected', '1')
  } catch (reason) {
    await touchOAuthAccount(false, reason instanceof Error ? reason.message : String(reason)).catch(() => null)
    back.searchParams.set('connect_error', 'exchange-failed')
  }
  return NextResponse.redirect(back)
}
