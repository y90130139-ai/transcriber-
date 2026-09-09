# Next: the taxonomy additions Geno asked for

Written 2026-09-09. Everything below is **decided** — the review is done and the
two ambiguous items were put to Geno and answered. This is an execute-it spec,
not a discussion. It is roughly an hour of work and touches three files.

## Do this

### 1. `cloud/src/lib/taxonomy.json` — six new `persona` tags

Append to `persona.tags`, in the file's existing `{id, label, desc}` shape:

| id | label | desc |
|---|---|---|
| `male` | Male creator | `A man on the roster. Set on the creator like faceless — nothing in a transcript reliably says it.` |
| `grandmother` | Grandmother | `Grandmother-forward positioning, a step past MILF / mature.` |
| `natural` | Natural | `No body work — a regular person, funny, crazy or exotic. Deliberately loose: Geno stated there is no tighter definition, so do not invent one.` |
| `blonde` | Blonde | `Blonde-forward positioning.` |
| `switch` | Switch | `Moves between dominant and submissive — the posture domme and brat-sub do not cover.` |
| `barely-legal` | Barely legal / 18+ | `Just-turned-18 positioning.` |

### 2. `cloud/src/lib/taxonomy.json` — six new `format` tags

Append to `format.tags`:

| id | label | desc |
|---|---|---|
| `carousel` | Carousel | `A swipeable set of stills rather than a video — Instagram and Reddit.` |
| `asmr` | ASMR | `Audio-led: whisper, triggers, tapping. The persona axis carries the same word for a creator built on it; this is one video doing it.` |
| `cooking` | Cooking / cooking fail | `Hands-only cooking, and the fail version of it.` |
| `mirror` | Mirror | `Shot into a mirror — outfit and body content the mirror frames.` |
| `yap` | Yap session | `Long rambling talk with no take to argue, which is what separates it from a rant.` |
| `omegle` | Omegle / random pairing | `Random-pairing stream, or its recordings.` |

`asmr` existing on both axes is fine and intended — the tag index is keyed
`${axis}:${id}`, so the two never collide.

### 3. `cloud/src/lib/lexicon.ts` — keywords, conservatively

**Every new tag needs a key**, even an empty one: an empty array is the file's
existing convention for "human-set only" (`girl-next-door`, `talking-head`,
`skit` are all `[]` today) and it keeps the two files legible side by side.

`PERSONA_WORDS` — persona needs **two** hits to stick, so these can be slightly
looser:

```ts
grandmother: ['grandma', 'granny', 'gilf', 'grandmother', 'my grandkids', 'my grandchildren'],
'barely-legal': ['just turned 18', 'barely legal', 'freshly 18', '18 year old'],
switch: ["i'm a switch", 'im a switch', 'switchy'],
male: [],
blonde: [],
natural: [],
```

`male`, `blonde` and `natural` are deliberately empty. All three are claims
about a person that words do not reliably signal, and a wrong persona is worse
than none — `natural` especially, which has no definition to match against.
`switch` is narrow on purpose: the bare word "switch" is far too common.

`FORMAT_WORDS` — format fires on **one** hit, so these must be tight:

```ts
carousel: ['carousel', 'photo dump', 'swipe for'],
asmr: ['asmr'],
cooking: ['cooking', 'recipe', 'in the kitchen', 'preheat', 'tablespoon', 'stir in'],
mirror: ['in the mirror', 'mirror selfie', 'bathroom mirror'],
yap: ['yap', 'yapping', 'yap session', 'just rambling'],
omegle: ['omegle', 'ome tv', 'chatroulette', 'monkey app', 'next stranger'],
```

`asmr` gets the single word only. The persona axis already carries `whisper`,
`tingles` and `tapping` behind a two-hit gate; the same list on a one-hit axis
would tag every quiet video as ASMR.

### 4. Nothing else

No migration — tags are text, `models.persona/formats/hooks/wont_do` are
uncapped `text[]`, and `readModelInput` validates against `isValidTag`, so the
new tags become selectable the moment the JSON changes. `lib/intake.ts` builds
its matcher from the taxonomy too, so the intake form starts recognising them
with no extra work.

## Then verify

```bash
cd cloud && npx tsc --noEmit --pretty false && npm run build
```

Then look at it rather than reasoning about it — `docs/rollback/cdpshot.mjs`
against `next build && next start`, both themes, with the model sheet open and
a picker expanded, to confirm the new options render and the grid still fits.
Mint the cookie as `tx_session=<value>`.

## Optional, and ask first

`POST /api/retag` re-runs the autotagger across the corpus and would apply the
new format tags to existing items. It replaces `auto` tags wholesale and never
touches `human` ones, so it is safe — but it is a bulk change to the library
and Geno should say yes before it runs.

## What was reviewed and deliberately NOT added

Geno's list had more on it than this. These were already covered, and adding
them again would have split matching across duplicate tags:

- **Trans** → `trans` · **Mature / MILF** → `milf-mature` · **Goth** →
  `alt-goth` · **Faceless** → `faceless` · **Petite** → `petite`
- **Dom / sub / bratty** → `domme` and `brat-sub`. Only `switch` was missing.
  `brat-sub` conflates brat and submissive; splitting it would orphan the tags
  already applied to items, so it stays as it is.
- **Talking-head reels** → `talking-head` · **Text overlay over b-roll /
  expression videos** → `text-overlay` · **Skits** → `skit`, `pov-skit`,
  `comedy` · **Gym** → `gym` · **POV / Snapchat-style** → `pov-skit` and
  `snap-banner` · **Outfit content** → `fit-check` · **Croppable dance
  trends** → `dance`
- **Car GRWM** and **road-trip skits** are `grwm` and `skit` shot somewhere.
  Where a thing is filmed is already a field — `plan_items.location`, drafted
  by `draftLocation` in `brief.ts` — and duplicating it as a format would mean
  a car GRWM no longer matching a kitchen GRWM.

Two questions were put to Geno on 2026-09-09 and answered:

- **"18+"** means the just-turned-18 positioning → `barely-legal` above. It is
  not a boundary field and not IG age-gating.
- **"Gothic cougar MILF"** is **not** getting its own tag. It is `alt-goth` +
  `milf-mature`, both of which exist and are multi-select. A compound tag only
  matches videos carrying that exact compound — which the autotagger will never
  produce — so it would quietly narrow her recommendations rather than sharpen
  them.
