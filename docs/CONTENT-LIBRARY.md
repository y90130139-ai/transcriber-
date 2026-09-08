# The content library

The transcriber's second half. The first half turns a link into words; this
turns a pile of words into a research tool — what a creator normally does, which
of their posts beat it, and what those posts had in common.

## The three questions it answers

1. **What is this?** Every video carries three independent tags: a **persona**
   (how the creator is positioned), a **format** (what the video does) and a
   **hook** (how the first three seconds work). Vocabulary lives in
   `cloud/src/lib/taxonomy.json`.
2. **Did it work?** Not in raw likes — those only rank creators by follower
   count. Each post is scored against **its own creator's median**.
3. **Who is this?** The Models tab groups everything by `@handle`, holds the
   creator's persona, and lists their top performers.

## Outperformance, and the flame

```
score          = likes + 10 × comments
outperformance = score ÷ that creator's median score
```

- 🔥 at **1.75×** or better. On the stored corpus that marks the top ~10%.
- **Comments are worth ten likes.** This corpus runs ~34 likes per comment, so a
  weight of 10 lets comments carry about a quarter of the score without
  swamping it.
- **90 days is a hard fence.** Anything older is out of Hot and out of top
  performers entirely. Day 91 drops off. The Library's date filter offers
  all time / 90 / 30 / this week, but only the 90-day fence governs the
  flame — narrowing to 30 days filters what you see, not what counts as hot.
- **Three posts minimum.** A creator with one post is their own median, so they
  score exactly 1.00 and never light up. That is correct, not a gap.
- The median is taken over *everything* that creator has in the library, not
  just the last 90 days. A wider baseline is a steadier one; the 90-day rule
  governs which posts can be hot, not what they are measured against.

Constants live in one place: `cloud/src/lib/hot.ts`. Tune them there.

### Why not views or shares

Checked against all 41 stored metadata files: `like_count` and `comment_count`
are present on 41/41, `view_count` on 1/41 and `share_count` on 0/41. Instagram
does not expose them, so there are no columns for them. Do not add any.

## Does anyone talk in this?

**Everything gets listened to.** Paste links, drop files — each one gets a
whisper pass on fetch and the queue row then says what was heard. There is no
checkbox, because there is nothing left to decide.

This replaced an opt-in checkbox on 2026-09-03, on a measurement. The pass was
assumed expensive and had never been timed. On this Mac, large-v3-turbo with
Metal takes **about a second** on a 6–30 s reel — against a fetch that takes
tens of seconds. The cost the checkbox existed to avoid was not there.

| Chip | Meaning |
|------|---------|
| **Talking** | Whisper heard speech. |
| **No speech** | Whisper listened and heard nobody — music or silence. |
| **Listening** | No pass has run yet: still in flight, or added before this existed. |

A chip the pass set is **outlined and dashed**; one you set is **filled** — the
same distinction the tag chips draw between a guess and a decision. Tapping a
chip overrules the pass. That is normally just a correction and re-runs
nothing; whisper has already listened. Two cases do put the job back in the
queue: a **failed** one, where the flip corrects the attempt that failed, and a
row that has **never been listened to at all**.

### Why the answer can be trusted

The hard part was never running a detector. It was that **singing is voice**, so
a naive pass marks every lip-sync reel as talking — the exact class the label
exists to separate out.

It is already handled. `src/asr.py` runs whisper behind **Silero VAD**
(`--vad -vm`), and that gate is what makes the reading honest. Measured over the
19 videos in the library that had been added without a pass: 6 contained real
speech, 12 came back with **zero words and zero voiced seconds**, and 1 had no
audio track. All 12 were at normal volume (−16 to −19 dB) — loud music, not
silence — and not one produced a hallucinated lyric. The 55 already-transcribed
rows were scanned for hallucination signatures too; the repetition-heavy ones
are all genuine speech.

So no separate detector was built. The detector *is* the whisper pass, and the
transcript is kept because it cost nothing to make.

### Where it lives

| Column | Meaning |
|---|---|
| `transcripts.has_speech` | What the pass heard. **Null means no pass has run** — never read that as false. |
| `transcripts.speech_ratio` | Voiced seconds over duration, 0–1. Descriptive; nothing keys off it. |
| `transcripts.speech_override` | Your answer, when you disagree. Null means you have not. |
| `jobs.transcribe` | True on everything new. Kept only so an explicit "don't bother" is still possible. |

`speaks()` in `cloud/src/lib/format.ts` is the one place the two are combined:
your answer wins, otherwise the pass's.

### A video with no audio track is not a failure

It used to be. `media.extract_audio` raises on one, which failed the job
permanently. The pipeline now checks first and records "listened, heard nobody",
which is the truth about a muted clip.

### Catching up the old rows

Anything added before this existed has `has_speech is null`. `./bin/relisten`
re-listens to those **from the copy of the video already on disk** — nothing is
re-fetched, so a post Instagram has since gated is in no danger. Dry run by
default; `--apply` does it.

## Tagging

Suggestions are generated on job completion, deterministically, from a keyword
table — no API key, nothing to bill, and a rule you can read when a tag looks
wrong (`cloud/src/lib/lexicon.ts`, `cloud/src/lib/autotag.ts`).

- **Hook** comes from the opening line of the transcript, which *is* the hook.
- **Format** comes from phrases plus the shape of the recording: silent and
  short reads as text-overlay, two voices as a skit, one voice and real word
  count as a talking head.
- **Persona** is a property of the creator, so it is read from everything they
  have said, and it needs corroboration — one stray word will not carry it.
  **Once you set a persona on a creator in the Models tab, every future post of
  theirs inherits it.** That is the shortcut worth taking.

A suggestion and a decision look different on purpose: guesses are outlined and
dashed, what you confirmed is filled. Tapping a chip confirms or removes it.
Re-running the suggester never touches a tag a human has touched.

    # after editing the lexicon, re-suggest across the library
    curl -X POST -H "Authorization: Bearer $WORKER_SECRET" \
      https://your-app.vercel.app/api/retag?all=1

Without `?all=1` it only tags items that have never been tagged.

## Video: the tunnel

Videos stay on the Mac. They are already there, and the Mac already has to be
awake — it is the engine. Storage cost is therefore zero.

```
phone ──> Vercel (transcripts, tags, scores)
   │              signs a URL with WORKER_SECRET
   └──────> cloudflared ──> 127.0.0.1:8788 on the Mac ──> out/<folder>/source.mp4
```

`./bin/worker` starts three things now: the queue drain, a small HTTP server on
loopback that serves `out/`, and a cloudflared tunnel in front of it.

- **Every URL is signed and expires** (HMAC-SHA256 over `scope:expiry` using
  `WORKER_SECRET`, six hours). A publicly resolvable tunnel does not make the
  library publicly readable, and the server refuses a signature whose expiry is
  further out than the ceiling.
- **Range requests are honoured**, because iOS Safari will not play video from a
  server that does not.
- **Captions** come from the WebVTT the pipeline already writes.
- **Bulk download** is one zip built on the Mac, not twenty downloads the
  browser blocks.

### Hostname

By default this is a **quick tunnel**: no account, no DNS, no cost, and a new
hostname every time cloudflared restarts. That is survivable because the worker
reports its current media URL on every heartbeat, so the app always signs
against whatever is live right now. A quick tunnel takes a minute or two to
become reachable after it starts.

For a stable hostname, put one in `config.json` and run a named tunnel:

```json
{
  "media_hostname": "videos.example.com",
  "media_tunnel": "transcriber-media"
}
```

Then **Cloudflare Access** can sit in front of it (free up to 50 users), which
is the arrangement worth having. `sinauraco.com` is not on Cloudflare — its
nameservers are Vercel's and the apex serves live projects, so do not move it.
Delegating only `videos.sinauraco.com` to Cloudflare with NS records at Vercel
is the $0 route to a stable name.

## Schema

```
transcriber.jobs         the queue (unchanged)
transcriber.transcripts  + like_count, comment_count, post_id, folder,
                           tagged_at, confirmed_at,
                           has_speech, speech_ratio, speech_override
transcriber.tags         (job_id, axis, tag, origin, score)  origin: auto | human
transcriber.creators     handle, display_name, persona[], note
transcriber.worker_pings + media_url
```

```bash
cd cloud
node scripts/migrate.mjs    # idempotent
node scripts/backfill.mjs   # engagement + folders from out/*/source.info.json
node scripts/renormalize.mjs --apply   # after any change to normalizeUrl
```

`backfill.mjs` reads what is already on disk. It never re-scrapes Instagram.

`renormalize.mjs` brings existing `jobs.source_key` onto the current dedupe
rules. **Run it whenever `normalizeUrl` learns a new equivalence**, or every row
written under the old rules stops matching what a fresh paste produces and the
next paste of a post already in the library adds it a second time. It reports
collisions rather than deleting anything.

## Traps

- `cloud/scripts/status.mjs` has `limit 12`. That is a display cap, not a count.
- `--cookies-from-browser chrome` hangs, because Chrome holds a lock on its
  cookie store. The code prefers `cookies_file`. Do not revert it.
- Vercel's `env pull` writes quoted values; `scripts/env.mjs` strips the quotes.
  Several `vercel` subcommands run an implicit `env pull` that overwrites
  `cloud/.env.local` — push secrets to Vercel first.
- Node scripts run from `/tmp` cannot resolve `cloud/node_modules`. Run them
  from `cloud/`.
- A quick tunnel's hostname does not resolve for the first minute or two. That
  is DNS propagation, not a broken tunnel.
- `transcripts.has_speech` is **nullable on purpose**. Null is "nothing has
  listened", false is "listened, heard nobody". Treating them alike re-queues
  every music-only video forever.
- Two library rows for one post is not cosmetic. `hot.ts` divides a post's score
  by its creator's **median**, so a phantom copy moves that median and changes
  which of their posts read as hot. That is why dedupe is enforced twice: on the
  normalised URL before fetching, and on `post_id` in
  `/api/worker/complete` after — the platform's own id, identical however the
  link was written.

## The worker as a service

```bash
launchctl enable    gui/$(id -u)/com.geno.social-transcriber.worker
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.geno.social-transcriber.worker.plist
launchctl print     gui/$(id -u)/com.geno.social-transcriber.worker | grep -E 'state|pid'
```

`bootstrap` alone will not work after a `disable`; `disable` persists across
reboots. To stop it: `bootout` then `disable`.
