'use client'

import { useState } from 'react'
import SweepTab from '@/components/roster/SweepTab'
import ModelSheet from '@/components/roster/ModelSheet'

export default function TodayPage() {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <SweepTab onOpenModel={setOpen} />
      {open && <ModelSheet modelId={open} onClose={() => setOpen(null)} />}
    </>
  )
}
