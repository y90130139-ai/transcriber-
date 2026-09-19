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
            <span className="card-handle">{displayName(item)}</span>
            {item.preview && <span className="card-line">{item.preview}</span>}
            <span className="card-meta">
              {item.upload_date && <span>{item.upload_date}</span>}
              {/* Views first where we have them: it is the number that says how
                  far a reel actually travelled. */}
              {item.sig_plays !== null && item.sig_plays !== undefined && (
                <span>{compact(Number(item.sig_plays))} views</span>
              )}
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
