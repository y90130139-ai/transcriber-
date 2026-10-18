# Repurpose — the studio pipeline (plan, 2026-10-18)

**Goal.** The ♻ button stops meaning "marked" and starts meaning "a fresh
video exists". One tap queues one of her winners through the studio's own
repurpose render; the new file lands in R2 and shows up in a new **Repurposed**
section in her Reels tab, ready to send back for her to post again. The output
is a re-cut, re-encoded, mirrored, re-coloured, grain-swept copy whose pixels,
audio timeline and metadata share nothing Instagram's duplicate detection can
match against the original.

## Where things run

- **Cloud (Vercel)** — the face and the queue: marks the intent, mints the
  seed and the R2 key, hands errands to the Mac on the claim it already makes,
  takes the report back, presigns reads. No bytes ever pass through it.
- **Mac (`src/worker.py` loop)** — the studio. It already polls every ~2s,
  holds the library videos on disk, has ffmpeg (`config.FFMPEG`) and the only
  R2 credentials. A new errand type `repurpose` rides the same poll as jobs
  and the R2 errands; the render itself lives in `src/repurpose.py`.
- **R2** — `repurposed/<model>/<job>.mp4`, same bucket as plan videos.
  Deliberately **outside the `plans/` prefix**, so the retention sweep and the
  bucket reconcile (which only list `plans/`) can never touch a file someone
  still needs. Cleanup is explicit: unrepurpose and model delete push the key
  onto `r2_trash`, which the Mac already reclaims.

## Data — `transcriber.repurposes` grows up

It already holds one row per marked reel (`post_id` = library job id,
`model_id`, `destination`, `note`). New columns:

| column | meaning |
| --- | --- |
| `status` | `marked` (older rows) → `queued` → `rendering` → `ready` \| `failed` |
| `seed` | the render's receipt — every jitter is derived from it |
| `attempts`, `claimed_at` | the same honour system `jobs` uses (stale >30 min back to `queued`, 3 attempts then `failed`) |
| `output_key`, `output_bytes`, `rendered_at` | what the Mac reported back |
| `recipe` | `fresh-v1` — what was done to the file, so an old output can still say |
| `error` | the Mac's own words when a render fails |

## The flow

1. **Tap ♻ Repurpose** (Reels strip, plan popup's "her recent posts", Top
   posts). Both existing routes go through `lib/repurpose.ts::queueRender`:
   the `repurposes` row is upserted `status='queued'` with a fresh seed, and
   the Repurpose card still lands on her week exactly as before.
2. **The Mac claims it** — `/api/worker/claim` returns `repurpose: [...]` with
   `{ id, post_id, model_id, seed, key, folder, media_url, source_url }`.
   Folder comes from `transcripts.folder`; `media_url` from `creator_posts`
   while Instagram's CDN link is alive.
3. **The source is found** on the Mac: the library folder's video first, then
   the CDN link, then yt-dlp with the cookie fallback — the same order the
   pipeline already trusts.
4. **`src/repurpose.py` renders** (`fresh-v1`), every jitter from the seed:
   - `hflip` — mirror, the single strongest break
   - centre crop 93–97%, even-pixel scale
   - `eq` brightness ±0.02 / contrast ±0.05 / saturation ±0.06, `hue` ±3°
   - `noise` (both fields, 3–7) — different pixels on every frame
   - speed 1.012–1.03 (`setpts` + matching `atempo`) — the audio timeline the
     original was fingerprinted on no longer exists
   - tiny head/tail trim, re-encode `libx264` CRF 20–24, AAC 128k, faststart
   - `-map_metadata -1`, fresh `creation_time` within the last 45 days, no
     encoder tag — nothing of the original container survives
5. **The Mac uploads to R2** (`r2.put`) then reports
   `POST /api/worker/repurpose {id, status:'ready', key, bytes}` (or `failed`
   with the error). The row is the ledger; the bucket is the truth.
6. **Reels → Repurposed** (`GET /api/models/:id/repurpose`) lists the renders:
   status, source reel, and — when ready — a presigned player and download
   link. Rendering in flight polls itself every 15s.

## Studio parity

The Video Batcher (console → Studio) gets a built-in **"Repurpose — fresh
video"** preset with the same shape: mirror, subtle motion, colour drift, a
slight speed step, metadata scrub and re-encode to MP4. The automatic path is
the default; the preset is there for the case where a person wants to drive
the render by hand.

## Out of scope this pass

- Auto-sending the file to her group (the bot stays the sender; the operator
  ticks "Repurposed ✓" on the card once it has gone back).
- Multiple variants per repurpose, per-model recipe tuning, retry button
  (status `failed` says why; tapping ♻ again re-queues with a new seed).
