# The intake form, and what reads it

Written 2026-09-08, Part VI item 1 of `GAME-PLAN.md`.

Onboarding a model used to end with somebody re-typing her answers into the
sheet. Her answers are *already* in the three axes the library tags videos with
— she says she does GRWMs and storytimes and will not touch the gym, and those
are `format` tags and `wont_do` tags verbatim. So the sheet now reads the form.

## Where it lives

`Roster → open a model → Her intake form`. Drop the file in, or paste the
answers. The file goes browser-direct to Blob on the same path phone uploads
and her photo take, and is kept: it is the record of what she submitted, and a
mapping can be re-run against it later when the rules get better.

Text files, CSV, Markdown and JSON are read. A **PDF or a Word file is stored
but not read** — it says so, and you paste the text. Carrying a PDF parser into
a serverless function for a document that gets read once is not a trade worth
making.

## What it does with the answers

Rule-based, in `cloud/src/lib/intake.ts`. No model, no API key, same discipline
as `autotag.ts`: it proposes, a human confirms, and it maps to **nothing**
rather than guessing.

Two strengths of evidence, and they look different on screen:

| | What it is | On screen |
|---|---|---|
| **Named** | The answer contains a taxonomy label or id outright — she ticked "GRWM" on our own form | Filled, and ticked already |
| **Inferred** | The same keyword lexicon the autotagger uses — "getting ready in the morning" → `grwm` | Dashed ember, **unticked** |

Persona needs two keyword hits before it is inferred at all, for the reason
`autotag.ts` states: persona is a claim about a person and one stray word must
not carry it.

Everything it could not place is listed under *"n answers it made nothing of"*.
That list is the point. A profile that looks filled in and is quietly wrong is
the failure mode worth engineering against — a wrong `formats` array is
invisible and steers every recommendation `match.ts` makes for her.

**Nothing is saved by reading a form.** Applying fills the sheet above; the
profile is written by the same Save a hand edit uses.

## The form to send her

Any shape works — the parser handles `Question: answer`, `Question? answer`, a
question with its answer on the next line, a Google Forms CSV export, and a
flat JSON object. It falls back to reading an unstructured page of prose, and
everything it finds that way is inference and arrives unticked.

This is the version that maps cleanest, because the multiple-choice answers are
the taxonomy's own labels:

```text
What do you go by?
Instagram handle?
Is your Instagram a Professional (Business or Creator) account?
Where do you live? (city and state)
What days can you film?
How many videos a week can you shoot?

What content do you make?
  Thirst trap · GRWM · Storytime · Q&A · Day in the life · Fit check ·
  Try-on haul · Gym / workout · POV / roleplay skit · Comedy skit ·
  Reaction / duet · Lip sync / trend · Behind the scenes · Promo / CTA ·
  Advice / tutorial · Rant / opinion · Collab / feature · Teaser ·
  Talking head · Skit · Text overlay · Street interview · Rage bait ·
  Snapchat banner · Dance

What will you not do?
  (the same list — anything here is excluded outright, never just ranked lower)

How would you describe your niche?
  Girl next door · Latina · Alt / goth · E-girl · Fitness · Cosplay / gaming ·
  MILF / mature · Pregnant · Postpartum · Petite · Curvy / BBW · Big boobs ·
  Big booty · Bimbo / hyperfeminine · Tomboy · Domme / femdom ·
  Brat / submissive · Findom · Girlfriend experience · Toxic girlfriend ·
  Amateur / homemade · Luxury / glam · Soft / cottagecore · Inked / pierced ·
  Sports / cheer · Uniform / roleplay · Feet · ASMR · Couples · Trans · Faceless

Anything we should always know? (goes on every plan she ever gets)
Your Drive folder link?
```

## Why the Instagram question is on there

Because it is the single highest-leverage field in the whole plan, and it costs
nothing to ask.

Views, saves, watch time and follows-from-post are all readable through the
Insights API — but **only for a professional (Business or Creator) account that
has authorised our app**. Everything the measurement half of `GAME-PLAN.md`
needs turns on that one fact per model, and nothing in the data can derive it.

It is answerable *today*, months before the Meta app clears App Review.
`models.ig_account_type` holds `unknown` / `personal` / `professional`, and
`unknown` is a real answer that stays the default: nobody has looked is not the
same as no. Knowing which of the roster is still on a personal account turns
the day the app is approved into an afternoon of connecting them, instead of an
afternoon of asking.

The token and the IG user id land with that app. This column is the
prerequisite, not the connection.
