# The model profile, and the panel scroll bug

Built 2026-09-14. Two asks from Geno, one of which turned out to be the cause of
the other.

> "I would like to do content reviews and profile reviews at the touch of a
> button, so I don't have to constantly search them up… we have a button with
> all of their profiles… maybe their profile becomes a pop-up rather than a side
> panel… we put the profile picture, and that's a whole setup with all of their
> information… their socials… followers per page, live tracking, maybe have
> their top videos."

And: *"certain things I'm not able to scroll through because you have the 'How
to do it' or whatever that's up top, and it won't let me scroll past to see
what's underneath."*

---

## 1. The scroll bug was real, and it was two bugs

Asked which panel, Geno said all of them. That was the clue — they share one
shell, `.reader` in `globals.css`.

**The shell.** `.reader` was a flex column with a fixed head and `.reader-body`
as the only scroller. The black head is the biggest thing on a phone screen and
the most natural place to put a thumb, and dragging it did nothing: the gesture
found no scroller under it, chained out to the page behind, and scrolled that.
The panel sat still while the background moved — which reads exactly as *it will
not let me scroll past the thing at the top*.

Fixed by making **the panel itself the scroller**. The head is now a child of a
scrollable box, so a drag anywhere moves the panel. `overscroll-behavior:
contain` stops the gesture leaking to the page at the ends of the scroll.
`height: 100dvh` replaces `bottom: 0`, because on iOS a fixed element is laid
out against the *large* viewport and the last ~90px of every panel was sitting
behind Safari's toolbar.

`.reader-close` went `position: fixed`. The head scrolls away now, and a close
button that goes with it leaves a phone with no way out — there is no Escape key
there, and at that width the panel covers the scrim that would otherwise dismiss
it. Fixed rather than sticky because a sticky child cannot outlive the box it is
written in.

**The literal "How to do it".** `ItemView` rendered its
`<section className="scaffold">` — headed **"How to rebuild this"** — *between*
`.reader-head` and `.reader-body`, not inside the body. Under the old CSS that
made it a fixed slab under the header that could not be scrolled past, squeezing
the transcript into whatever was left. On a phone that was almost nothing. It is
now the first child of `.reader-body`.

**The rule that hid the fix.** `.console .reader { overflow: hidden }` — added to
clip a rounded corner — is more specific than `.reader`, so it silently beat
`overflow-y: auto` and the panel still would not scroll. It now clips the axis
that needs clipping and leaves the one that has to scroll.

> Anything added to these panels from here: **one scroll region, and the panel
> is it.** A second `overflow` anywhere inside brings the bug back.

## 2. `ModelSheet` → `ModelProfile`

The old right-edge panel was twenty labelled fields. It held everything and said
nothing — you could not look at it and know who she was. Replaced by a centred
modal (a bottom sheet under 720px) laid out the way a profile is laid out
anywhere: ink cover with her name at display size, face overlapping it, **every
account of hers as a button**, a figures strip, then the editing behind four
tabs — Profile / Tags / Week / Link.

Files, all new under `src/components/roster/`:

| File | Holds |
|---|---|
| `ModelProfile.tsx` | the shell: form state, fetches, save, tabs |
| `profile/form.ts` | `ProfileForm`, `BLANK`, `fromModel` |
| `profile/ProfileHead.tsx` | cover, face, name, the account buttons |
| `profile/ProfileFigures.tsx` | the stats strip |
| `profile/ProfileTab.tsx` | identity, accounts, followers, best posts, intake |
| `profile/SocialEditor.tsx` | the account rows |
| `profile/FollowerLog.tsx` | record a reading, see the history |
| `profile/TopPosts.tsx` | her own best posts |
| `profile/TagsTab.tsx` · `WeekTab.tsx` · `AccessTab.tsx` | the rest, unchanged in substance |
| `profile/reach.ts` | readings → now / was / delta / spark |

`ModelSheet.tsx` is deleted; `git show HEAD~1` has it.

**The topbar's height is stated (`--sheet-topbar-h`).** The tabs pin underneath
it and there is no CSS way to ask how tall a sticky sibling ended up. It holds
one button, so the height is knowable rather than guessed. Change one, change
the other.

## 3. Her accounts — `src/lib/socials.ts`

`transcriber.models.socials` is `jsonb`, `[{platform, handle, url}]`. Read whole,
written whole, never queried across models — which is why it is a column and not
a table.

- **One box takes either shape.** Paste a link and the platform is read off the
  host; type a bare handle and the URL is built from the platform beside it.
  Both arrive in practice — a link from a share sheet, a handle from her intake
  form — and asking which one you have is the friction that leaves the field
  empty.
- **A pasted URL always beats the chosen platform.** A TikTok link in a row
  marked Instagram means the row was marked wrong.
- **Where a handle is recovered, the canonical profile URL is stored**, not the
  pasted one. Links arrive carrying `?hl=en`, `?utm_source=…`, a fragment, a
  trailing `/reels/` — none of which change where the button goes, all of which
  make one account look like two. This is what makes the duplicate check mean
  anything; dedupe is keyed on `platform:handle`, falling back to the URL.
- **A link no handle can be read from is kept exactly as pasted** — an
  `instagram.com/reel/…` is a post, not somebody called "reel". It still opens
  something real, so it is not dropped; it just renders labelled by host.
- **Anything that will not parse is dropped on save**, the same contract the
  Drive URL has. `javascript:` never reaches the database. On a phone a dead tap
  target is indistinguishable from a live one until it has cost a tap.
- **`withImpliedInstagram`** renders `models.handle` as an Instagram button when
  the list has none, so a roster nobody has touched since this landed still
  shows one working button. Display only — nothing is backfilled.
- **No brand colours.** Buttons are told apart by a two-letter mono label. A row
  of platform logos would put blue back on the page, which the house identity
  rules out outright.

The same buttons render on the roster card (capped at five), so the common case
— open her Instagram, look at what she posted — never needs the sheet at all.

## 4. Followers, and why they are typed in

`transcriber.model_followers` — one row per reading, per platform, stamped
`manual` or `insights`.

A single `followers` column would answer *how big is she* and nothing else. The
question worth asking is whether the weeks we plan are moving her, and that
needs two readings with a date between them. So every entry is an insert, a
correction is a second insert, and a typo is deleted rather than edited.

Instagram will not hand over numbers until the Meta app clears App Review, which
**is still unsubmitted**. That is not a reason to ship a placeholder: a figure
read off a phone on a Monday is a real reading. `128.4k`, `1.2m`, `1,284` and
`1284` are all accepted, because retyping a number you can already see is
exactly the friction that stops it being recorded at all. When Insights lands it
writes into this table with `source = 'insights'` and no component changes.

Recorded immediately rather than with the rest of the sheet — it is an
observation with a timestamp, not an edit to her profile, and holding it until
somebody presses Save would stamp it with the wrong day.

Bars are scaled to the range, not to zero: 128.0k → 128.4k on a zero floor is
six identical bars, which says *nothing is happening* about a week that added
four hundred people.

## 5. Her best posts need no API at all

`/api/models/[id]/posts` already existed for the plan editor's tap-to-link
strip: library rows whose `transcripts.author` is her handle, ingested
metadata-only — which brings like and comment counts with them. So *what worked
for her* is answerable today.

Ranked on `likes + 10 × comments`, which is `hot.ts`'s score and therefore the
same yardstick the library ranks researched creators by. Two scales for "good"
is how you end up briefing her against one and judging her by the other.

**This makes her handle load-bearing.** Get it wrong and the section empties
without saying why, which is why the field now carries a line saying so.

## Verified

Chrome headless over CDP, signed in with a minted `tx_session`, at 320 / 390 /
768 / 1024 / 1440:

- The panel scrolls, `overscroll-behavior: contain`, **no nested scrollers**.
- The scaffold's parent is `.reader-body`; scrolling 600px moves it with the
  head. The bug is gone.
- Topbar and tabs pin flush (`tabsTop === topbarBottom`), save bar pins bottom.
- No horizontal overflow inside the sheet at any width.
- Parser round-tripped through the live API: three spellings of one Instagram
  profile collapse to one row, `?utm_source` is stripped, `/reel/` and
  `watch?v=` are kept raw, `javascript:` is dropped, an unknown host keeps its
  own URL.
- A bad follower count 400s; a good one round-trips and deletes.

The probe model used for all of this was deleted; the roster is back to 21.

**Her page (`/p/[token]`) is untouched** — it uses none of `.reader`,
`.copybar` or `.sheet-*`. `globals.css` loads there, so that was checked rather
than assumed.

## Not built

- **Live follower tracking.** Blocked on App Review, which is blocked on Geno
  submitting the Meta app. The table and the strip are the shape it lands into.
- **Views, saves, watch time.** Same gate.
- Her own posts are only in the library if somebody added them — automated
  discovery is the open question in `docs/NEXT-INGEST.md`.
