# Funnel watch

Whether each model's traffic has somewhere to land, read once a day.

Three surfaces can carry a funnel link and only one has to work: **the bio, a
highlight, a live story**. A model with none of the three is posting into a
dead end. On 2026-10-27 that was 52 of 60 accounts and 95% of the roster's
4.7M followers — the whole of October's acquisition collapse in one line.

Two people cannot hold sixty profiles in their heads, which is why the gaps
only surfaced after revenue had fallen for six weeks. This makes it a daily
reading instead of a memory test.

## What runs

Nothing new talks to Instagram. The daily pass (`bin/scout daily`) already
loads every profile header to catch stories before they expire; the funnel
reading takes three more fields out of **the same response** and costs no
extra request, no extra pacing, no extra risk to the burner.

```
bin/scout daily     # reads + writes out/funnel/YYYY-MM-DD.json, prints the digest
bin/funnel report   # the morning digest, with what changed since the last reading
bin/funnel dark     # every account with no proven funnel, biggest audience first
bin/funnel links    # probe each live funnel for a dead destination
```

## How an account is judged

| State | Meaning |
|---|---|
| `green` | A known selling link is in the bio. Proven. |
| `amber` | Something *might* carry a link — an unrecognised domain, a highlight, a live story. Unproven. |
| `red` | No bio link, no highlight, no story. Dark. |
| `unknown` | The bio field was not in the payload. **Not the same as empty.** |

`amber` is a queue, not a pass mark.

### The Threads trap

Instagram adds a Threads link to the profile header **by itself** for anyone
with a Threads account. It looks exactly like a bio link in the markup and it
is not one — the model placed nothing and a fan clicking it lands on Threads.
Eleven of the sixty accounts read on 2026-10-27 were "linked" this way and
every one was dark. A badge whose handle matches the account is never a
placement. That single rule is the difference between this being useful and
it being a liar.

### Unrecognised domains

An unknown host is often the model's own landing page and just as often
something else: one 348K bio held a press article about a jeweller. So an
unrecognised host reads `amber` and asks for one human look. Confirm it once
in `out/funnel/confirmed.json` (a plain list of hostnames) and it is `green`
from then on.

## The morning message

`bin/funnel-daily` is the whole job and the scheduler calls only that: scan,
then send. **If the scan fails nothing is sent** - a cheerful "0 dark" built
from yesterday's file is worse than silence.

It goes to **Geno's DM and nowhere else** (his call, 2026-10-27: the creator
groups already carry a brief, a story reminder and an invoice chase, and the
staff group carries nine lanes). `src/funnel_alerts.py` reads the chat id from
`funnel_chat_id`, then `FUNNEL_CHAT_ID`, then `OWNER_CHAT_ID`, and **refuses a
negative id outright** - Telegram's shape for a group - because `alerts.json`
already holds a `telegram_chat_id` pointing at the ops group and falling back
to it would be an easy, very loud mistake.

Nothing sends without `--send`:

```
bin/funnel-alerts                    # print the exact message, send nothing
bin/funnel-alerts --send             # deliver it
bin/funnel-alerts --snooze <handle>  # stop naming her for 7 days
```

The message opens with **what changed overnight**, not with the standing list.
A digest that leads with the same sixty names every morning is muted by Friday.

### The buttons, and the one that is missing

`👍 Got it` and `📨 Ask @her` are answered by **gosian-bot on Railway**, because
Telegram allows exactly one `getUpdates` consumer per token and that service is
it. Sent from here, answered there: no web server, no shared disk. An ask goes
to her MARKETING topic, once, and only on a tap - see `src/funnel-actions.js`
in that repo for the guards.

**There is no snooze button**, and the reason is the same split: a tap recorded
on Railway could never reach the message composed here. `--snooze` writes the
file this side actually reads.

Only an account that **lost a link overnight** gets an ask button. A model dark
for a month does not need a nudge, she needs a decision, and a button makes
that too easy to skip.

## The deep pass - what is inside a highlight

`bin/funnel-deep` walks the amber queue, worst first, opens each account's
highlights and OCRs the frames with the repo's own Vision binary. Nothing
leaves the Mac.

It is **weekly and short**, for two measured reasons (2026-10-27):

- **It costs a view.** Instagram gates stories and highlights behind
  *"<account> will be able to see that you viewed their story"*. Sixty of those
  a day is strange behaviour from an account that follows nobody.
- **It cannot be scripted.** Inside the viewer there are no anchors, no link
  text and no media elements the DOM admits to - a link sticker is painted into
  the frame. Verified by reading one: the DOM returned nothing while the
  screenshot plainly said *"my link is on the next slide"*.

OCR on a photograph is noisy, so `links_in` believes a token **only** when its
host is one we already know sells, or when `confirmed.json` vouches for it.
Believing OCR is how a dark account gets marked green.

## The page

`/funnel` in the console. The digest tells you *that* something changed; the
page is where you go to do something about it, and it opens on **at most five
things worth doing** rather than on sixty rows — the board it replaces carried
the same facts and stopped being opened, because a page that opens on
everything gets read once.

The list is grouped by creator (three dark handles belonging to one model is
one conversation) and ranked by **money, not audience**: a 500k account that
earns nothing is not the first call of the morning. A link that vanished
overnight goes first whatever it is worth — she can still remember doing it,
and tomorrow it is just another dark account. Each row says whose job it is:
`places = us` is an Iona task that needs nobody's reply, a chat client is a
question through Patricia, everyone else is an ask.

The judgement lives in `cloud/src/lib/funnel-rank.ts` with no database
attached, so it can be tested and argued with. `funnel.ts` only fetches.

### How the reading gets there

The scan has to run on the Mac — Instagram refuses a logged-in session from a
datacenter IP, and the burner has been trusted from one residential address
for weeks. **Nothing else does.** The Mac is a sensor, not a platform: twenty
minutes a day it reads sixty profiles and posts about 18KB up.

    bin/funnel-push          # after a scan; bin/funnel-daily already calls it

It carries the reading and a per-creator money summary — no fan ids, no names.
`transcriber.funnel_readings` keeps one row per account per **day**, so a
second scan corrects the first and "how many days was this link up" stays a
count of rows. Until 2026-10-28 that history existed only in a folder on one
laptop.

Two things to know about the hosting, because they cost an hour to work out:

- **`plan.gosianmedia.com` is canonical and its origin is not recorded
  anywhere.** `src/middleware.ts` hands every *page* on the retired Vercel
  host over to it; `/api/*` is exempt, which is why a reading can be pushed to
  the Vercel host and still land in the same Neon database. As of 2026-10-28
  the origin is **not** the `sinauraco-s-projects` Vercel team (which holds
  only `sinauraco.com`) and **not** the Railway `transcriber` project (whose
  services are `film-instructions`, `bin-worker`, `studio-worker`, `worker` —
  the Python side). Cloudflare fronts it with no `cf-cache-status`, so the
  origin is masked. **Whoever next deploys the console needs to know where it
  goes; write it here when you find out.**
- **The two hosts have different `WORKER_SECRET`s.** `FUNNEL_CLOUD_URL` and
  `FUNNEL_WORKER_SECRET` override the pair for the days one is mid-deploy.

Cloudflare refuses a request carrying urllib's default signature with error
1010, which surfaces as a bare 403. That is what stopped the scout pass dead
from 2026-10-27 19:00 until the clients were made to say what they are.

## Scheduling

| plist | when | what |
|---|---|---|
| `com.geno.social-transcriber.funnel` | daily 08:00 | scan + the DM digest |
| `com.geno.social-transcriber.funnel-deep` | Wed 14:00 | the amber queue, `--apply` |

Both sit twelve hours clear of the 19:00 scout pass. Two browsers on one burner
session at once is what makes an account look automated.

    cp docs/com.geno.social-transcriber.funnel*.plist ~/Library/LaunchAgents/
    launchctl load ~/Library/LaunchAgents/com.geno.social-transcriber.funnel.plist
    launchctl load ~/Library/LaunchAgents/com.geno.social-transcriber.funnel-deep.plist

## The domain ledger

`bin/funnel hosts` counts, per host, the account-days it was visible and the
number of times it was there one reading and gone the next. It answers Geno's
standing question - whether deep links get flagged faster than a plain x.com
profile, the test he is running on Rae's backup - with data instead of a hunch.
It needs a run of daily files, which is why every day is kept rather than
overwritten.

## Known gaps

- The ledger needs about two weeks of readings before it can say anything.
- `out/funnel/2026-10-27.json` is seeded from a manual sweep and covers the bio
  only. Its `unknown` accounts fill in on the first real scan.
- A creator with no group on the bot can be alerted on but not asked; the tap
  says so rather than failing quietly.
