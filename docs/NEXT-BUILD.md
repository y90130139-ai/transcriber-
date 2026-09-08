# Content Library build — handoff

> **BUILT 2026-09-02.** This spec is done; it is kept as the record of what was
> decided and why. For what actually exists, read
> [CONTENT-LIBRARY.md](CONTENT-LIBRARY.md). Do not re-execute this file.

Paste this whole file into a fresh Claude Code session. Everything below is
decided; nothing here needs re-litigating.

## What exists today
`~/projects/social-transcriber` transcribes IG/TikTok on-device. A launchd agent
(`com.geno.social-transcriber.worker`) drains a hosted queue 24/7. Hosted app is
Next.js in `cloud/`, Neon Postgres schema `transcriber`, deployed on Vercel.
Instagram auth via `secrets/cookies.txt` (yt-dlp keeps it refreshed).
Every job already stores `out/<slug>/source.mp4` (~10MB, 422MB total) plus
`source.info.json`, `transcript.{md,txt,srt,vtt,json}`, `thumb.jpg`.

## The job
Turn the transcriber into a content-research library for OF-model IG content.

### Decided architecture
- **Video delivery: Cloudflare Tunnel from the Mac. NOT cloud storage.** Videos are
  already on the Mac; the Mac already must be awake (it is the engine). Cost $0.
  Put **Cloudflare Access** in front (free <=50 users). Stable hostname needs the
  domain on Cloudflare — check whether sinauraco.com is there; if not, a
  quick tunnel works but the URL rotates on restart.
- **Tabs: Queue / Library / Models.** No separate Download tab — play, transcript,
  copy-as-markdown and download all live in the item view; bulk download via
  multi-select in Library.
- Mobile-first. Bulk paste of many links is a primary flow.
- Brand: follow sinaura-brand-identity tokens already used in `cloud/` — bone
  ground, ink masthead, ember once, radius zero. Never blue.

### Tagging: three axes (seed data in `cloud/src/lib/taxonomy.json`)
- **persona** (24) — how a creator is positioned. Stable per creator; powers Models.
- **format** (25) — what a video does. Includes talking-head, skit, text-overlay,
  street-interview, rage-bait, snap-banner, grwm, dance.
- **hook** (8) — how the first ~3s works. Highest-signal field; the first line of
  the transcript IS the hook, so it is inferable.
Auto-suggest all three from transcript + caption on job completion; human confirms.
Hand-tagging hundreds of videos is how the library dies.

### Engagement — VERIFIED against all 41 stored metadata files
Available 41/41: `like_count`, `comment_count`, `timestamp`, `upload_date`,
`channel` (handle), `uploader` (display name), `uploader_id`, `description`.
NOT available: `share_count` 0/41, `view_count` 1/41.
=> **Do not build views or shares columns.** Instagram does not expose them.

### Hot scoring (the 🔥)
Rank each video against **its own creator's median**, not against other creators.
`outperformance = (likes + k*comments) / creator_median(likes + k*comments)`
- 🔥 when outperformance clears a threshold (start ~1.75, tune on real data).
- **90-day window is a hard filter**: `upload_date` older than 90 days is excluded
  from Hot / top-performing entirely. Day 91 drops out.
- "Hottest this week" = highest outperformance among items uploaded in last 7 days.
- Model profile shows that creator's top performers, same normalization.

### Why normalized, not raw
Raw counts just rank creators by follower count. Outperformance answers "what
worked for this creator" — the actual research question.

## Build order
1. Schema: tags, creator, engagement columns; backfill from existing
   `out/*/source.info.json` (41 already on disk — no re-fetch needed).
2. Cloudflare Tunnel + Access; video streaming endpoint off the Mac.
3. Item view: player, transcript underneath, copy-markdown, download.
4. Library: filter by persona/format/hook/creator/date, multi-select bulk download.
5. Models tab: profiles grouped by `channel`, persona tag, top performers.
6. Hot: outperformance scoring, 🔥, hottest-this-week, 90-day filter.
7. Auto-tagging from transcript on completion.

## Traps (do not rediscover)
- `cloud/scripts/status.mjs` has `limit 12` — it is a display cap, not a count.
  Query the DB for real totals.
- `--cookies-from-browser chrome` hangs (Chrome holds the cookie lock). The code
  now prefers `cookies_file`. Do not revert.
- Reading Chrome's cookie store directly is blocked by the auto-mode classifier;
  cookies.txt must be exported by Geno.
- `vercel blob create-store` etc. run an implicit `env pull` that overwrites
  `cloud/.env.local`. Push secrets to Vercel first.
- Node scripts run from /tmp cannot resolve `cloud/node_modules` — set NODE_PATH.

## DNS — CHECKED 2026-09-02, do not re-check
`sinauraco.com` is **NOT** on Cloudflare. Nameservers are ns1/ns2.vercel-dns.com.
Do NOT move the apex — it serves live Vercel projects.
Tunnel hostname options, cheapest first:
1. Quick `trycloudflare.com` tunnel — $0, no setup, URL rotates on restart. Use
   this while building.
2. Delegate only `videos.sinauraco.com` to Cloudflare with NS records at Vercel —
   $0, apex untouched, stable hostname. Try this before paying for anything.
3. Cheap throwaway domain on Cloudflare (~$10/yr) if (2) proves fiddly.

## Worker is DISABLED — read this before debugging an empty queue
The launchd worker was stopped and disabled on 2026-09-02 so it could not touch
the DB or `out/` during this build. Nothing will transcribe until it is turned
back on, and `bootstrap` ALONE WILL NOT WORK because `disable` persists across
reboots. Both commands, in this order:

    launchctl enable gui/$(id -u)/com.geno.social-transcriber.worker
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.geno.social-transcriber.worker.plist

Verify:  launchctl print gui/$(id -u)/com.geno.social-transcriber.worker | grep -E 'state|pid'
To stop again: launchctl bootout gui/$(id -u)/com.geno.social-transcriber.worker
               launchctl disable gui/$(id -u)/com.geno.social-transcriber.worker

## Corpus on disk as of handoff
36 done, 3 failed (audience-restricted, unreachable with any cookie).
`out/*/` holds source.mp4 + source.info.json + transcript.{md,txt,srt,vtt,json}
+ thumb.jpg. Backfill the DB from these — do not re-scrape Instagram.
