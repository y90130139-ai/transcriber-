'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { clock, compact, thumbUrl } from '@/lib/format'
import { labelOf, taxonomy } from '@/lib/taxonomy'
import { explainOutperformance } from '@/lib/outperformance'
import Scorecard from './Scorecard'
import WhyChips from './WhyChips'
import type { Why } from '@/lib/reasons'

type Profile = { handle: string; display_name: string | null; persona: string[]; note: string | null }
type Post = {
  id: string
  title: string | null
  upload_date: string | null
  duration_sec: number | null
  like_count: number | null
  comment_count: number | null
  outperformance: number | null
  is_hot: boolean | null
  has_thumb: boolean
  webpage_url: string | null
  preview: string | null
  why: Why | null
}
type Tally = { axis: string; tag: string; n: number }

/** One creator, up close: what they are, what they normally do, what beat it. */
export default function CreatorSheet({
  handle,
  onClose,
  onSaved,
  onFilterTo,
}: {
  handle: string
  onClose: () => void
  onSaved: () => void
  onFilterTo: (handle: string) => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [tally, setTally] = useState<Tally[]>([])
  const [editing, setEditing] = useState(false)
  const [closing, setClosing] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(`/api/creators/${encodeURIComponent(handle)}`)
    if (!response.ok) return
    const body = await response.json()
    setProfile(body.creator)
    setPosts(body.posts ?? [])
    setTally(body.tally ?? [])
  }, [handle])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  function requestClose() {
    if (closing) return
    setClosing(true)
    window.setTimeout(onClose, 150)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closing, onClose])

  async function savePersona(persona: string[]) {
    const response = await fetch(`/api/creators/${encodeURIComponent(handle)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, note: profile?.note ?? null }),
    })
    if (response.ok) {
      setProfile((await response.json()).creator)
      onSaved()
    }
  }

  const persona = profile?.persona ?? []
  const formats = tally.filter((row) => row.axis === 'format').slice(0, 6)
  const hooks = tally.filter((row) => row.axis === 'hook').slice(0, 4)

  return createPortal(
    <div className="creatordialog-layer" data-closing={closing || undefined}>
      <button
        type="button"
        className="creatordialog-scrim"
        onClick={requestClose}
        aria-label="Close"
      />
      <div
        className="creatordialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${handle} profile`}
      >
        <header className="creatordialog-head">
          <div className="creatordialog-id">
            <h3>@{handle}</h3>
            <p className="creatordialog-facts">
              {profile?.display_name && <span>{profile.display_name}</span>}
              <span>{posts.length} in the library</span>
              {posts[0]?.upload_date && <span>Newest {posts[0].upload_date}</span>}
            </p>
          </div>
          <button type="button" className="creatordialog-x" onClick={requestClose} aria-label="Close">×</button>
        </header>

        <div className="creatordialog-body">
          <section className="creatordialog-sec">
            <div className="creatordialog-sec-head">
              <h4>Persona</h4>
              <button type="button" onClick={() => setEditing((open) => !open)}>
                {editing ? 'Done' : 'Edit'}
              </button>
            </div>
            <div className="creatordialog-chips">
              {persona.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => savePersona(persona.filter((existing) => existing !== tag))}
                >
                  {taxonomy.persona.tags.find((option) => option.id === tag)?.label ?? tag}
                </button>
              ))}
              {persona.length === 0 && !editing && (
                <span className="creatordialog-empty">No persona yet. Set it once and every new post inherits it.</span>
              )}
            </div>
            {editing && (
              <div className="creatordialog-picker">
                {taxonomy.persona.tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    data-on={persona.includes(tag.id) || undefined}
                    onClick={() =>
                      savePersona(
                        persona.includes(tag.id)
                          ? persona.filter((existing) => existing !== tag.id)
                          : [...persona, tag.id],
                      )
                    }
                  >
                    <b>{tag.label}</b>
                    <span>{tag.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="creatordialog-sec">
            <Scorecard handle={handle} />
          </section>

          {(formats.length > 0 || hooks.length > 0) && (
            <section className="creatordialog-sec">
              <div className="creatordialog-sec-head"><h4>What they make</h4></div>
              <div className="creatordialog-make">
                {formats.length > 0 && (
                  <div>
                    <span>Formats</span>
                    <div className="creatordialog-chips">
                      {formats.map((row) => (
                        <span key={`f-${row.tag}`}>{labelOf('format', row.tag)} <b>{row.n}</b></span>
                      ))}
                    </div>
                  </div>
                )}
                {hooks.length > 0 && (
                  <div>
                    <span>Hooks</span>
                    <div className="creatordialog-chips">
                      {hooks.map((row) => (
                        <span key={`h-${row.tag}`}>{labelOf('hook', row.tag)} <b>{row.n}</b></span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="creatordialog-sec creatordialog-posts-sec">
            <div className="creatordialog-sec-head">
              <h4>Top performers</h4>
              <button type="button" className="creatordialog-library" onClick={() => onFilterTo(handle)}>
                See all in Library
              </button>
            </div>
            {posts.length === 0 ? (
              <p className="creatordialog-empty">Nothing of theirs in the library yet.</p>
            ) : (
              <ol className="creatordialog-posts">
                {posts.map((post) => (
                  <li key={post.id}>
                    {post.has_thumb ? (
                      <img src={thumbUrl(post.id)} alt="" width={72} height={90} loading="lazy" />
                    ) : (
                      <span className="creatordialog-nothumb" aria-hidden="true" />
                    )}
                    <div className="creatordialog-post">
                      <p className="creatordialog-post-top">
                        <b title={post.outperformance ? explainOutperformance(post.outperformance) : undefined}>
                          {post.outperformance ?? '—'}×
                        </b>
                        {post.is_hot && <span className="creatordialog-hot">Hot</span>}
                        <span className="creatordialog-meta">
                          {[post.upload_date, `${compact(post.like_count)} likes`,
                            `${compact(post.comment_count)} comments`, clock(post.duration_sec)]
                            .filter(Boolean).join(' · ')}
                        </span>
                      </p>
                      {post.why?.multiple != null && (
                        <p className="creatordialog-multiple">{post.why.multiple}× their median plays</p>
                      )}
                      {post.preview && <p className="creatordialog-line">{post.preview}</p>}
                      <WhyChips why={post.why} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
