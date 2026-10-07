'use client'

import { useState } from 'react'
import { speaks, type LibraryItem } from '@/lib/format'
import { platformOfUrl } from '@/lib/socials'
import PlatformIcon, { hasPlatformIcon } from './roster/PlatformIcon'

const MARKS: Record<string, string> = { queued: '○', running: '●', failed: '×' }

const LABEL = { yes: 'Talking', no: 'No speech', unknown: 'Listening' }

function title(answer: boolean | null, human: boolean, running: boolean): string {
  if (answer === null) {
    return running
      ? 'The Mac is on it. The pass decides this, and it takes about a second.'
      : 'Nobody has listened to this one yet. Say it talks and it goes back in the queue.'
  }
  if (human) {
    return answer
      ? 'You said they talk in this.'
      : 'You said nothing here is worth keeping.'
  }
  return answer
    ? 'Whisper heard speech in this.'
    : 'Whisper listened and heard nobody — music or silence.'
}

export default function Queue({
  items,
  onOpen,
  onChanged,
}: {
  items: LibraryItem[]
  onOpen: (item: LibraryItem) => void
  onChanged: () => void
}) {
  // The row has to answer instantly. The list behind it is polled, so a flip
  // held here covers the gap until the next fetch agrees.
  const [flipped, setFlipped] = useState<Record<string, boolean>>({})

  async function toggle(item: LibraryItem) {
    // From "not listened to yet", the useful gesture is to say it does talk.
    const next = !(flipped[item.id] ?? speaks(item) ?? false)
    setFlipped((current) => ({ ...current, [item.id]: next }))
    const response = await fetch(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speech: next }),
    })
    if (!response.ok) {
      setFlipped((current) => {
        const { [item.id]: _dropped, ...rest } = current
        return rest
      })
      return
    }
    onChanged()
  }

  return (
    <section className="queue" aria-label="Work in progress">
      {items.map((item) => {
        const held = flipped[item.id]
        const answer = held ?? speaks(item)
        // A human's word, held or saved, is a decision; the pass's is a reading.
        const human = held !== undefined || item.speech_override !== null
        const running = item.status === 'running'
        // The row's own logo where the link is a known platform — Instagram,
        // TikTok — and the plain state mark where it is not.
        const platform = item.source ? platformOfUrl(item.source) : null
        return (
          <div className="queue-row" key={item.id} data-status={item.status}>
            <span className="queue-mark" aria-hidden>
              {platform && hasPlatformIcon(platform)
                ? <PlatformIcon platform={platform} size={14} />
                : MARKS[item.status] ?? '○'}
            </span>

            <button className="queue-label" onClick={() => onOpen(item)}>
              {item.label}
            </button>

            <button
              className="chip queue-speech"
              data-on={answer === true}
              data-origin={answer === null ? undefined : human ? 'human' : 'auto'}
              onClick={() => void toggle(item)}
              aria-pressed={answer === true}
              title={title(answer, human, running)}
            >
              {answer === null ? LABEL.unknown : answer ? LABEL.yes : LABEL.no}
            </button>

            <span className="queue-stage">
              {item.status === 'failed'
                ? (item.error?.split('\n')[0] ?? 'failed')
                : running
                  ? (item.stage ?? 'working')
                  : 'waiting'}
            </span>
          </div>
        )
      })}
    </section>
  )
}
