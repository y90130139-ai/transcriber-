# social-transcriber

Turn an Instagram Reel, a TikTok, or a video already on your phone into a
labeled transcript. Runs entirely on this Mac. No API keys, no subscriptions,
no upload of your clips to anyone.

```bash
./bin/transcribe https://www.instagram.com/reel/DUNg75LElex/
./bin/transcribe https://www.tiktok.com/@nasa/video/7679847738871270670
./bin/transcribe ~/Downloads/clip.mp4
./bin/transcribe inbox/            # everything you dropped in a folder
./bin/transcribe --batch links.txt # one URL per line
./bin/transcribe --list            # what's in the library
```

## The drop-and-go app

```bash
transcriber-ui        # opens http://localhost:8765 in your browser
```

Drag videos anywhere onto the page, or paste a messy list of links (notes and
tracking parameters are stripped for you). Jobs run one at a time with live
status; click a finished one to read it, with buttons to copy the plain
transcript or the markdown. The server binds to 127.0.0.1 only — nothing is
uploaded anywhere, and dropped files are just copied into `inbox/`.

Dropped **files need no login**, which is the reliable path for saved Reels.
Pasted **links to private or login-walled posts** still need Instagram cookies
(see below) — no interface can work around that.

## The hosted app

There is a second face on this: a small web app on Vercel that you can open from
anywhere — the phone included — and dump links into. It holds a queue; this Mac
does the transcribing.

```bash
./bin/setup-cloud https://your-app.vercel.app   # once
./bin/worker                                    # leave running
```

Paste as many links as you like, mixed in with whatever notes came with them —
the links get pulled out and tracking parameters stripped, so a share link and a
clean link count as one post. Videos can be dragged onto the page or picked from
the phone's camera roll. Each finished item shows its poster frame, the @handle,
the original URL, duration, language and speaker count, so a bulk drop of thirty
reels stays matched to where each one came from. Opening one gives the
speaker-labeled transcript with copy buttons: the words with the source line
attached, the words alone, or the markdown.

The video never leaves this machine. Only the transcript text and a small poster
frame are sent up. If the Mac is asleep, links simply wait in the queue and drain
when `./bin/worker` is next running.

```
phone / laptop ──> Vercel (queue + library) <──poll── ./bin/worker on this Mac
                                              ──text──>
                   watch a clip  <──── cloudflared tunnel ────  out/<folder>/source.mp4
```

`cd cloud && node scripts/status.mjs` prints the queue and when the worker was
last seen.

## The content library

Four tabs: **Queue**, **Library**, **Creators**, **Models**. Every finished video is tagged
on three axes — persona, format, hook — suggested automatically from the
transcript and confirmed with a tap. Each post is scored against *its own
creator's median*, because raw likes only rank creators by follower count, and
the ones that beat their own normal in the last 90 days get a 🔥.

Videos play in the app without ever being uploaded anywhere: `./bin/worker`
opens a Cloudflare tunnel to a loopback server on this Mac, and the app hands
out signed, expiring URLs to it. Multi-select in the Library downloads a zip
built here.

Full account: **[docs/CONTENT-LIBRARY.md](docs/CONTENT-LIBRARY.md)**.

## The model portal

**Creators** are the Instagram accounts we research. **Models** are ours, and
they get a profile, a weekly plan built out of the library, and one stable link
they open on their phone — no login, revocable, `/p/<token>`.

Tag a video to a model from the item view and it lands on her week with a brief
already drafted from the library's own tags and transcript: the shape, the
opening, roughly how long, whether she needs a second person, where the sound
comes from. Deterministic and rule-based, so a wrong draft is a rule you can fix.
Edit it, mark the week sent, send the link. She plays each reference, ticks off
what she has filmed, and writes back per item.

Plan videos — and only plan videos — are copied to Cloudflare R2 by the worker,
because the tunnel dies whenever the Mac sleeps and she may open her plan at 2am.
A retention rule reclaims them when the week closes, which keeps it inside R2's
free tier. R2 is optional; without it the plan falls back to the Instagram link.

Full account: **[docs/MODEL-PORTAL.md](docs/MODEL-PORTAL.md)**.

### Railway worker and Instagram monitoring

The Railway deployment and two-hour Instagram freshness watchdog are described
in **[docs/RAILWAY-MIGRATION.md](docs/RAILWAY-MIGRATION.md)**. Apify is no longer
used by Scout. Authenticated Instagram scraping remains off by default on
Railway until its outbound network is validated with a burner session.

### Does anyone talk in this?

**Everything gets listened to.** There is no checkbox — a whisper pass costs
about a second on a reel, measured on this Mac with Metal, against a fetch that
takes tens of seconds. Each queue row then carries a **Talking** / **No speech**
chip saying what was heard, dashed while it is the machine's reading and filled
once you have overruled it.

The reading is trustworthy because whisper runs behind Silero VAD: over the 19
library videos that had never had a pass, 6 had real speech and 12 came back
with zero words — all of them loud music, none producing a hallucinated lyric.

A video with no audio track is not a failure any more; it is simply a video
nobody talks in. Anything added before this existed can be caught up with
`./bin/relisten`, which re-listens from the copy already on disk rather than
re-fetching.

## What you get

Every job produces its own folder under `out/`, named
`<platform>-<creator>-<title>--<id>`, containing:

| File | What it is |
| --- | --- |
| `transcript.md` | The readable one: metadata header, speaker table, caption, transcript |
| `transcript.txt` | Plain text with timestamps and speaker prefixes |
| `transcript.srt` / `.vtt` | Subtitles, speaker-prefixed |
| `transcript.json` | Everything, machine-readable (segments, blocks, speakers, metadata) |
| `source.mp4` | The video itself (`--no-video` to skip keeping it) |
| `source.info.json` | Raw platform metadata |

`out/INDEX.md` is a running table of everything transcribed, and
`out/index.jsonl` is the same thing for scripts. Re-running a URL that's
already in the index skips it, so bulk runs are resumable — `--force` redoes it.

Speakers are separated automatically, so a two-hander skit comes out as:

```
**Speaker 1** · 0:00
Yeah, and you worked on the original computer in this country, right?

**Speaker 2** · 0:02
I was very fortunate. The Navy loaned me to the first big computer in the
United States, Mark I at Harvard.
```

## Options

```
--model best|fast     best = large-v3-turbo (default), fast = base
--lang auto|en|es     auto-detects by default
--speakers N          force an exact speaker count when you know it
--no-speakers         skip speaker separation (faster)
--formats md,txt,srt,vtt,json
--no-video            don't keep the downloaded video
--keep-audio          keep the extracted 16 kHz wav
--force               re-transcribe something already in the index
--out DIR             write somewhere other than out/
```

## Speed

On this M4, with Metal acceleration, roughly **3-4x faster than realtime** end
to end including download and speaker separation: a 92-second TikTok takes
about 23 seconds, a 34-second clip about 6. `--model fast` is quicker still and
usually fine for clear single-speaker talking-head video.

## Private or login-walled posts

Public Reels and TikToks work as-is. Private accounts, close-friends stories,
and anything behind a login need your own session cookies:

```bash
cp config.example.json config.json   # then set "cookies_from_browser": "chrome"
```

That reads the Instagram cookies from your logged-in browser. Nothing is sent
anywhere — yt-dlp uses them locally to fetch the post. Alternatively, save the
video from the app to your Mac and run it through `inbox/`, which needs no
cookies at all.

## The phone workflow

AirDrop or sync saved videos into `inbox/`, then:

```bash
./bin/transcribe inbox/
```

Every video in the folder is transcribed in one pass and added to the index.

## What it's honest about

**Speaker separation is unlabeled by identity.** The tool tells you *how many*
distinct voices there are and which lines belong to each, not who they are. It
labels them `Speaker 1`, `Speaker 2`, in order of first appearance.

**The pitch column is relative, not a gender call.** Each speaker's median
fundamental frequency is measured and reported, and speakers are ranked against
each other within that one video ("lower voice" / "higher voice"). It does not
claim a speaker's sex. That was tried and cut: social audio is compressed and
reposts are routinely sped up, which shifts pitch. On a reference clip an
elderly male speaker measured 216 Hz — a figure any absolute threshold would
call female. Ranking voices *inside* one recording is reliable, because they
share a codec and playback speed; absolute inference isn't.

**Boundaries between speakers are approximate.** When two people talk over each
other or one interrupts mid-sentence, a few words can land on the wrong side of
a speaker change.

**Music is handled but not transcribed.** Voice activity detection is on, which
stops the model inventing lyrics over music-only stretches — the most common
failure mode on Reels.

## How it works

```
URL ──yt-dlp──> video ──ffmpeg──> 16 kHz mono wav ──┬── whisper.cpp (Metal) ──> segments
                                                    └── sherpa-onnx ──────────> speaker turns
                                                                   │
                                             align + regroup ──────┴──> md / txt / srt / vtt / json
```

- **whisper.cpp** with `large-v3-turbo` (q5_0), built locally with Metal.
- **sherpa-onnx** offline diarization: pyannote segmentation + NeMo TitaNet
  embeddings, clustered at a threshold tuned to 0.82 (it scored 4/4 on the
  sherpa 2- and 4-speaker reference clips; below 0.75 it over-splits a single
  speaker, above 0.90 it merges two).
- **yt-dlp** for Instagram/TikTok, **ffmpeg** for decoding.

Nothing here requires Homebrew, sudo, or an account. `./setup.sh` rebuilds the
entire toolchain from scratch and is safe to re-run.

## Layout

```
bin/transcribe        CLI entry point
bin/serve             the local drop-and-go UI
bin/worker            drains the hosted queue
bin/setup-cloud       points this Mac at the hosted app
setup.sh              rebuilds binaries, models, and the whisper.cpp build
src/
  cli.py              argument parsing, bulk orchestration, resume
  pipeline.py         one video end to end
  media.py            yt-dlp download / local file adoption / audio extraction
  asr.py              whisper.cpp invocation and parsing
  diarize.py          sherpa-onnx speaker turns
  merge.py            aligning ASR segments to speaker turns, regrouping
  speakers.py         talk time, share, relative pitch per speaker
  voice.py            pitch measurement
  render.py           md / txt / srt / vtt / json writers
  library.py          the running index
  server.py           the local web UI
  worker.py           claim / transcribe / post back
  mediaserv.py        signed, range-capable video serving off this Mac
  tunnel.py           keeps a cloudflared tunnel in front of it
  r2.py               uploading and reclaiming plan videos
cloud/                the hosted app (Next.js on Vercel)
  src/lib/hot.ts      outperformance scoring and its constants
  src/lib/autotag.ts  persona / format / hook suggestions
  src/lib/media.ts    signing the video URLs
  src/lib/brief.ts    drafting a plan item's direction
  src/lib/plans.ts    the isolation boundary for anything her phone can read
  src/lib/r2.ts       presigning plan videos out of Cloudflare R2
  src/app/p/[token]/  the plan she opens on her phone
docs/CONTENT-LIBRARY.md   how the library, tagging and tunnel work
docs/MODEL-PORTAL.md      how models, plans and the share link work
vendor/               binaries + models (gitignored, rebuilt by setup.sh)
out/                  transcripts
inbox/                drop videos here
```
