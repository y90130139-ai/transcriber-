'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import PlanItemCard from './PlanItemCard'
import { CantDoNotice, CantDoSection, cardIdOf, type CantDoReason } from './CantDo'
import RunSheet from './RunSheet'
import ThemeToggle from './ThemeToggle'
import { useReveal } from '@/hooks/useReveal'
import { groupBySetup } from '@/lib/effort'
import MakeItYours from './MakeItYours'
import SetupProfile from './SetupProfile'
import { cleanStyle } from '@/lib/portal-style'
import { bucketOf, type PlanBucket } from '@/lib/plan-buckets'
import { CAROUSEL_PLAN, STORY_PROMPTS } from '@/lib/card'
import { contentLines } from '@/lib/plan-contents'
import { sourceLine } from '@/lib/source'
import { filmingDaysLabel, formatDate, isOverdue } from '@/lib/dates'
import type { Plan, PlanItem, PlanModel, Verdict } from '@/lib/plans'
import type { DeclineCode } from '@/lib/decline'

/** How long "moved — Undo" stays up after a card leaves her feed. */
const NOTICE_MS = 6000

/** How long a card arrived at by link (#v-12) keeps its ember ring. Long
 *  enough to be found after the eye catches the scroll landing, no longer. */
const SPOT_MS = 4000

/** One repaint's grace before jumping to the linked card: cards below the
 *  fold start hidden by the reveal pass and the players need their first
 *  layout, or the scroll lands short of the right spot. */
const SPOT_DELAY_MS = 300

/** One run of consecutive cards filmed in the same place. Runs, not buckets:
 *  the order on the plan is Geno's, and re-sorting it to collapse two visits to
 *  the kitchen into one would silently rewrite the week he sent her. */
type Group = { location: string | null; items: PlanItem[] }

function groupByLocation(items: PlanItem[]): Group[] {
  const groups: Group[] = []
  for (const item of items) {
    const location = item.location ?? null
    const last = groups[groups.length - 1]
    if (last && last.location === location) last.items.push(item)
    else groups.push({ location, items: [item] })
  }
  return groups
}

/** Height of the pinned bar; the hero counts as gone once it slides under it. */
const CHROME_PX = 64

const GUIDE_KEY = 'plan.guide.hidden'

/** The nearest ancestor that scrolls on its own, or null for the window. */
function scrollParent(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement
  while (parent && parent !== document.body) {
    const { overflowY } = window.getComputedStyle(parent)
    if (overflowY === 'auto' || overflowY === 'scroll') return parent
    parent = parent.parentElement
  }
  return null
}

/** The three things she does, pinned open at the top (2026-09-27): three
 *  creators needed the flow explained in chat. The folded "How your plan
 *  works" list went the same day — every card now carries its own steps.
 *  She edits her own videos; that is said once, here. */
const QUICK_STEPS = [
  { title: 'Watch', text: 'Watch each video under “To review”.' },
  { title: 'Yes or no', text: 'Tap “I’ll do this” or “Can’t do this” on every card. Your yeses move to “My reels”.' },
  { title: 'Film', text: 'Film and edit everything on “My reels” — easiest first. Name each file by its number (V-1, V-2…).' },
]

export default function PlanView({
  token,
  model,
  plan,
  items,
  preview = false,
}: {
  token: string
  model: PlanModel
  plan: Plan
  items: PlanItem[]
  /**
   * Rendered inside the console as "what she sees" rather than opened by her.
   *
   * The console imports this exact component for its preview instead of
   * keeping a second look-alike in sync by hand. That is the whole design:
   * the two surfaces cannot drift apart, because there is only one of them.
   *
   * The flag is passed straight down to every card, where it stops each
   * mutation before its fetch. See PlanItemCard's own note — the console
   * previews REAL creators' live plans, so a preview that wrote would edit
   * her week from Geno's screen while he was only looking at it.
   */
  preview?: boolean
}) {
  const [filmed, setFilmed] = useState<Set<string>>(
    () => new Set(items.filter((item) => item.filmed).map((item) => item.id)),
  )
  /** Her own numbers, opened from the pill in the header. Never in the console
   *  preview: it reads live figures for a real model and there is nothing to
   *  check by opening it from Geno's screen. */
  const [runOpen, setRunOpen] = useState(false)
  /** Cards she turned down, out of her feed and in "Videos you can't do",
   *  with the reason as the page last knew it. */
  const [cantDo, setCantDo] = useState<Map<string, CantDoReason>>(() => new Map(
    items.filter((item) => item.verdict === 'declined')
      .map((item) => [item.id, { code: item.decline_code, reason: item.decline_reason }]),
  ))
  /** Added back this visit. Their cards render as unanswered, and remount so
   *  the card's own verdict state starts from that. */
  const [reopened, setReopened] = useState<Set<string>>(() => new Set())
  const [notice, setNotice] = useState<{ id: string; label: string } | null>(null)
  /** Verdicts as the cards themselves now believe them — each card keeps its
   *  own optimistic state and reports every change up, so the page can file
   *  it under "To review" or "My reels" without a reload. */
  const [verdicts, setVerdicts] = useState<Map<string, Verdict>>(() => new Map())
  /** Which pile she is looking at. Opens on whatever still wants her answer;
   *  a week she has fully answered opens on her own list. Her tap wins after
   *  that — a card moving piles never yanks the view out from under her. */
  const [view, setView] = useState<PlanBucket>(() => {
    const live = items.filter((item) => item.verdict !== 'declined' && !item.mine)
    return live.some((item) => bucketOf(item) === 'review') ? 'review' : 'mine'
  })
  /** "V-12 is on My reels" — the card left this pile on her tap, and the page
   *  owes her one line about where it went. */
  const [moved, setMoved] = useState<string | null>(null)

  useEffect(() => {
    if (!moved) return
    const timer = setTimeout(() => setMoved(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [moved])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  /** Opened at `#v-12` — the deep link a relayed Telegram question carries
   *  (2026-10-06, Geno: the team was scrolling whole weeks matching numbers
   *  by eye). Jump to that card and ring it briefly. Like `useReveal`, this
   *  writes a data attribute the CSS watches; a card that is not on the page
   *  any more (declined, moved weeks) leaves the page exactly as it was. */
  useEffect(() => {
    const anchor = decodeURIComponent(window.location.hash.slice(1))
    if (!anchor) return
    let ring: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      const target = document.getElementById(anchor)
      if (!target || !target.classList.contains('plan-item')) return
      target.scrollIntoView({ block: 'start' })
      target.setAttribute('data-spot', '')
      ring = setTimeout(() => target.removeAttribute('data-spot'), SPOT_MS)
    }, SPOT_DELAY_MS)
    return () => {
      clearTimeout(timer)
      if (ring) clearTimeout(ring)
    }
  }, [])
  /** First open: the setup sheet, once, never in the preview (a save there
   *  would write Geno's taste onto her profile). `done` is stamped by the
   *  sheet itself whichever button she taps. */
  const [setupOpen, setSetupOpen] = useState(
    () => !preview && cleanStyle(model.portal_style).done !== true,
  )
  /** The bar on top is pinned and never changes height; once the hero under
   *  it has scrolled away it swaps her name for the week and the count. The
   *  old header condensed itself in place, which shortened the page, moved
   *  the sentinel back on screen and flickered on every scroll. */
  const [stuck, setStuck] = useState(false)
  const [tucked, setTucked] = useState(false)
  const heroEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = heroEnd.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    // The console's phone scrolls its own screen, not the window.
    const root = scrollParent(sentinel)
    const watch = new IntersectionObserver(
      ([entry]) => {
        const top = entry.rootBounds?.top ?? 0
        // Past the hero means above the root, not merely off screen below it.
        const past = !entry.isIntersecting && entry.boundingClientRect.top < top
        setStuck(past)
        // Back at the top, the bar comes back by itself.
        if (!past) setTucked(false)
      },
      { root, rootMargin: `-${CHROME_PX}px 0px 0px 0px`, threshold: 0 },
    )
    watch.observe(sentinel)
    return () => watch.disconnect()
  }, [])

  /** "How to use this" stays out of the way once she has said she knows it.
   *  The console preview always shows it — that is the first-visit view. */
  const [guideHidden, setGuideHidden] = useState(false)
  useEffect(() => {
    if (preview) return
    try {
      if (window.localStorage.getItem(GUIDE_KEY) === '1') setGuideHidden(true)
    } catch {}
  }, [preview])
  function hideGuide(next: boolean) {
    setGuideHidden(next)
    if (preview) return
    try {
      if (next) window.localStorage.setItem(GUIDE_KEY, '1')
      else window.localStorage.removeItem(GUIDE_KEY)
    } catch {}
  }

  // Either half is enough to have something to say. Neither, and every
  // delivery render on this page is skipped rather than drawn empty.
  const folder = model.drive_url

  const overdue = useMemo(() => isOverdue(plan.due_date, model.timezone), [plan.due_date, model.timezone])
  // Her own reels are not this week's ideas (Susanna, 2026-09-27: "they look
  // like assignments"). They sit in their own section at the end and are not
  // counted in what is left to film.
  // A card she said no to leaves both lists for "Videos you can't do" — the
  // feed is what she still has to film (Geno, 2026-09-27).
  const shown = useMemo(() => items.filter((item) => !cantDo.has(item.id)).map((item) => {
    const override = verdicts.get(item.id)
    const base = override && override !== item.verdict ? { ...item, verdict: override } : item
    return reopened.has(item.id)
      ? { ...base, verdict: 'open' as const, decline_code: null, decline_reason: null }
      : base
  }), [items, cantDo, reopened, verdicts])
  const ideas = useMemo(() => shown.filter((item) => !item.mine), [shown])
  const yours = useMemo(() => shown.filter((item) => item.mine), [shown])
  const turnedDown = useMemo(() => items.filter((item) => cantDo.has(item.id)), [items, cantDo])
  const done = ideas.filter((item) => filmed.has(item.id)).length
  const total = ideas.length

  // The week in two piles (Geno, 2026-10-06): the ideas still waiting on her
  // yes or no, and "My reels" — the ones she took on (or filmed outright,
  // which is the same answer said louder). Card numbers stay the plan's own:
  // V-7 is V-7 in either pile.
  const review = useMemo(
    () => ideas.filter((item) => bucketOf({ verdict: item.verdict, filmed: filmed.has(item.id) }) === 'review'),
    [ideas, filmed],
  )
  const mine = useMemo(
    () => ideas.filter((item) => bucketOf({ verdict: item.verdict, filmed: filmed.has(item.id) }) === 'mine'),
    [ideas, filmed],
  )
  const visible = view === 'review' ? review : mine

  // The pile in filming sittings — talking heads in one, propped-phone
  // visuals in another, skits last — quickest sitting first, quickest card
  // first inside each (Geno, 2026-10-06: "they could bang out the ones" that
  // share a setup). This re-orders the page, not the plan: positions, card
  // numbers and everything stored are untouched. A pile whose cards all land
  // in one sitting returns null and keeps the shape it always had.
  const setups = useMemo(() => groupBySetup(visible), [visible])

  // Grouping only turns on once somewhere has actually been named. A pile with
  // no locations set renders exactly the flat list it always has.
  const groups = useMemo(() => groupByLocation(visible), [visible])
  const grouped = groups.some((group) => group.location)

  // Cards arrive as she scrolls to them. The ref goes on the body rather than
  // on each list, so a grouped week staggers across its groups in reading
  // order instead of restarting the count at every location bar.
  const body = useReveal<HTMLDivElement>([items.length, grouped, setups !== null, view])

  function moveToCantDo(item: PlanItem, code: DeclineCode, reason: string) {
    setCantDo((current) => new Map(current).set(item.id, { code, reason: reason || null }))
    setReopened((current) => {
      const copy = new Set(current)
      copy.delete(item.id)
      return copy
    })
    setNotice({ id: item.id, label: cardIdOf(item, items.indexOf(item) + 1) })
  }

  /** Back into her feed, unanswered. The decline is cleared on the server too,
   *  so the reel can be sent to her again. */
  async function addBack(id: string): Promise<boolean> {
    if (!preview) {
      const response = await fetch(`/api/plan/${token}/verdict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: id, verdict: 'open', reason: null, code: null }),
      }).catch(() => null)
      if (!response?.ok) return false
    }
    setCantDo((current) => {
      const copy = new Map(current)
      copy.delete(id)
      return copy
    })
    setReopened((current) => new Set(current).add(id))
    // A stale card-side verdict would fight the reopen — the card remounts
    // as unanswered, and the page has to believe the same thing.
    setVerdicts((current) => {
      const copy = new Map(current)
      copy.delete(id)
      return copy
    })
    setNotice((current) => (current?.id === id ? null : current))
    return true
  }

  /** A card changed its answer. File it, and when a yes just left the pile
   *  she is looking at, say where it went — a vanishing card with no word
   *  reads as a bug, not a filing. */
  function noteVerdict(item: PlanItem, next: Verdict) {
    setVerdicts((current) => new Map(current).set(item.id, next))
    setReopened((current) => {
      if (!current.has(item.id)) return current
      const copy = new Set(current)
      copy.delete(item.id)
      return copy
    })
    const label = cardIdOf(item, items.indexOf(item) + 1)
    if (next === 'accepted' && view === 'review') setMoved(`${label} is on “My reels”`)
    // Taking a yes back from "My reels" sends the card the other way.
    if (next === 'open' && view === 'mine' && !filmed.has(item.id)) {
      setMoved(`${label} is back under “To review”`)
    }
  }

  function card(item: PlanItem, number: number) {
    return (
      <PlanItemCard
        key={reopened.has(item.id) ? `${item.id}:back` : item.id}
        token={token}
        item={item}
        number={number}
        filmed={filmed.has(item.id)}
        folder={folder}
        preview={preview}
        inGroup={Boolean(model.in_group)}
        onFilmed={(next) => mark(item.id, next)}
        onDeclined={(code, reason) => moveToCantDo(item, code, reason)}
        onVerdict={(next) => noteVerdict(item, next)}
      />
    )
  }

  function mark(id: string, next: boolean) {
    setFilmed((current) => {
      const copy = new Set(current)
      if (next) copy.add(id)
      else copy.delete(id)
      return copy
    })
  }

  return (
    <main className="plan">
      {runOpen && !preview && <RunSheet token={token} onClose={() => setRunOpen(false)} />}
      {/* Pinned, one height for its whole life. Only the words in the middle
          swap once the hero has scrolled under it: her name at rest, the week
          and the count while she reads cards. */}
      <header className="plan-chrome" data-stuck={stuck || undefined} data-tucked={tucked || undefined}>
        <div className="plan-chrome-row">
          {model.photo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className="plan-face" src={model.photo_url} alt="" width={80} height={80} />
          )}
          <div className="plan-chrome-id">
            <span className="plan-chrome-rest" aria-hidden={stuck || undefined}>
              <b className="plan-name">{model.name}</b>
              <span className="plan-eyebrow">Your content plan</span>
            </span>
            <span className="plan-chrome-live" aria-hidden={!stuck || undefined}>
              <b>Week of {formatDate(plan.week_of)}</b>
              <span><em>{done}</em>/{total} filmed · Due {formatDate(plan.due_date)}</span>
            </span>
          </div>

          <div className="plan-tools">
            <button
              type="button"
              className="plan-run"
              onClick={() => setRunOpen(true)}
              aria-haspopup="dialog"
              aria-label="Your run"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                   strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3c0 4-4 5-4 9a4 4 0 0 0 8 0c0-2-1-3-1-3s3 2 3 6a8 8 0 0 1-8 8 8 8 0 0 1-8-8c0-7 10-8 10-12z" />
              </svg>
              <span className="plan-tool-label" aria-hidden="true">Your run</span>
            </button>
            {/* Her deck of picked reels — hers to browse, star and claim
                (2026-10-06). Never in the console preview: starring from
                Geno's screen would write her taste for her. */}
            {!preview && (
              <a className="plan-run plan-discover-link" href={`/p/${token}/discover`} aria-label="Discover">
                <span aria-hidden="true">&#10022;</span>
                <span className="plan-tool-label" aria-hidden="true">Discover</span>
              </a>
            )}
            <ThemeToggle />
            {/* Always rendered so the row never reflows; only usable once the
                bar is actually in her way. */}
            <button
              type="button"
              className="plan-tuck"
              onClick={() => setTucked(true)}
              aria-label="Tuck this out of the way"
              tabIndex={stuck ? 0 : -1}
              data-on={stuck || undefined}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 15l6-6 6 6" />
              </svg>
            </button>
          </div>
        </div>
        {/* A hairline of progress under the bar, so the count is still a
            picture once the hero is gone. */}
        <span className="plan-chrome-progress" aria-hidden="true">
          <i style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
        </span>
      </header>

      {/* The week is the headline. It scrolls away with the page — nothing
          here is ever restyled by scroll position. */}
      <section className="plan-hero" aria-label="This week">
        <h1 className="plan-week">Week of {formatDate(plan.week_of)}</h1>
        {plan.title && <p className="plan-title">{plan.title}</p>}

        <div className="plan-score">
          <p className="plan-count">
            <b>{done}</b><span>/{total}</span>
            <small>filmed</small>
          </p>
          <ul className="plan-facts">
            <li data-late={overdue || undefined}>
              <span>Due</span>
              {formatDate(plan.due_date)}{overdue && ' · overdue'}
            </li>
            <li>
              <span>Filming</span>
              {filmingDaysLabel(model.filming_days)}
            </li>
          </ul>
        </div>

        {/* One segment per video rather than one filling rule, so she can
            count what is left without doing the arithmetic. */}
        <div
          className="plan-bar"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Videos filmed"
        >
          {ideas.map((item, index) => (
            <i key={item.id} data-on={index < done || undefined} />
          ))}
        </div>
      </section>
      <div ref={heroEnd} className="plan-mark" aria-hidden="true" />

      {tucked && (
        <button type="button" className="plan-untuck" onClick={() => setTucked(false)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
          {done}/{total} filmed
        </button>
      )}

      <div className="plan-body" ref={body}>
        {/* The intro paragraph is gone (Geno, 2026-10-06) — in its place,
            what the week actually contains, counted: so she knows at a
            glance it is 14 skits and 7 talking heads, plus the carousels
            and stories that live in the fold below. */}
        {ideas.length > 0 && (
          <section className="plan-contents" aria-label="What is in this plan">
            <p className="plan-label">In this plan</p>
            <ol className="plan-contents-list">
              {contentLines(ideas).map((line) => (
                <li key={line.label}><b>{line.count}×</b> {line.label}</li>
              ))}
              <li className="plan-contents-extra">
                <b>{CAROUSEL_PLAN.count}×</b> Carousel posts — photo sets, slots under
                &ldquo;Stories and carousels&rdquo;
              </li>
              <li className="plan-contents-extra"><b>{STORY_PROMPTS.length}×</b> Stories — one a day</li>
            </ol>
            {/* Where the week came from (2026-10-08): copies, twists, and
                the ones written just for her. Nothing when there is nothing
                worth saying. */}
            {sourceLine(ideas) && (
              <p className="plan-contents-sources">{sourceLine(ideas)}</p>
            )}
          </section>
        )}

        {/* Her own rules, when she has any. The house background rule used to
            sit under them for everyone; Geno cut it 2026-10-06 ("unnecessary")
            — backgrounds are the shot list's job now, per card. */}
        {model.standing_rules && (
          <section className="plan-rules" aria-label="What applies to everything">
            <p className="plan-label">Always</p>
            <p>{model.standing_rules}</p>
          </section>
        )}

        {/* The two things the analytics measure her against and the plan never
            asked for. Carousels come from the shoot-day photos, so they cost
            no extra filming; stories rotate so no two days ask the same. */}
        <details className="plan-extras">
          <summary>Stories and carousels this week</summary>
          <p className="plan-label">Carousels · {CAROUSEL_PLAN.count} this week</p>
          <p>
            {CAROUSEL_PLAN.slots.map((slot) => `${slot.day} ${slot.time}`).join(' and ')} —
            in the gap between your reels, never within an hour of one.
          </p>
          <p className="plan-quiet">{CAROUSEL_PLAN.source}</p>
          <p className="plan-label">A story every day</p>
          <dl className="plan-spec">
            {STORY_PROMPTS.map((story) => (
              <div className="plan-spec-row" key={story.day}>
                <dt>{story.day.slice(0, 3)} · {story.theme}</dt>
                <dd>{story.prompt}</dd>
              </div>
            ))}
          </dl>
        </details>

        {guideHidden ? (
          <button type="button" className="plan-guide-open" onClick={() => hideGuide(false)}>
            How this works
          </button>
        ) : (
          <section className="plan-quick" aria-labelledby="plan-quick-head">
            {/* Named so the steps read as the manual, not three stray facts
                (Geno, 2026-10-06: "a little header... follow the steps"). */}
            <div className="plan-quick-top">
              <h2 className="plan-quick-head" id="plan-quick-head">How to use this</h2>
              <button type="button" className="plan-quick-done" onClick={() => hideGuide(true)}>
                Got it
              </button>
            </div>
            <ol>
              {QUICK_STEPS.map((step, index) => (
                <li key={step.title}>
                  <span className="plan-quick-no" aria-hidden>{index + 1}</span>
                  <b>{step.title}</b>
                  <span>{step.text}</span>
                </li>
              ))}
            </ol>
            {/* Said once here instead of as Keep / Change on every card. */}
            <p className="plan-quick-note">
              Copy the idea, not the video — your outfit, place and people can all be different.
              You film and edit these yourself; want us to edit one? Tap &ldquo;Ask about this one&rdquo; on that card.
            </p>
          </section>
        )}

        {/* Two piles, her choice pinned between them: what still wants a yes
            or no, and the list she is actually filming. One long mixed feed
            made her scroll everything to find anything (Geno, 2026-10-06). */}
        {ideas.length > 0 && (
          <nav className="plan-piles" aria-label="Your week in two piles">
            <button
              type="button"
              className="plan-pile"
              data-on={view === 'review' || undefined}
              aria-pressed={view === 'review'}
              onClick={() => setView('review')}
            >
              To review{review.length > 0 && <b>{review.length}</b>}
            </button>
            <button
              type="button"
              className="plan-pile"
              data-on={view === 'mine' || undefined}
              aria-pressed={view === 'mine'}
              onClick={() => setView('mine')}
            >
              My reels{mine.length > 0 && <b>{mine.length}</b>}
            </button>
          </nav>
        )}

        {ideas.length === 0 ? (
          <div className="plan-empty">
            <b>Nothing on this week yet</b>
            <span>Your videos land here as soon as they are added. Keep this link — it stays the same.</span>
          </div>
        ) : visible.length === 0 ? (
          view === 'review' ? (
            <div className="plan-empty">
              <b>All answered</b>
              <span>Every idea has a yes or no. Your yeses are on My reels.</span>
            </div>
          ) : (
            <div className="plan-empty">
              <b>Nothing here yet</b>
              <span>Tap &ldquo;I&rsquo;ll do this&rdquo; on the ideas you like and they land here.</span>
            </div>
          )
        ) : setups ? (
          /* Batched by how it gets filmed: one phone setup, several videos.
             The first sitting is the quickest and says so — the fastest way
             through the week is to knock those out first. */
          setups.map((section, sectionIndex) => (
            <section className="plan-group" key={section.key} aria-label={section.label}>
              <h2 className="plan-group-bar">
                <span className="plan-group-name">
                  <span className="plan-group-no">{String(sectionIndex + 1).padStart(2, '0')}</span>
                  {section.label}
                </span>
                <span className="plan-group-count">
                  {section.items.length} video{section.items.length === 1 ? '' : 's'}
                </span>
              </h2>
              {section.note && <p className="plan-group-note">{section.note}</p>}
              <ol className="plan-items">
                {section.items.map((item) => card(item, ideas.indexOf(item) + 1))}
              </ol>
            </section>
          ))
        ) : grouped ? (
          /* Grouped by where it gets filmed, so everything shot in the car is
             shot in one trip to the car. Each group is its own list, which
             keeps the ordinal that screen readers announce honest. */
          groups.map((group, groupIndex) => (
            <section className="plan-group" key={`${group.location ?? 'anywhere'}-${groupIndex}`}>
              {group.location && (
                <h2 className="plan-group-bar">
                  <span className="plan-group-name">
                    <span className="plan-group-no">
                      {String(groups.filter((g, i) => g.location && i <= groupIndex).length)
                        .padStart(2, '0')}
                    </span>
                    {group.location}
                  </span>
                  <span className="plan-group-count">
                    {group.items.length} shot{group.items.length === 1 ? '' : 's'}
                  </span>
                </h2>
              )}
              <ol className="plan-items">
                {group.items.map((item) => card(item, ideas.indexOf(item) + 1))}
              </ol>
            </section>
          ))
        ) : (
          <ol className="plan-items">
            {visible.map((item) => card(item, ideas.indexOf(item) + 1))}
          </ol>
        )}

        {yours.length > 0 && (
          <section className="plan-yours" aria-labelledby="plan-yours-head">
            <h2 className="plan-yours-head" id="plan-yours-head">
              Your own videos <span className="plan-yours-count">{yours.length}</span>
            </h2>
            <p className="plan-yours-note">
              Reels of yours that already did well. Post one again or film a fresh take if you
              want to — they are not part of this week&rsquo;s list.
            </p>
            <details className="plan-yours-fold">
              <summary>Show them</summary>
              <ol className="plan-items">
                {yours.map((item, index) => card(item, ideas.length + index + 1))}
              </ol>
            </details>
          </section>
        )}

        <CantDoSection items={turnedDown} reasons={cantDo} onAddBack={addBack} />

        {/* Where the week ends up. Last on the page on purpose — it is the
            last thing she does, and it is the one instruction that was
            missing entirely rather than merely buried. The MARKETING line is
            stamped in the page itself (Geno, 2026-10-06: "permanently put in
            there") so no per-model note has to carry it again. */}
        <section className="plan-delivery" aria-labelledby="plan-delivery-head">
          <p className="plan-label" id="plan-delivery-head">When they are filmed</p>
          {model.delivery_note && <p className="plan-delivery-note">{model.delivery_note}</p>}
          <p className="plan-delivery-note">
            If it will not open, send them in the Telegram{' '}
            <b className="plan-channel">&ldquo;MARKETING&rdquo;</b> channel.
          </p>
          {folder && (
            <a className="plan-cta" href={folder} target="_blank" rel="noreferrer">
              Open your folder
            </a>
          )}
        </section>

        {/* Her colors, her background. Not in the preview — a tap there
            would save Geno's taste onto her pages. */}
        {!preview && <MakeItYours token={token} style={model.portal_style} photo={model.photo_url} />}
      </div>

      {setupOpen && (
        <SetupProfile
          token={token}
          name={model.name.split(' ')[0]}
          photo={model.photo_url}
          onClose={() => setSetupOpen(false)}
        />
      )}

      {notice && <CantDoNotice label={notice.label} onUndo={() => void addBack(notice.id)} />}

      {/* Same toast, other filing. The undo toast wins when both fire — an
          accidental decline costs her words, a filed yes costs nothing. */}
      {moved && !notice && (
        <div className="plan-cantdo-notice" role="status">
          <span>{moved}</span>
          <button
            type="button"
            onClick={() => {
              setView((current) => (current === 'review' ? 'mine' : 'review'))
              setMoved(null)
            }}
          >
            View
          </button>
        </div>
      )}
    </main>
  )
}
