/** Outperformance: how a post did against its own creator, not against others.
 *
 * Raw likes only rank creators by follower count — a 110k-like post from a
 * large account says nothing about what to make next. Dividing by that
 * creator's own median answers the actual research question: which of this
 * creator's posts beat their normal, and what did those posts do differently.
 */

/** A comment costs far more than a like, so it is worth more than one.
 *  This corpus runs about 34 likes per comment, so a weight of 10 lets
 *  comments carry roughly a quarter of the score without swamping it. */
export const COMMENT_WEIGHT = 10

/** Outperformance at or above this earns the flame. Tuned on the stored
 *  corpus: 1.75 marks the top ~10% rather than a third of the library. */
export const HOT_THRESHOLD = 1.75

/** Older than this and a post is out of the running entirely — the library is
 *  for deciding what to make now, not for admiring last year. */
export const HOT_WINDOW_DAYS = 90
export const MONTH_DAYS = 30
export const WEEK_DAYS = 7

/** A creator's median means nothing until there is something to take a median
 *  of, so a one-post creator scores 1.00 and never lights up. */
export const MIN_POSTS_FOR_HOT = 3

/** Shared CTE: per-post engagement score and per-creator median.
 *
 * The median is taken over everything that creator has in the library, not
 * just the last 90 days — a wider baseline is a steadier one, and the 90-day
 * rule governs which posts can be hot, not what they are measured against.
 */
export const SCORING_CTE = `
  scored as (
    select t.job_id,
           t.author,
           (coalesce(t.like_count, 0) + ${COMMENT_WEIGHT} * coalesce(t.comment_count, 0))::float as score
      from transcriber.transcripts t
     where t.like_count is not null or t.comment_count is not null
  ),
  baseline as (
    select author,
           percentile_cont(0.5) within group (order by score) as median_score,
           count(*) as posts
      from scored
     group by author
  )
`

/** The date fences. `t` is the transcripts row. */
export const IN_HOT_WINDOW = `t.upload_date >= to_char(now() - interval '${HOT_WINDOW_DAYS} days', 'YYYY-MM-DD')`
export const IN_MONTH = `t.upload_date >= to_char(now() - interval '${MONTH_DAYS} days', 'YYYY-MM-DD')`
export const IN_WEEK = `t.upload_date >= to_char(now() - interval '${WEEK_DAYS} days', 'YYYY-MM-DD')`

/** What earns the flame: beat your own median, recently, with enough history
 *  behind you for "your own median" to mean anything. */
export const IS_HOT = `(
  b.posts >= ${MIN_POSTS_FOR_HOT}
  and s.score / nullif(b.median_score, 0) >= ${HOT_THRESHOLD}
  and ${IN_HOT_WINDOW}
)`

/** Columns to select alongside a transcripts row. Expects `scored s` and
 *  `baseline b` to be joined in. */
export const SCORING_COLUMNS = `
  s.score as engagement_score,
  b.posts as creator_posts,
  round((s.score / nullif(b.median_score, 0))::numeric, 2)::float as outperformance,
  ${IS_HOT} as is_hot
`

/** The join to hang off `transcriber.transcripts t`. */
export const SCORING_JOIN = `
  left join scored   s on s.job_id = t.job_id
  left join baseline b on b.author = t.author
`
