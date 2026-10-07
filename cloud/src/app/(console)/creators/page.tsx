'use client'

import { useRouter } from 'next/navigation'
import CreatorsTab from '@/components/CreatorsTab'
import { EMPTY_FILTERS } from '@/components/FilterBar'
import { useConsole } from '@/components/console/ConsoleProvider'

export default function CreatorsPage() {
  const router = useRouter()
  const { applyFilters, applyQuery } = useConsole()
  return (
    <CreatorsTab
      onFilterTo={(handle) => {
        applyFilters({ ...EMPTY_FILTERS, creator: handle })
        applyQuery('')
        router.push(`/library?creator=${encodeURIComponent(handle)}`)
      }}
    />
  )
}
