'use client'

import { useCallback, useEffect, useState } from 'react'
import TagPicker from './TagPicker'
import AssignBar from './roster/AssignBar'
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

  return (
    <>
      <button className="reader-scrim" onClick={onClose} aria-label="Close" />
      <aside className="reader" aria-label={`${displayName(item)}`}>
        <header className="reader-head">
          <button className="reader-close" onClick={onClose} aria-label="Close">Close</button>
          <h3>{displayName(item)}</h3>
          {link && <a className="source" href={link} target="_blank" rel="noreferrer">{link}</a>}
          <p className="facts" title={BADGE_LEGEND}>
            {[
              shown.upload_date,
              clock(shown.duration_sec),
              shown.like_count !== null ? `${compact(shown.like_count)} likes` : null,
              shown.comment_count !== null ? `${compact(shown.comment_count)} comments` : null,
              shown.outperformance ? `${shown.outperformance}× own median` : null,
            ].filter(Boolean).join(' · ')}
            {shown.is_hot && <span className="flame" aria-label="Outperforming"> 🔥</span>}
          </p>
        </header>

        <div className="reader-body">
          {/* The shot scaffold. Structure only — what the reference did and where,
              never words for her to say. Renders nothing when the reel has no
              beats to read, which is the honest answer for a single long take.

              It used to sit between the head and the body rather than inside
              it, which made it the one thing in the panel that could not be
              scrolled past: a fixed slab under the header, squeezing the
              transcript into whatever was left, which on a phone was almost
              nothing. That is the bug Geno reported. The shell fix in
              globals.css makes its position harmless either way; this puts it
              where it reads from and gives it the body's own margins. */}
          {(() => {
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
            if (!scaffold) return null
            return (
              <section className="scaffold" aria-label="How to rebuild this">
                <h4>How to rebuild this</h4>
                <p className="scaffold-why">{scaffold.mechanism}</p>
                {scaffold.evidence && <p className="scaffold-why">{scaffold.evidence}</p>}
                <ol className="scaffold-beats">
                  {scaffold.beats.map((beat, index) => (
                    <li key={index}>
                      <span className="scaffold-at">
                        {beat.at !== null ? clock(beat.at) : '—'} · {beat.role}
                      </span>
                      <span className="scaffold-ref">&ldquo;{beat.reference}&rdquo;</span>
                      <span className="scaffold-do">{beat.instruction}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )
          })()}

          {media ? (
            <video
              className="player"
              poster={item.has_thumb ? `/api/thumb/${item.id}` : undefined}
              controls
              playsInline
              preload="metadata"
              crossOrigin="anonymous"
            >
              <source src={media.video} type="video/mp4" />
              {/* The pipeline already wrote WebVTT, so the clip is watchable muted. */}
              <track kind="captions" srcLang="en" label="Transcript" src={media.captions} default />
            </video>
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

          <div className="axes">
            {AXES.map((axis) => (
              <TagPicker key={axis} axis={axis} tags={tags} onSave={(chosen) => saveAxis(axis, chosen)} />
            ))}
          </div>

          <AssignBar jobId={item.id} />

          <div className="copybar">
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
            <button
              className="btn btn-quiet"
              onClick={async () => {
                await fetch(`/api/items/${item.id}`, { method: 'DELETE' })
                onChanged()
                onClose()
              }}
            >
              Remove
            </button>
          </div>

          {item.status === 'failed' && <pre className="failbox">{item.error}</pre>}
          {full?.caption && <p className="caption">{full.caption}</p>}

          {blocks.map((block, index) => (
            <div className="block" key={index}>
              <p className="block-head">
                {block.speaker && <b>{block.speaker}</b>}
                {block.speaker && ' · '}
                {clock(block.start)}
              </p>
              <p>{block.text}</p>
            </div>
          ))}

          {blocks.length === 0 && plain && <div className="block"><p>{plain}</p></div>}

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
        </div>
      </aside>
    </>
  )
}
