import { handleOAuthCallback } from '@/lib/reddit/oauthFlow'

/**
 * The OAuth consent callback at the path `REDDIT_REDIRECT_URI` names in
 * this deployment (`/api/auth/reddit/callback`). The flow itself lives in
 * `lib/reddit/oauthFlow`; this route exists so the redirect URI registered
 * on the Reddit app can stay where it has always been. The same handling is
 * also reachable at `/api/reddit/oauth?action=callback`.
 */
export async function GET(request: Request) {
  return handleOAuthCallback(request)
}
