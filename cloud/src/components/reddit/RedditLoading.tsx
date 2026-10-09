const PANELS = ['Trending Topics', 'Rising Topics', 'Top Posts by Velocity']

/** Shared first-load skeleton for route navigation and the overview fetch. */
export default function RedditLoading() {
  return (
    <div className="rt-loading">
      <p className="rt-loading-label" role="status">Loading Reddit trends…</p>

      <div className="rt-loading-layout" aria-hidden="true">
        <div className="rt-stats">
          {Array.from({ length: 8 }, (_, index) => (
            <div className="rt-stat" key={index}>
              <span className="rt-stat-label"><span className="rt-loading-block rt-loading-stat-label" /></span>
              <span className="rt-loading-block rt-loading-stat-value" />
            </div>
          ))}
        </div>

        <section className="rt-panel">
          <div className="rt-panel-head"><span className="rt-loading-block rt-loading-title" /></div>
          <div className="rt-loading-block rt-loading-plot" />
        </section>

        <div className="rt-columns">
          {PANELS.map((title) => (
            <section className="rt-panel" key={title}>
              <div className="rt-panel-head"><h2>{title}</h2></div>
              <div>
                {Array.from({ length: 3 }, (_, index) => (
                  <div className="rt-loading-row" key={index}>
                    <span className="rt-loading-row-main">
                      <span className="rt-loading-block" />
                      <span className="rt-loading-block rt-loading-row-meta" />
                    </span>
                    <span className="rt-loading-block rt-loading-row-value" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
