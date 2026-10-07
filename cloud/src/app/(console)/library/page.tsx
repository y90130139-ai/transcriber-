'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import LibraryTab from '@/components/LibraryTab'
import { EMPTY_FILTERS } from '@/components/FilterBar'
import { useConsole } from '@/components/console/ConsoleProvider'

function LibraryPageInner() {
  const params = useSearchParams()
  const {
    items, creators, filters, query, loading, total, atCap,
    applyFilters, applyQuery, onMore, setOpenItem,
  } = useConsole()

  // Arriving from Creators or Week with ?creator= narrows the grid to her.
  const creator = params.get('creator')
  useEffect(() => {
    if (creator) {
      applyFilters({ ...EMPTY_FILTERS, creator })
      applyQuery('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creator])

  return (
    <LibraryTab
      items={items}
      creators={creators}
      filters={filters}
      query={query}
      loading={loading}
      total={total}
      atCap={atCap}
      onMore={onMore}
      onFilters={applyFilters}
      onQuery={applyQuery}
      onOpen={setOpenItem}
    />
  )
}

export default function LibraryPage() {
  return (
    <Suspense>
      <LibraryPageInner />
    </Suspense>
  )
}
