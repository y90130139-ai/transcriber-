'use client'

import { clock, compact, displayName, thumbUrl, type LibraryItem } from '@/lib/format'
import { explainOutperformance } from '@/lib/outperformance'

function Frame({ item }: { item: LibraryItem }) {
  if (item.has_thumb) {
    return (
      <img
        src={thumbUrl(item.id)}
        alt=""
        width={420}
        height={525}
        loading="lazy"
        decoding="async"
      />
    )
  }
  // No poster frame is not a reason to show an empty grey box.
  return <div className="card-frame-empty">{displayName(item)}</div>
}

export default function LibraryGrid({
  items,
  selected,
  onOpen,
  onToggle,
}: {
  items: LibraryItem[]
  selected: Set<string>
  onOpen: (item: LibraryItem) => void
  onToggle: (id: string) => void
}) {
  const selecting = selected.size > 0

  return (
    <div className="grid">
      {items.map((item, index) => (
        <article
          key={item.id}
          className={`card${index === 0 && items.length > 2 ? ' card-feature' : ''}`}
          data-picked={selected.has(item.id)}
        >
          <button
            type="button"
            className="card-open"
            onClick={() => (selecting ? onToggle(item.id) : onOpen(item))}
          >
            <span className="card-frame">
              <Frame item={item} />
              {item.is_hot && <span className="card-flame" aria-label="Outperforming">🔥</span>}
              {item.duration_sec !== null && (
                <span className="card-tag" data-corner="right">{clock(item.duration_sec)}</span>
              )}
              {/* Bottom-left, the way the Reels tab does it: the eye and the
                  number first, the verdict beside it. A row rather than two
                  absolutely-positioned tags, so they can never land on top of
                  each other however long the label runs. */}
              <span className="card-stats">
                <ExpiryTag item={item} />
                {item.sig_plays !== null && item.sig_plays !== undefined && (
                  <span className="card-tag" title={`${Number(item.sig_plays).toLocaleString()} views`}>
                    <svg className="card-eye" viewBox="0 0 24 16" aria-hidden="true">
                      <path d="M1 8s4-6 11-6 11 6 11 6-4 6-11 6S1 8 1 8Z" fill="none"
                            stroke="currentColor" strokeWidth="2" />
                      <circle cx="12" cy="8" r="3" fill="currentColor" />
                    </svg>
                    {compact(Number(item.sig_plays))}
                    <span className="sr-only"> views</span>
                  </span>
                )}
                {item.badges && item.badges.length > 0 ? (
                  <span className="card-tag" data-tone={item.badges[0].tone} title={item.badges[0].detail}>
                    {item.badges[0].label}
                  </span>
                ) : (
                  item.outperformance !== null &&
                  item.outperformance !== undefined && (
                    <span className="card-tag" title={explainOutperformance(item.outperformance)}>
                      {item.outperformance}×
                    </span>
                  )
                )}
              </span>
            </span>
            <span className="card-handle">{displayName(item)}</span>
            {item.preview && <span className="card-line">{item.preview}</span>}
            <span className="card-meta">
              {item.upload_date && <span>{item.upload_date}</span>}
              {/* Views moved onto the frame, where the eye is. Repeating them
                  here was the overlap that made the line hard to read. */}
              {item.like_count !== null && <span>{compact(item.like_count)} likes</span>}
              {item.comment_count !== null && <span>{compact(item.comment_count)} cm</span>}
            </span>
            {item.tags && item.tags.length > 0 && (
              <span className="card-tags">
                {item.tags.slice(0, 4).map((tag) => (
                  <span key={`${tag.axis}-${tag.tag}`} data-origin={tag.origin}>{tag.tag}</span>
                ))}
              </span>
            )}
          </button>
          <button
            type="button"
            className="card-pick"
            aria-label={selected.has(item.id) ? 'Deselect' : 'Select'}
            aria-pressed={selected.has(item.id)}
            onClick={() => onToggle(item.id)}
          >
            {selected.has(item.id) ? '✓' : '+'}
          </button>
        </article>
      ))}
    </div>
  )
}

/** The 90-day clock on a card (lib/expiry.ts): Expiring in its last five
 *  days, kept past it only while a plan card still uses it. */
function ExpiryTag({ item }: { item: LibraryItem }) {
  if (item.archived_at) return <span className="card-tag" data-tone="expired">Archived</span>
  const left = item.expires_in
  if (left === null || left === undefined || left > 5) return null
  if (left <= 0) {
    return item.on_open_card
      ? <span className="card-tag" data-tone="expired" title="Past 90 days — kept while it is on an open plan card">On a plan · past 90d</span>
      : <span className="card-tag" data-tone="expiring" title="Past 90 days — leaves the library at the next daily pass (10am ET)">Leaving today</span>
  }
  return (
    <span className="card-tag" data-tone="expiring" title={`Leaves the library in ${left} day${left === 1 ? '' : 's'} — put it on someone's week`}>
      ⏳ Expiring · {left}d
    </span>
  )
}
