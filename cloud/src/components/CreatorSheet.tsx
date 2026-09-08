'use client'

import { useCallback, useEffect, useState } from 'react'
import { clock, compact, thumbUrl } from '@/lib/format'
import { taxonomy } from '@/lib/taxonomy'

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
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

  return (
    <>
      <button className="reader-scrim" onClick={onClose} aria-label="Close" />
      <aside className="reader" aria-label={`${handle} profile`}>
        <header className="reader-head">
          <button className="reader-close" onClick={onClose} aria-label="Close">Close</button>
          <h3>{handle}</h3>
          {profile?.display_name && <p className="facts">{profile.display_name}</p>}
          <p className="facts">
            {posts.length} in the library
            {posts[0]?.upload_date ? ` · newest ${posts[0].upload_date}` : ''}
          </p>
        </header>

        <div className="reader-body">
          <div className="axis">
            <div className="axis-head">
              <span className="axis-name">Persona</span>
              <button className="axis-confirm" onClick={() => setEditing((open) => !open)}>
                {editing ? 'Done' : 'Edit'}
              </button>
            </div>
            <div className="chips">
              {persona.map((tag) => (
                <button
                  key={tag}
                  className="chip"
                  data-origin="human"
                  onClick={() => savePersona(persona.filter((existing) => existing !== tag))}
                >
                  {taxonomy.persona.tags.find((option) => option.id === tag)?.label ?? tag}
                </button>
              ))}
              {persona.length === 0 && !editing && (
                <span className="hint">Set it once and every new post inherits it.</span>
              )}
            </div>
            {editing && (
              <div className="picker">
                <div className="picker-grid">
                  {taxonomy.persona.tags.map((tag) => (
                    <button
                      key={tag.id}
                      className="picker-option"
                      data-on={persona.includes(tag.id)}
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
              </div>
            )}
          </div>

          {(formats.length > 0 || hooks.length > 0) && (
            <div className="axis">
              <div className="axis-head"><span className="axis-name">What they make</span></div>
              <div className="chips">
                {formats.map((row) => (
                  <span key={row.tag} className="chip chip-static">{row.tag} <b>{row.n}</b></span>
                ))}
                {hooks.map((row) => (
                  <span key={row.tag} className="chip chip-static">{row.tag} <b>{row.n}</b></span>
                ))}
              </div>
            </div>
          )}

          <div className="copybar">
            <button className="btn" onClick={() => onFilterTo(handle)}>See all in Library</button>
          </div>

          <div className="section-head">
            <h2 style={{ fontSize: 'var(--sc-text-lg)' }}>Top performers</h2>
          </div>

          <ol className="ladder">
            {posts.map((post) => (
              <li key={post.id} className="rung" data-hot={Boolean(post.is_hot)}>
                {post.has_thumb && (
                  <img src={thumbUrl(post.id)} alt="" width={96} height={120} loading="lazy" />
                )}
                <div>
                  <p className="rung-figure">
                    {post.outperformance ?? '—'}× {post.is_hot && <span>🔥</span>}
                  </p>
                  <p className="rung-meta">
                    {[post.upload_date, `${compact(post.like_count)} likes`,
                      `${compact(post.comment_count)} cm`, clock(post.duration_sec)]
                      .filter(Boolean).join(' · ')}
                  </p>
                  {post.preview && <p className="rung-line">{post.preview}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </>
  )
}
