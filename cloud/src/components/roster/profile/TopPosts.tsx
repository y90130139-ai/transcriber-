'use client'

import { useState } from 'react'
import { COMMENT_WEIGHT } from '@/lib/hot'
import { formatDate } from '@/lib/dates'
import type { HerPost } from '../types'

/** Enough to see what works for her without turning her profile into a second
 *  library. Six is also what the follower spark holds, so the two read as one
 *  idea about her rather than two widgets. */
const SHOWN = 6

/**
 * Her own best posts, out of what the library already holds.
 *
 * This needs no API access at all, which is the point. Her posts get ingested
 * metadata-only — `/api/models/[id]/posts` joins `transcripts.author` on her
 * handle — and that brings like and comment counts with it. So "what worked for
 * her" is answerable today, while views and watch time stay behind Meta's App
 * Review.
 *
 * Ranked on `likes + 10 × comments`, which is `hot.ts`'s score and therefore
 * the same yardstick the library ranks researched creators by. Two scales for
 * "good" is how you end up briefing her against one and judging her by the
 * other.
 */
export default function TopPosts(
  { posts, handle, modelId, onChange }:
  { posts: HerPost[]; handle: string; modelId: string | null; onChange?: () => void },
) {
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  /** The two things one of her winners can become. Same endpoint the week
   *  editor's strip uses — this is just the other place they are looked at,
   *  and a decision you can only take in one of two places is one you will
   *  take in neither. */
  async function act(postId: string, action: 'recreate' | 'repurpose' | 'unrepurpose') {
    // A model who has not been saved yet has no id to act against; the buttons
    // are hidden in that case, and this is the belt to that pair of braces.
    if (!modelId) return
    setBusy(postId)
    const response = await fetch(`/api/models/${modelId}/posts/${postId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(null)
    if (!response.ok) { setNote(body.error ?? 'That did not go through.'); return }
    if (action === 'recreate') {
      // Named, because from here there is no week open to see it land on.
      const week = formatDate(body.week_of)
      setNote(body.added ? `On the week of ${week} as a Recreate card — film it again.` : `Already on the week of ${week}.`)
    } else if (action === 'repurpose') {
      if (body.download) window.location.href = body.download
      const week = body.week_of ? formatDate(body.week_of) : null
      setNote([
        body.note ?? 'Marked to repost. Downloading the file for the batcher.',
        week ? (body.added ? `On the week of ${week} as a Repurpose card.` : `Already on the week of ${week}.`) : body.week_note,
      ].filter(Boolean).join(' '))
    } else {
      setNote('No longer marked to repost.')
    }
    onChange?.()
  }

  const ranked = [...posts]
    .map((post) => ({ post, score: scoreOf(post) }))
    // A post nobody has counts for scores zero and sinks, rather than being
    // dropped: it is still hers, and a silent exclusion reads as missing data.
    .sort((a, b) => b.score - a.score)
    .slice(0, SHOWN)

  return (
    <div className="axis">
      <div className="axis-head">
        <span className="axis-name">Their best posts</span>
        <span className="hint">{posts.length} of theirs in the library</span>
      </div>

      {ranked.length === 0 ? (
        <span className="hint">
          {handle
            ? `Nothing of @${handle}'s has been added yet. Paste their reels into the Queue and they land here.`
            : 'Set their handle above and their own posts will be matched to them.'}
        </span>
      ) : (
        <ul className="topposts">
          {ranked.map(({ post, score }, index) => (
            <li key={post.id}>
              <a
                className="toppost"
                href={post.webpage_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                {post.has_thumb ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={`/api/thumb/${post.id}`} alt="" width={112} height={112} loading="lazy" />
                ) : (
                  <span className="toppost-none" />
                )}
                <span>
                  <span className="toppost-figures">
                    <b>{(post.like_count ?? 0).toLocaleString('en-US')}</b> likes
                    {' · '}
                    <b>{(post.comment_count ?? 0).toLocaleString('en-US')}</b> comments
                    {score > 0 && <> · score <b>{Math.round(score).toLocaleString('en-US')}</b></>}
                  </span>
                  <br />
                  <span className="toppost-when">
                    {post.upload_date ? formatDate(post.upload_date) : 'undated'}
                    {post.card_no !== null && ` · was card ${post.card_no}`}
                  </span>
                </span>
                <span className="toppost-rank">{index + 1}</span>
              </a>
              {/* The thumbnail opens Instagram, which is the one thing it can
                  do that we cannot. These are the two things we can. */}
              <span className="toppost-acts" hidden={!modelId}>
                <button className="btn btn-small btn-quiet" disabled={busy === post.id}
                        onClick={() => void act(post.id, 'recreate')}>
                  They shoot it again
                </button>
                <button className="btn btn-small btn-quiet" disabled={busy === post.id}
                        data-on={post.repurposed ? true : undefined}
                        onClick={() => void act(post.id, post.repurposed ? 'unrepurpose' : 'repurpose')}>
                  {post.repurposed ? 'Reposting ✓' : 'Get the video to repost'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && <span className="hint">{note}</span>}
    </div>
  )
}

const scoreOf = (post: HerPost): number =>
  (post.like_count ?? 0) + COMMENT_WEIGHT * (post.comment_count ?? 0)
