'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'

/** Steps of stagger before the delay stops growing. A week can be twenty-six
 *  cards; making the last one wait its turn would mean a second and a half of
 *  nothing, which is not an entrance, it is a page that has not loaded. */
const STAGGER_CAP = 6
const STAGGER_MS = 55

/** Headroom on top of the measured document height, so the root still covers
 *  everything above the viewport if the page grows after this ran — a late
 *  image settling, a video getting its real height. */
const MARGIN_SLACK_PX = 10_000

/**
 * The observer's root box: grown upward past the top of the document, pulled
 * in at the bottom.
 *
 * The bottom `-8%` is the ordinary part — an item has to be properly on
 * screen, not just grazing the edge, before it counts as arrived.
 *
 * **The top margin is a bug fix and the size of it matters.** An
 * IntersectionObserver only reports what is intersecting *now*, and a jump
 * from below the viewport to above it is ratio 0 → ratio 0, which is not a
 * change, so no callback ever fires. An item skipped past — a flung scroll, a
 * jump to the bottom, an anchor link, a reload restoring scroll position —
 * would sit at `opacity: 0` for the life of the page.
 *
 * Growing the root upward makes everything above the viewport permanently
 * intersecting, so being scrolled past *is* the thing that reveals it.
 *
 * It has to clear the whole document. Measured on a real 26-card week: a flat
 * 9999px left four cards stranded, because at ~1,400px per card they sat
 * 15,000px up. Hence the document's own height rather than a guess.
 */
function observeMargin(root: HTMLElement): string {
  const doc = root.ownerDocument.documentElement
  const above = Math.ceil(doc.scrollHeight) + MARGIN_SLACK_PX
  return `${above}px 0px -8% 0px`
}

/**
 * useLayoutEffect warns when React renders on the server, and every component
 * using this hook is a client component that still server-renders. Same
 * behaviour, no console noise.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Reveal children as they are scrolled to.
 *
 * Returns a ref for the container. Any descendant carrying a `data-reveal`
 * attribute is picked up — items render it empty, and this hook is the only
 * thing that ever writes `out` or `in` into it.
 *
 * THE SAFETY PROPERTY, which is the whole reason it is shaped this way:
 * **nothing is hidden by CSS alone.** `[data-reveal='out']` is the only rule
 * that sets opacity 0, and this hook writes that value only after it has
 * confirmed IntersectionObserver exists and reduced motion is off. If the
 * script fails to load, throws, or is turned off, every card renders visible —
 * which is what it does today. A reveal that can strand a creator's plan
 * behind opacity 0 is a worse failure than no reveal at all.
 *
 * The write happens in a layout effect, before the browser paints, so an item
 * that is about to be hidden is never seen in its visible state first.
 */
export function useReveal<T extends HTMLElement>(
  /** Re-run when the set of children changes — a week gaining an item, a
   *  filter narrowing the list. Passed straight through to the effect. */
  deps: readonly unknown[] = [],
) {
  const ref = useRef<T>(null)

  useIsomorphicLayoutEffect(() => {
    const root = ref.current
    if (!root) return

    // Both of these are reasons to leave every item exactly as rendered.
    if (typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (items.length === 0) return

    const fold = window.innerHeight
    let entering = 0

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          // A short stagger for a run arriving together, reset each batch so
          // scrolling back down does not inherit the last batch's delay.
          el.style.setProperty('--reveal-delay', `${Math.min(entering++, 3) * STAGGER_MS}ms`)
          el.dataset.reveal = 'in'
          observer.unobserve(el)
        }
        entering = 0
      },
      { rootMargin: observeMargin(root), threshold: 0.05 },
    )

    items.forEach((el, index) => {
      // Already arrived on an earlier pass. A re-run — a poll that brought
      // one new row, a filter that kept this card — must not send it back to
      // hidden and make it fade in a second time (2026-10-13).
      if (el.dataset.reveal === 'in') return
      const top = el.getBoundingClientRect().top
      if (top < fold) {
        // Already on screen when the page opened. It animates in place, in
        // order, rather than waiting for a scroll that may never come.
        el.style.setProperty('--reveal-delay', `${Math.min(index, STAGGER_CAP) * STAGGER_MS}ms`)
        el.dataset.reveal = 'in'
        return
      }
      el.dataset.reveal = 'out'
      observer.observe(el)
    })

    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}
