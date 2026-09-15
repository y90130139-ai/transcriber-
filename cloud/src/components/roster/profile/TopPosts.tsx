'use client'

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
export default function TopPosts({ posts, handle }: { posts: HerPost[]; handle: string }) {
  const ranked = [...posts]
    .map((post) => ({ post, score: scoreOf(post) }))
    // A post nobody has counts for scores zero and sinks, rather than being
    // dropped: it is still hers, and a silent exclusion reads as missing data.
    .sort((a, b) => b.score - a.score)
    .slice(0, SHOWN)

  return (
    <div className="axis">
      <div className="axis-head">
        <span className="axis-name">Her best posts</span>
        <span className="hint">{posts.length} of hers in the library</span>
      </div>

      {ranked.length === 0 ? (
        <span className="hint">
          {handle
            ? `Nothing of @${handle}'s has been added yet. Paste her reels into the Queue and they land here.`
            : 'Set her handle above and her own posts will be matched to her.'}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const scoreOf = (post: HerPost): number =>
  (post.like_count ?? 0) + COMMENT_WEIGHT * (post.comment_count ?? 0)
