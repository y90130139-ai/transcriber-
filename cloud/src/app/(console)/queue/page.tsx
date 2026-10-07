'use client'

import QueueTab from '@/components/QueueTab'
import { useConsole } from '@/components/console/ConsoleProvider'

export default function QueuePage() {
  const { pending, worker, reload, setOpenItem } = useConsole()
  return (
    <QueueTab
      pending={pending}
      workerOnline={worker.online}
      onChanged={reload}
      onOpen={setOpenItem}
    />
  )
}
