'use client'

import { useState } from 'react'
import DashboardHome from '@/components/dashboard/DashboardHome'
import ModelSheet from '@/components/roster/ModelSheet'

export default function DashboardPage() {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <DashboardHome onOpenModel={setOpen} />
      {open && <ModelSheet modelId={open} initialTab="analytics" onClose={() => setOpen(null)} />}
    </>
  )
}
