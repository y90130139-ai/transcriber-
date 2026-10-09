'use client'

import { memo } from 'react'
import { getBatcherEngine, type Notice } from '@/lib/batcher/engine'
import { useBatcher } from '@/lib/batcher/use-batcher'
import { Icon } from '@/components/console/ConsoleIcons'

const ICON: Record<Notice['tone'], 'checkCircle' | 'alert' | 'clock'> = {
  success: 'checkCircle',
  warn: 'alert',
  error: 'alert',
  info: 'clock',
}

/** The batcher's own toasts — the console has no global toast surface, so
 *  these live inside the page and use the console's own tokens. */
export const Toasts = memo(function Toasts() {
  const notices = useBatcher((snapshot) => snapshot.notices)
  if (!notices.length) return null
  const engine = getBatcherEngine()

  return (
    <div className="vb-toasts" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div className="vb-toast" data-tone={notice.tone} key={notice.id}>
          <span className="vb-toast-icon">
            <Icon name={ICON[notice.tone]} size={15} />
          </span>
          <div className="vb-toast-copy">
            <b>{notice.title}</b>
            {notice.message && <span>{notice.message}</span>}
          </div>
          <button type="button" className="vb-toast-close" aria-label="Dismiss" onClick={() => engine.dismissNotice(notice.id)}>
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
})
