'use client'

import { useRouter } from 'next/navigation'
import DigestTab from '@/components/DigestTab'
import { EMPTY_FILTERS } from '@/components/FilterBar'
import { useConsole } from '@/components/console/ConsoleProvider'

export default function WeekPage() {
  const router = useRouter()
  const { applyFilters, applyQuery } = useConsole()
  return (
    <DigestTab
      onFilterTo={(handle) => {
        applyFilters({ ...EMPTY_FILTERS, creator: handle })
        applyQuery('')
        router.push(`/library?creator=${encodeURIComponent(handle)}`)
      }}
    />
  )
}
