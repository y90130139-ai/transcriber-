import WatchlistPanel from '@/components/WatchlistPanel'
import { isSignedIn } from '@/lib/auth'
import { loadWatchlist, type WatchlistData } from '@/lib/watchlist'

/** The accounts the sweep reads beyond the roster — added by hand, or picked
 *  up from reels that collaborators were tagged in.
 *
 *  Server-rendered (2026-10-13): the list reads here and arrives with the
 *  first paint, so the page is instant instead of opening on placeholders
 *  and filling in after a fetch.
 *
 *  The read is session-gated here, not only in the layout: a server page's
 *  render still travels in the response payload behind the sign-in gate, so
 *  an unauthenticated request must never carry the rows (measured 2026-10-13
 *  — the handles showed up in a cookie-less fetch before this guard). */
const EMPTY: WatchlistData = { suggested: [], watching: [], counts: { watching: 0, suggested: 0, gated: 0 } }

export default async function WatchlistPage() {
  const initial = (await isSignedIn()) ? await loadWatchlist() : EMPTY
  return (
    <div className="dash">
      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title">Watchlist</h2>
          <p className="dash-sub">Accounts the sweep reads beyond the roster.</p>
        </div>
      </header>
      <WatchlistPanel initial={initial} />
    </div>
  )
}
