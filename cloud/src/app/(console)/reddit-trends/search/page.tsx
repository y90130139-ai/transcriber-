'use client'

import { Suspense } from 'react'
import RedditSearch from '@/components/reddit/RedditSearch'

export default function RedditSearchPage() {
  return (
    <Suspense fallback={null}>
      <RedditSearch />
    </Suspense>
  )
}
