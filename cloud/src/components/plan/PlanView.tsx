'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import PlanItemCard from './PlanItemCard'
import RunSheet from './RunSheet'
import ThemeToggle from './ThemeToggle'
import { useReveal } from '@/hooks/useReveal'
import { BACKGROUND_RULE } from '@/lib/brief'
import { CAROUSEL_PLAN, STORY_PROMPTS } from '@/lib/card'
import { filmingDaysLabel, formatDate, isOverdue } from '@/lib/dates'
import type { Plan, PlanItem, PlanModel } from '@/lib/plans'

/** The standing instructions, in the order she does them. Five beats, no more —
 *  anything longer stops being read after the first week. */
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

/** The standing instructions, in the order she does them. Five beats were
 *  never six because nothing on this page had ever said where the footage
 *  goes — the plan ended at "tick it off as filmed" and left the last step of
 *  the week to a conversation that had to happen somewhere else. */
const STEPS = [
  'Watch the example. Once through, no notes.',
  'Read the directions under it. That is the whole brief.',
  'Make it yours — copy the structure, not the person.',
  'Get the sound from Instagram, off the original post.',
  'Tick it off as filmed. If something will not work, say so in the box.',
]

/** The three things she does, pinned open at the top (2026-09-27): three
 *  creators needed the flow explained in chat because the full list above sat
 *  folded away. She edits her own videos; that is said once, here. */
const QUICK_STEPS = [
  { title: 'Watch', text: 'Watch each video on your plan.' },
  { title: 'Yes or no', text: 'Tap “I’ll do this” or “Can’t do this” on every card.' },
  { title: 'Film', text: 'Film and edit your yeses — easiest first. Name each file by its number (V-1, V-2…).' },
]

/** The sixth beat, and only when there is somewhere to name. A model with no
 *  folder and no note gets the five she has always had rather than an
 *  instruction pointing at nothing. */
function deliveryStep(hasFolder: boolean): string {
  return hasFolder
    ? 'Send the finished videos to your folder — the link is at the bottom.'
    : 'Send the finished videos where it says at the bottom of this page.'
}

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
  /** Her week's header rides along as she scrolls, condensed once it has left
   *  its own space, and tucked away entirely if she wants the screen back. */
  const [stuck, setStuck] = useState(false)
  const [tucked, setTucked] = useState(false)
  const topMark = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = topMark.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    // A sentinel above the header rather than a scroll listener: it fires
    // twice per screen instead of on every pixel, which is what keeps this
    // from costing her a frame on an old phone.
    const watch = new IntersectionObserver(
      ([entry]) => {
        setStuck(!entry.isIntersecting)
        // Back at the top, the header comes back by itself. Tucking it is her
        // saying "not while I am reading the cards", not "never again", and
        // making her find the pill to undo it at the top of her own week is
        // the kind of small toll that turns into a habit of not tucking it.
        if (entry.isIntersecting) setTucked(false)
      },
      { threshold: 0 },
    )
    watch.observe(sentinel)
    return () => watch.disconnect()
  }, [])

  // Either half is enough to have something to say. Neither, and every
  // delivery render on this page is skipped rather than drawn empty.
  const folder = model.drive_url
  const hasDelivery = Boolean(folder || model.delivery_note)
  const steps = hasDelivery ? [...STEPS, deliveryStep(Boolean(folder))] : STEPS

  const overdue = useMemo(() => isOverdue(plan.due_date, model.timezone), [plan.due_date, model.timezone])
  // Her own reels are not this week's ideas (Susanna, 2026-09-27: "they look
  // like assignments"). They sit in their own section at the end and are not
  // counted in what is left to film.
  const ideas = useMemo(() => items.filter((item) => !item.mine), [items])
  const yours = useMemo(() => items.filter((item) => item.mine), [items])
  const done = ideas.filter((item) => filmed.has(item.id)).length
  const total = ideas.length

  // Grouping only turns on once somewhere has actually been named. A week with
  // no locations set renders exactly the flat list it always has.
  const groups = useMemo(() => groupByLocation(ideas), [ideas])
  const grouped = groups.some((group) => group.location)

  // Cards arrive as she scrolls to them. The ref goes on the body rather than
  // on each list, so a grouped week staggers across its groups in reading
  // order instead of restarting the count at every location bar.
  const body = useReveal<HTMLDivElement>([items.length, grouped])

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
      {/* What says the header has left its own space. Zero height, no paint. */}
      <div ref={topMark} className="plan-mark" aria-hidden="true" />

      {/* The week is the headline, not her name — she knows who she is, and
          what she opens this to find out is which week she is looking at. */}
      <header className="plan-head" data-stuck={stuck || undefined} data-tucked={tucked || undefined}>
        <div className="plan-who">
          {model.photo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className="plan-face" src={model.photo_url} alt="" width={104} height={104} />
          )}
          <p className="plan-eyebrow">
            Your content plan
            <b className="plan-name">{model.name}</b>
          </p>

          {/* Two controls, one size, top right: what she is looking at, and
              how it looks. The run glows because nothing else on this page
              has ever been worth tapping out of curiosity — it is the only
              thing here that gives her something back. */}
          <div className="plan-tools">
            <button
              type="button"
              className="plan-run"
              onClick={() => setRunOpen(true)}
              aria-haspopup="dialog"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                   strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3c0 4-4 5-4 9a4 4 0 0 0 8 0c0-2-1-3-1-3s3 2 3 6a8 8 0 0 1-8 8 8 8 0 0 1-8-8c0-7 10-8 10-12z" />
              </svg>
              Your run
            </button>
            <ThemeToggle />
            {/* Only worth offering once it is actually in her way. */}
            {stuck && (
              <button
                type="button"
                className="plan-tuck"
                onClick={() => setTucked(true)}
                aria-label="Tuck this out of the way"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 15l6-6 6 6" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <h1 className="plan-week">Week of {formatDate(plan.week_of)}</h1>

        {plan.title && <p className="plan-title">{plan.title}</p>}

        {/* One segment per video rather than one filling rule. A continuous
            bar only ever says "some of it"; a countable strip lets her see
            how many are left without doing the arithmetic. */}
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

        {/* One mono line rather than a three-column table. The table wrapped
            into itself on a narrow phone and read as one run-on figure. */}
        <p className="plan-facts">
          <span className="plan-count"><b>{done}</b>/{total} filmed</span>
          <span className="plan-sep" aria-hidden="true">·</span>
          <span data-late={overdue || undefined}>
            Due {formatDate(plan.due_date)}{overdue && ' · overdue'}
          </span>
          <span className="plan-sep" aria-hidden="true">·</span>
          <span>Filming {filmingDaysLabel(model.filming_days)}</span>
        </p>
      </header>

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
        {plan.intro && <p className="plan-intro">{plan.intro}</p>}

        {/* Her own rules first, because they are hers and they override. The
            house background rule sits under them: it applies to every card,
            so it belongs here once rather than repeated twenty-one times. */}
        <section className="plan-rules" aria-label="What applies to everything">
          <p className="plan-label">Always</p>
          {model.standing_rules && <p>{model.standing_rules}</p>}
          <p>{BACKGROUND_RULE}</p>
        </section>

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

        <section className="plan-quick" aria-label="What to do">
          <ol>
            {QUICK_STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="plan-quick-no" aria-hidden>{index + 1}</span>
                <b>{step.title}</b>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
          <p className="plan-quick-note">
            You film and edit these yourself. Want us to edit one? Tap &ldquo;Ask about this one&rdquo; on that card and say so.
          </p>
        </section>

        <details className="plan-how">
          <summary>How your plan works</summary>
          <ol>
            {steps.map((step, index) => (
              <li key={step}>
                <span className="plan-step-no">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </details>

        {ideas.length === 0 ? (
          <p className="plan-empty">Nothing on this week yet. Keep this link — it stays the same.</p>
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
                {group.items.map((item) => (
                  <PlanItemCard
                    key={item.id}
                    token={token}
                    item={item}
                    number={ideas.indexOf(item) + 1}
                    filmed={filmed.has(item.id)}
                    folder={folder}
                    preview={preview}
                inGroup={Boolean(model.in_group)}
                    onFilmed={(next) => mark(item.id, next)}
                  />
                ))}
              </ol>
            </section>
          ))
        ) : (
          <ol className="plan-items">
            {ideas.map((item, index) => (
              <PlanItemCard
                key={item.id}
                token={token}
                item={item}
                number={index + 1}
                filmed={filmed.has(item.id)}
                folder={folder}
                preview={preview}
                inGroup={Boolean(model.in_group)}
                onFilmed={(next) => mark(item.id, next)}
              />
            ))}
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
                {yours.map((item, index) => (
                  <PlanItemCard
                    key={item.id}
                    token={token}
                    item={item}
                    number={ideas.length + index + 1}
                    filmed={filmed.has(item.id)}
                    folder={folder}
                    preview={preview}
                    inGroup={Boolean(model.in_group)}
                    onFilmed={(next) => mark(item.id, next)}
                  />
                ))}
              </ol>
            </details>
          </section>
        )}

        {/* Where the week ends up. Last on the page on purpose — it is the
            last thing she does, and it is the one instruction that was
            missing entirely rather than merely buried. */}
        {hasDelivery && (
          <section className="plan-delivery" aria-labelledby="plan-delivery-head">
            <p className="plan-label" id="plan-delivery-head">When they are filmed</p>
            {model.delivery_note && <p className="plan-delivery-note">{model.delivery_note}</p>}
            {folder && (
              <a className="plan-cta" href={folder} target="_blank" rel="noreferrer">
                Open your folder
              </a>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
