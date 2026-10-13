'use client'

import LibraryCard from './LibraryCard'
import { useReveal } from '@/hooks/useReveal'
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
  // Cards arrive as a run rather than all at once (2026-10-13) — the same
  // reveal her plan's cards use, so the two grids read as one system. The
  // hook only writes state after confirming the browser can support it.
  const grid = useReveal<HTMLDivElement>([items.length])

  return (
    <div className="grid" ref={grid}>
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
