'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import RosterTab from '@/components/roster/RosterTab'

function ModelsPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  return (
    <RosterTab
      openPlanFor={params.get('plan')}
      openCardFor={params.get('card')}
      openProfileFor={params.get('profile')}
      onOpened={() => router.replace('/models')}
    />
  )
}

export default function ModelsPage() {
  return (
    <Suspense>
      <ModelsPageInner />
    </Suspense>
  )
}
