/**
 * Why this reel is worth making — in words, not a multiplier.
 *
 * The library has always carried `outperformance`: a post's engagement over
 * its creator's median, rendered as "8.53×". It is the right maths and the
 * wrong sentence. A model reading her week does not know what 8.53× is against
 * (and should not have to); she knows what "blowing up" means.
 *
 * Now that the sweep stores plays, the reasons can also be better than
 * engagement alone. Four signals, each a plain condition on a number we have:
 *
 *   reach     — plays against that creator's own median plays
 *   reaction  — likes + comments per play, which is what people did once they
 *               saw it; a modest reel that grips is worth copying
 *   climbing  — this sweep's plays against last sweep's
 *   sound     — how many watched creators picked up the same audio lately
 *
 * Thresholds are measured over the corpus (2026-09-19, 1,864 sightings) and
 * named here, never inline, so a badge that reads wrong is a number to change.
 * Nothing is invented: a reel with no play data gets no reach badge, and a
 * card with no signal at all says nothing rather than something vague.
 */

/** Reach against the creator's own median plays. 5× is the corpus top decile,
 *  the same bar the sweep uses to pick a reel at all. */
export const REACH_BIG = 5
export const REACH_GOOD = 2

/** Likes + comments per play. Median is 2.4%, top decile 6.6%, so 6.6% is
 *  "people did not just watch it, they responded". */
export const REACTION_STRONG = 0.066
export const REACTION_GOOD = 0.042

/** Plays since the last sweep. A quarter up in a week is still moving. */
export const CLIMB_RATIO = 1.25

/** How many watched creators must be on the same audio, in the last
 *  fortnight, before it is a trend rather than a coincidence. */
export const SOUND_CREATORS = 2

/** Fresh enough that copying it now lands in the same wave. */
export const FRESH_DAYS = 7

export type Signals = {
  plays: number | null
  playsPrev: number | null
  likes: number | null
  comments: number | null
  medianPlays: number | null
  postedAt: string | Date | null
  soundCreators: number | null
  soundTitle: string | null
  /** The old engagement-over-median figure, for rows with no play data. */
  outperformance: number | null
}

export type Badge = {
  /** What a person reads. */
  label: string
  /** The number behind it, for the console. Never shown to a model. */
  detail: string
  /** Ordering and colour: 'hot' is the loudest. */
  tone: 'hot' | 'warm' | 'cool'
}

const daysSince = (value: string | Date | null): number | null => {
  if (!value) return null
  const at = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(at.getTime())) return null
  return (Date.now() - at.getTime()) / 86_400_000
}

/** Views, the way a person says them: 1.2M, 48K, 900. */
export function views(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`
  return String(count)
}

/**
 * The badges for one reel, strongest first.
 *
 * At most three: a card that shouts four things shouts nothing. Every badge
 * carries the figure it was drawn from, so the console can show the working
 * while her page shows the sentence.
 */
export function badgesFor(signals: Signals): Badge[] {
  const badges: Badge[] = []
  const age = daysSince(signals.postedAt)
  const fresh = age !== null && age <= FRESH_DAYS

  const reach =
    signals.plays && signals.medianPlays && signals.medianPlays > 0
      ? signals.plays / signals.medianPlays
      : null

  if (reach !== null && reach >= REACH_BIG) {
    badges.push({
      label: fresh ? 'Blowing up' : 'Proven hit',
      detail: `${views(signals.plays)} views · ${reach.toFixed(1)}× this creator's usual`,
      tone: 'hot',
    })
  } else if (reach !== null && reach >= REACH_GOOD) {
    badges.push({
      label: 'Doing well',
      detail: `${views(signals.plays)} views · ${reach.toFixed(1)}× this creator's usual`,
      tone: 'warm',
    })
  } else if (reach === null && signals.outperformance !== null && signals.outperformance >= 1.75) {
    // No plays for this one — the old engagement measure still says something,
    // and saying it plainly beats showing a number nobody reads.
    badges.push({
      label: 'Popular',
      detail: `${signals.outperformance.toFixed(1)}× this creator's usual likes and comments`,
      tone: 'warm',
    })
  }

  if (signals.plays && signals.plays > 0) {
    const reaction = ((signals.likes ?? 0) + (signals.comments ?? 0)) / signals.plays
    if (reaction >= REACTION_STRONG) {
      badges.push({
        label: 'People reacted',
        detail: `${(reaction * 100).toFixed(1)}% of viewers liked or commented — top 10%`,
        tone: 'warm',
      })
    } else if (reaction >= REACTION_GOOD && badges.length === 0) {
      badges.push({
        label: 'Good response',
        detail: `${(reaction * 100).toFixed(1)}% of viewers liked or commented`,
        tone: 'cool',
      })
    }
  }

  if (signals.plays && signals.playsPrev && signals.playsPrev > 0) {
    const ratio = signals.plays / signals.playsPrev
    if (ratio >= CLIMB_RATIO) {
      badges.push({
        label: 'Still climbing',
        detail: `up ${Math.round((ratio - 1) * 100)}% since last week`,
        tone: 'hot',
      })
    }
  }

  if ((signals.soundCreators ?? 0) >= SOUND_CREATORS) {
    badges.push({
      label: 'Trending sound',
      detail: signals.soundTitle
        ? `${signals.soundCreators} creators we watch used "${signals.soundTitle}" in the last fortnight`
        : `${signals.soundCreators} creators we watch used this audio in the last fortnight`,
      tone: 'hot',
    })
  }

  const order = { hot: 0, warm: 1, cool: 2 }
  return badges.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 3)
}

/** One line for the model's card: what it did, in her language. Null when
 *  there is nothing true to say — an empty space beats a vague boast. */
export function headlineFor(signals: Signals): string | null {
  const badges = badgesFor(signals)
  if (badges.length === 0) return null
  const seen = views(signals.plays)
  const lead = badges[0].label
  const sound = badges.find((b) => b.label === 'Trending sound')
  if (sound && lead !== 'Trending sound') return seen ? `${lead} · ${seen} views · trending sound` : `${lead} · trending sound`
  return seen ? `${lead} · ${seen} views` : lead
}

/** The SQL that feeds `Signals`. Expects `transcripts t` in scope and joins
 *  the sweep's own tables; every column is null-safe, because most of the
 *  library predates the sweep. */
export const SIGNALS_JOIN = `
  left join transcriber.sightings sg on sg.post_id = t.post_id
  left join lateral (
    select percentile_cont(0.5) within group (order by s2.plays) as median_plays
      from transcriber.sightings s2
     where s2.handle = sg.handle and s2.plays is not null and not s2.pinned
       and s2.posted_at >= now() - interval '120 days'
  ) base on true
  left join lateral (
    select count(distinct s3.handle)::int as creators, max(s3.audio_title) as title
      from transcriber.sightings s3
     where s3.audio_id = sg.audio_id and sg.audio_id is not null
       and sg.original_audio is not true
       and s3.posted_at >= now() - interval '14 days'
  ) sound on true
`

export const SIGNALS_COLUMNS = `
  sg.plays          as sig_plays,
  sg.plays_prev     as sig_plays_prev,
  sg.likes          as sig_likes,
  sg.comments       as sig_comments,
  sg.posted_at      as sig_posted_at,
  base.median_plays as sig_median_plays,
  sound.creators    as sig_sound_creators,
  sound.title       as sig_sound_title
`

/** Build `Signals` from a row selected with `SIGNALS_COLUMNS`. */
export function signalsFrom(row: Record<string, unknown>): Signals {
  const number = (value: unknown): number | null => {
    const n = typeof value === 'string' ? Number(value) : value
    return typeof n === 'number' && Number.isFinite(n) ? n : null
  }
  return {
    plays: number(row.sig_plays),
    playsPrev: number(row.sig_plays_prev),
    likes: number(row.sig_likes),
    comments: number(row.sig_comments),
    medianPlays: number(row.sig_median_plays),
    postedAt: (row.sig_posted_at as string | null) ?? null,
    soundCreators: number(row.sig_sound_creators),
    soundTitle: (row.sig_sound_title as string | null) ?? null,
    outperformance: number(row.outperformance),
  }
}

/** The standing legend, in the same place the old multiplier's lived. Says
 *  what each badge means, because a word nobody can define is no better than
 *  a number nobody can read. */
export const BADGE_LEGEND =
  `Blowing up = ${REACH_BIG}× this creator's usual views, posted in the last ` +
  `${FRESH_DAYS} days · Proven hit = the same, but older · Doing well = ` +
  `${REACH_GOOD}× their usual · People reacted = top 10% for likes and ` +
  `comments per view · Still climbing = views up ${Math.round((CLIMB_RATIO - 1) * 100)}% ` +
  `since last week · Trending sound = ${SOUND_CREATORS} or more watched creators ` +
  `on the same audio in a fortnight. Hover any badge for its numbers.`
