# Red October — board generator

Rebuilds the roster board at https://claude.ai/artifact/51rXbEwtbfSAPDEHPDRATj
from the Infloww mirror and the funnel scan.

This exists because the first version of it was written in a scratchpad and
lost when the scratchpad was cleared, which cost a full rebuild — including
re-deriving the board's own definitions from its stored data. Keep it here.

## Run it

    cd ~/gosian-bot            # sync the Infloww mirror first (see the skill)
    bin/funnel scan            # in ~/projects/social-transcriber, the IG half
    tools/red-october/run.sh 2026-10-27    # last SETTLED day, never today

`run.sh` is the whole job in the only order that works, because `ig_merge.py`
writes the live link alerts back into `D-new.json`:

| step | what it does |
|---|---|
| `build.py` | every money field, from `~/gosian-bot/state/revenue/*.json` |
| `ig_merge.py` | attaches the live reading to each IG row, raises `link` alerts |
| `asks.py` | the contact list, grouped one ask per creator |
| `patch.py` | writes it all into the page → `red-october.html` |

Then publish `red-october.html` to the URL above with the Artifact tool, and
copy it over `board-source.html` so the next run starts from it.

## The definitions, confirmed against the board's own stored data

These were recovered by reconciling against the Oct 26 board field by field.
October net matched to the cent, and so did `gap`, `need`, `pace`, `best`, the
alarm bands and every `O`/`S` figure. Do not change them on a hunch:

- **Money is cents everywhere.** `fm()` in the page divides by 100; nothing
  else should.
- **`red` is the Oct 31 outlook**, not today's standing — projected to finish
  below her own September. `behind` is the same-days comparison, and only
  decides whether an on-course creator reads `hold` instead of `safe`.
- **`gap` is September minus October so far** — what she still has to earn.
  Negative means she is ahead.
- **`left` is days left in the month.** The bar renders it as "Days left".
- **`A.wk` is the same three weekdays a week earlier**, not the last seven
  days. The alarm divides `last3` by it, so a 7-day total reads as a 60%
  collapse every morning.
- **`buyers` is PPV buyers** — distinct fans on `Messages` rows — at creator
  level, but every fan at agency level. Both match the board.
- **`ntips` counts tippers, not tips.**
- **Idle spenders** are judged across the whole month, not the settled days:
  a fan who bought yesterday has not gone quiet.
- Rounding is `round()`, not truncation.

## What is recomputed and what is carried over

Recomputed every run: all money, the live Instagram reading, the ask list,
the `link` alerts.

Carried over from the previous page, because this script cannot see those
sources: `TR` (Autoposter posting counts, trial/tracking links, driver,
bucket, owner), `acts` (the chatter briefs), and the `ig` block. A creator who
is new to the board gets empty versions — the page reads `c.TR.WK` unguarded
and would otherwise die.

## Repairs this script applies to the page

The page had several faults that predate this tool. The patches are
idempotent, so they re-apply cleanly to a page that already carries them:

- **Money printed 100× too large.** `fm()` never divided by 100 while almost
  every caller passed cents, so the bar read `$720,068/day` for a roster
  taking about $7,200. Three call sites had been dividing by hand.
- **A stylesheet that was never opened.** ~120 lines of CSS sat outside any
  `<style>` tag: visible as a wall of text, and styling nothing.
- **`.strip` had no rules at all**, so the five-figure strip under the
  headline ran together on one line.
- **Both tables waited on the database to paint.** `renderIG()` was only ever
  called from the `igreview` snapshot callback, so the Instagram list rendered
  as bare headers whenever that capability was slow or absent.
- Overdue gameplan dates now say how late they are.

## Gotchas

- `patch.py` starts from `board-source.html`. If the board was edited
  elsewhere, read it with the Artifact tool and point `RO_SOURCE` at the file
  that read saved.
- Check the JavaScript before publishing. `run.sh` does, and `probe.py` loads
  the page headless and reports render counts plus any page error — a
  `ReferenceError` in there renders everything below the header blank, and it
  is invisible from the published page because the artifact iframe is
  cross-origin.
- `retry.py` re-reads the handful of accounts a DNS failure drops from a scan.
  The scan is right to drop them; a dropped account must never read as dark.
