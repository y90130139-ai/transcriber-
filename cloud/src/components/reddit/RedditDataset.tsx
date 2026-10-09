'use client'

import type { DatasetStats } from '@/lib/reddit/queries'
import { compact, timeAgo } from './bits'
import { useJson } from './useReddit'

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(2)} GB`
}

/** The dataset record: what is stored, how fresh, what it cost, and the
 *  export controls. */
export default function RedditDataset() {
  const { data, error, loading } = useJson<DatasetStats>('/api/reddit/dataset')

  return (
    <div className="rt-page">
      {error && <div className="rt-error"><b>Could not load dataset stats</b><p>{error}</p></div>}
      {loading && !data && <div className="rt-skel"><i /><i /><i /><i /></div>}

      {data && (
        <>
          <section className="rt-cards">
            <article className="rt-card" title={`${data.eligible} eligible · ${data.active} validated · ${data.adult} adult`}>
              <span className="rt-card-label">Tracked</span><b className="rt-card-value">{data.tracked}</b>
            </article>
            <article className="rt-card" title={`${data.registry.candidates} requested candidates`}>
              <span className="rt-card-label">Registry</span><b className="rt-card-value">{data.registry.unique}</b>
            </article>
            <article className="rt-card" title={`${data.post_snapshots.toLocaleString('en-US')} metric snapshots`}>
              <span className="rt-card-label">Posts</span><b className="rt-card-value">{compact(data.posts)}</b>
            </article>
            <article className="rt-card" title={`${data.subreddit_snapshots.toLocaleString('en-US')} community snapshots · ${data.mentions.toLocaleString('en-US')} mentions`}>
              <span className="rt-card-label">Topic readings</span><b className="rt-card-value">{compact(data.topic_snapshots)}</b>
            </article>
            <article className="rt-card" title="reddit schema, tables and indexes">
              <span className="rt-card-label">Storage</span><b className="rt-card-value">{bytes(data.storage_bytes)}</b>
            </article>
            <article className="rt-card" title="Last successful community sync">
              <span className="rt-card-label">Freshness</span><b className="rt-card-value">{timeAgo(data.freshness)}</b>
            </article>
            <article className="rt-card" title={`${data.api_7d.requests.toLocaleString('en-US')} calls in 7 days`}>
              <span className="rt-card-label">API · 24h</span><b className="rt-card-value">{data.api_24h.requests}</b>
            </article>
            <article className="rt-card" title="Deduplicated, one per event">
              <span className="rt-card-label">Alerts</span><b className="rt-card-value">{data.alerts}</b>
            </article>
          </section>

          <div className="rt-columns">
            <section className="rt-panel">
              <div className="rt-panel-head"><h2>Retention</h2></div>
              <div className="rt-metrics">
                <div className="rt-metric" title="Snapshots, runs, alerts, API usage">
                  <span className="rt-metric-label">Aggregates</span><b className="rt-metric-value">{data.retention.days}d</b>
                </div>
                <div className="rt-metric" title={`Oldest post: ${timeAgo(data.oldest_post)}`}>
                  <span className="rt-metric-label">Posts</span><b className="rt-metric-value">{data.retention.post_days}d</b>
                </div>
                <div className="rt-metric" title="Removed posts stop being served; content and author identifiers are cleared">
                  <span className="rt-metric-label">Deletion sync</span><b className="rt-metric-value">on</b>
                </div>
                <div className="rt-metric" title="Controlled from Settings">
                  <span className="rt-metric-label">Raw export</span>
                  <b className="rt-metric-value" data-tone={data.retention.export_raw_enabled ? 'bad' : undefined}>
                    {data.retention.export_raw_enabled ? 'on' : 'off'}
                  </b>
                </div>
              </div>
              <p className="rt-licence">
                Aggregate exports only — raw post metadata needs the export switch enabled in Settings.
              </p>
            </section>

            <section className="rt-panel">
              <div className="rt-panel-head"><h2>Export</h2></div>
              <div className="rt-http-links">
                <a className="rt-btn" href="/api/reddit/dataset?export=topics" download>Topics · CSV</a>
                <a className="rt-btn" href="/api/reddit/dataset?export=subreddits" download>Communities · CSV</a>
                <a className="rt-btn rt-btn-quiet" href="/api/reddit/dataset?export=posts" download
                  aria-disabled={!data.retention.export_raw_enabled}
                  title={data.retention.export_raw_enabled ? 'Enabled' : 'Locked'}>
                  Posts · CSV {data.retention.export_raw_enabled ? '' : '· locked'}
                </a>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
