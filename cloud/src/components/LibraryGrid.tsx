'use client'

import LibraryCard from './LibraryCard'
import type { LibraryItem } from '@/lib/format'

/** The grid is just the layout now; everything a card can do lives in
 *  LibraryCard (previews, save, the caption fold — 2026-10-06). */
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
      {items.map((item) => (
        <LibraryCard
          key={item.id}
          item={item}
          picked={selected.has(item.id)}
          selecting={selecting}
          onOpen={() => onOpen(item)}
          onToggle={() => onToggle(item.id)}
        />
      ))}
    </div>
  )
}
