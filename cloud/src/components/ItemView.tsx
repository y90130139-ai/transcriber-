'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TagPicker from './TagPicker'
import AssignBar from './roster/AssignBar'
import { OpenGlyph } from './platform/glyphs'
import {
  blocksToText, clock, compact, displayName, toMarkdown,
  type Block, type LibraryItem, type TagRow,
} from '@/lib/format'
import { AXES } from '@/lib/taxonomy'
import { firstLineOf } from '@/lib/autotag'
import { buildScaffold } from '@/lib/script'
import { BADGE_LEGEND } from '@/lib/appeal'

type FullItem = LibraryItem & {
  caption: string | null
  plain: string | null
  markdown: string | null
  blocks: Block[] | null
}
type Media = { video: string; poster: string; captions: string; download: string }

const COPY_RESET_MS = 1600

export default function ItemView({
  item,
  onClose,
  onChanged,
}: {
  item: LibraryItem
  onClose: () => void
  onChanged: () => void
}) {
  const [full, setFull] = useState<FullItem | null>(null)
  const [tags, setTags] = useState<TagRow[]>(item.tags ?? [])
  const [media, setMedia] = useState<Media | null>(null)
  const [copied, setCopied] = useState('')
  const [asking, setAsking] = useState(false)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const player = useRef<HTMLVideoElement>(null)
  const sheet = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/items/${item.id}`)
    if (!response.ok) return
    const body = await response.json()
    setFull(body.item ?? null)
    setTags(body.tags ?? [])
    setMedia(body.media ?? null)
  }, [item.id])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The page behind is locked while the record is up, the record itself takes
  // focus so Escape and tabbing work before anything is clicked, and closing
  // hands focus back to wherever it came from.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sheet.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  function trapTab(event: React.KeyboardEvent) {
    if (event.key !== 'Tab' || !sheet.current) return
    const stops = sheet.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (stops.length === 0) return
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  /** A time in the record is a place in the clip. */
  function seek(second: number | null) {
    const el = player.current
    if (second === null || !el) return
    el.currentTime = second
    void el.play().catch(() => {})
  }

  async function copy(kind: string, value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(kind)
    setTimeout(() => setCopied(''), COPY_RESET_MS)
  }

  /** Say she talks after all. On a row that has never been listened to — one
   *  added before the pass became unconditional — that sends it back to the
   *  Mac; otherwise it just records that the pass got this one wrong. */
  async function askForSpeech() {
    setAsking(true)
    const response = await fetch(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speech: true }),
    })
    setAsking(false)
    if (!response.ok) return
    onChanged()
    onClose()
  }

  async function saveAxis(axis: (typeof AXES)[number], chosen: string[]) {
    const response = await fetch(`/api/items/${item.id}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axis, tags: chosen }),
    })
    if (response.ok) {
      const body = await response.json()
      setTags(body.tags ?? [])
      onChanged()
    }
  }

  const blocks = full?.blocks ?? []
  // A video added without a speech pass still has a transcript row; its
  // text is a lone newline, so trim before calling it a transcript.
  const plain = (full?.plain ?? '').trim()
  const hasWords = blocks.length > 0 || plain.length > 0
  const link = full?.webpage_url ?? (item.kind === 'link' ? item.source : null)
  const shown = full ?? item

  // The shot scaffold. Structure only — what the reference did and where,
  // never words for her to say. Renders nothing when the reel has no beats
  // to read, which is the honest answer for a single long take.
  const scaffold = buildScaffold({
    hooks: tags.filter((t) => t.axis === 'hook').map((t) => t.tag),
    formats: tags.filter((t) => t.axis === 'format').map((t) => t.tag),
    firstLine: firstLineOf(blocks, plain),
    onScreenCaptions: (shown as { on_screen_captions?: unknown }).on_screen_captions as
      | { t?: number | null; text?: string | null }[]
      | null
      | undefined,
    durationSec: shown.duration_sec,
    outperformance: shown.outperformance,
  })

  // Which beat and which line the playhead is inside. The rail and the
  // transcript light up together as the clip runs, and a click on either
  // sends the clip to that second — one record, one clock.
  const beatIndex = useMemo(() => {
    if (playhead === null || !scaffold) return -1
    let found = -1
    scaffold.beats.forEach((beat, index) => {
      if (beat.at !== null && beat.at <= playhead) found = index
    })
    return found
  }, [playhead, scaffold])

  const lineIndex = useMemo(() => {
    if (playhead === null) return -1
    let found = -1
    blocks.forEach((block, index) => {
      if (block.start <= playhead) found = index
    })
    return found
  }, [playhead, blocks])

  const facts: { key: string; label: string; value: string; title?: string }[] = []
  if (shown.like_count !== null) facts.push({ key: 'likes', label: 'Likes', value: compact(shown.like_count) })
  if (shown.comment_count !== null) facts.push({ key: 'comments', label: 'Comments', value: compact(shown.comment_count) })
  if (shown.outperformance) {
    facts.push({ key: 'median', label: 'Vs own median', value: `${shown.outperformance}×`, title: BADGE_LEGEND })
  }
  if (shown.is_hot) facts.push({ key: 'signal', label: 'Signal', value: '🔥 Hot', title: BADGE_LEGEND })

  const kicker = [
    shown.platform ?? (item.kind === 'file' ? 'Upload' : 'Link'),
    shown.upload_date,
    clock(shown.duration_sec),
  ].filter(Boolean).join(' · ')

  return (
    <>
      <button className="sheet-scrim" onClick={onClose} aria-label="Close" />
      <div
        className="reader record"
        role="dialog"
        aria-modal="true"
        aria-label={displayName(item)}
        ref={sheet}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="record-topbar">
          <span className="record-kicker">{kicker}</span>
          <span className="record-mast-actions">
            {item.archived_at && <span className="record-flag">Archived</span>}
            {link && (
              <a className="reader-source" href={link} target="_blank" rel="noreferrer">
                <OpenGlyph />
                Open the post
              </a>
            )}
            <button className="sheet-close" onClick={onClose} aria-label="Close">Close</button>
          </span>
        </div>

        <header className="record-mast">
          <h3 className="record-name">{displayName(item)}</h3>

          {facts.length > 0 && (
            <dl className="record-facts">
              {facts.map((fact) => (
                <div key={fact.key} data-tone={fact.key === 'likes' || fact.key === 'comments' ? undefined : 'ember'}>
                  <dt>{fact.label}</dt>
                  <dd title={fact.title}>{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </header>

        <div className="record-body">
          <section className="record-play" aria-label="The clip">
            {item.status === 'failed' && <pre className="failbox">{item.error}</pre>}

            <div className="record-media">
              {media ? (
                <figure className="record-stage">
                  <video
                    ref={player}
                    className="player"
                    poster={item.has_thumb ? `/api/thumb/${item.id}` : undefined}
                    controls
                    playsInline
                    preload="metadata"
                    crossOrigin="anonymous"
                    onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
                    onSeeked={(event) => setPlayhead(event.currentTarget.currentTime)}
                  >
                    <source src={media.video} type="video/mp4" />
                    {/* The pipeline already wrote WebVTT, so the clip is watchable muted. */}
                    <track kind="captions" srcLang="en" label="Transcript" src={media.captions} default />
                  </video>
                </figure>
              ) : item.folder ? (
                <p className="hint">
                  The Mac is asleep, so the video is not reachable. The words are all here.
                </p>
              ) : (
                // Nineteen items from before the media was kept have a transcript
                // and no file behind it. Rendering nothing here read as a player
                // that would not start; say which it is.
                <p className="hint">
                  No video was kept for this one — only the words. Open it on Instagram to watch it.
                </p>
              )}

              {full?.caption && <p className="caption record-note">{full.caption}</p>}
            </div>
          </section>

          <aside className="record-side" aria-label="How to rebuild this, its tags, and the words">
            {scaffold && (
              <section className="record-block">
                <h4 className="record-label">How to rebuild this</h4>
                <p className="record-why">{scaffold.mechanism}</p>
                {scaffold.evidence && <p className="record-why">{scaffold.evidence}</p>}
                <ol className="record-beats">
                  {scaffold.beats.map((beat, index) => {
                    const inside = (
                      <>
                        <span className="record-beat-at">{beat.at !== null ? clock(beat.at) : '—'}</span>
                        <span className="record-beat-body">
                          <span className="record-beat-role">{beat.role}</span>
                          <span className="record-beat-ref">&ldquo;{beat.reference}&rdquo;</span>
                          <span className="record-beat-do">{beat.instruction}</span>
                        </span>
                      </>
                    )
                    return (
                      <li key={index} data-on={index === beatIndex || undefined}>
                        {media && beat.at !== null ? (
                          <button
                            type="button"
                            className="record-beat"
                            onClick={() => seek(beat.at)}
                            title={`Play from ${clock(beat.at)}`}
                          >
                            {inside}
                          </button>
                        ) : (
                          <span className="record-beat">{inside}</span>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </section>
            )}

            <section className="record-block">
              <div className="axes">
                {AXES.map((axis) => (
                  <TagPicker key={axis} axis={axis} tags={tags} onSave={(chosen) => saveAxis(axis, chosen)} />
                ))}
              </div>
            </section>

            <section className="record-block">
              <AssignBar jobId={item.id} />
            </section>

            <section className="record-block" aria-label="Transcript">
              {hasWords && <h4 className="reader-section">Transcript</h4>}

              {blocks.map((block, index) => (
                <div className="block record-line" data-on={index === lineIndex || undefined} key={index}>
                  {media ? (
                    <button
                      type="button"
                      className="record-time"
                      onClick={() => seek(block.start)}
                      title={`Play from ${clock(block.start)}`}
                    >
                      {clock(block.start)}
                    </button>
                  ) : (
                    <p className="block-time">{clock(block.start)}</p>
                  )}
                  <div className="block-body">
                    {block.speaker && <p className="block-speaker">{block.speaker}</p>}
                    <p className="block-text">{block.text}</p>
                  </div>
                </div>
              ))}

              {blocks.length === 0 && plain && (
                <div className="block">
                  <p className="block-time">—</p>
                  <div className="block-body"><p className="block-text">{plain}</p></div>
                </div>
              )}

              {full && !hasWords && shown.status === 'done' && (
                <div className="nospeech">
                  <p>
                    {shown.has_speech === null
                      ? 'Added before every video was listened to. The video, the figures and the tags are all here; the audio was never read.'
                      : 'Nothing was said in this one — the audio was read and came back empty.'}
                  </p>
                  {shown.has_speech === null && (
                    <button className="btn btn-quiet" onClick={askForSpeech} disabled={asking}>
                      {asking ? 'Queueing' : 'They talk — transcribe it'}
                    </button>
                  )}
                </div>
              )}

              {!full && <p className="hint">Loading…</p>}
            </section>
          </aside>
        </div>

        <footer className="record-foot">
          <button
            className="btn"
            onClick={() => copy('md', toMarkdown(shown, blocks, plain, tags))}
            disabled={!plain}
          >
            {copied === 'md' ? 'Copied' : 'Copy as markdown'}
          </button>
          <button
            className="btn btn-quiet"
            onClick={() => copy('text', blocks.length ? blocksToText(blocks) : plain)}
            disabled={!plain}
          >
            {copied === 'text' ? 'Copied' : 'Words only'}
          </button>
          {media && (
            <a className="btn btn-quiet" href={media.download}>Download video</a>
          )}
          {item.status === 'failed' && (
            <button
              className="btn btn-quiet"
              onClick={async () => {
                await fetch(`/api/items/${item.id}`, { method: 'POST' })
                onChanged()
                onClose()
              }}
            >
              Retry
            </button>
          )}
          {item.archived_at && (
            <button
              className="btn btn-quiet"
              title="Back into the library. Past 90 days, it leaves again at the next daily pass unless it goes on someone's week."
              onClick={async () => {
                await fetch(`/api/items/${item.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ archived: false }),
                })
                onChanged()
                onClose()
              }}
            >
              Restore
            </button>
          )}
          <button
            className="btn btn-quiet"
            data-end
            onClick={async () => {
              await fetch(`/api/items/${item.id}`, { method: 'DELETE' })
              onChanged()
              onClose()
            }}
          >
            Remove
          </button>
        </footer>
      </div>
    </>
  )
}
