'use client'

import WatchlistPanel from '@/components/WatchlistPanel'

/** The accounts the sweep reads beyond the roster — added by hand, or picked
 *  up from reels that collaborators were tagged in. */
export default function WatchlistPage() {
  return (
    <div className="dash">
      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title">Watchlist</h2>
          <p className="dash-sub">Accounts the sweep reads beyond the roster.</p>
        </div>
      </header>
      <WatchlistPanel bare />
    </div>
  )
}
