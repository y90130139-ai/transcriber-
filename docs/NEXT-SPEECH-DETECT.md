> **BUILT 2026-09-03 — and the measurement below overturned the brief.**
>
> Step 4 said to time a whisper pass before building anything, because it might
> change the design. It did. large-v3-turbo with Metal takes **~1s** on a 6–30 s
> reel — about 1/20th of the fetch — so no separate detector was written. Every
> video is transcribed and the *result* sets the label.
>
> The hazard the brief calls "the one thing that makes this hard" — singing
> reading as voice — turned out to be already handled: `src/asr.py` has always
> run whisper behind Silero VAD, and over the 19 unheard library videos that
> gate returned **zero words on all 12 music-only posts** and no hallucinated
> lyrics anywhere. 6 had real speech. 1 had no audio track.
>
> The account of what was built is **[CONTENT-LIBRARY.md](CONTENT-LIBRARY.md)**,
> section "Does anyone talk in this?". Kept here for the record of what was
> assumed going in.

# Next: detect speech instead of asking

Self-contained brief. Hand this to a fresh session with **"Read
`docs/NEXT-SPEECH-DETECT.md` and build it."** Everything needed is below; no
prior conversation required.

## The problem

`transcriber.jobs.transcribe` decides whether a video gets a whisper pass. It is
**opt-in and unticked by default** (Geno's explicit choice — do not flip that
default). Adding is the bulk action; the speech pass is what you ask for.

That leaves one gap. Nothing detects speech. After dropping thirty links you
must decide, per video, whether anyone talks in it — by opening each one. That
is the friction this task removes.

Geno's words: *"When they're in flight and they're queued, it should say
whether or not it has transcribable content in there."* — **say**, i.e. the
system should have an opinion. He then confirms or overrides it.

## What is already on this machine (checked 2026-09-03)

The whole toolchain for this exists and is **unused**:

| Thing | Where | Status |
|---|---|---|
| Silero VAD v5.1.2, ggml | `vendor/models/ggml-silero-v5.1.2.bin` (885 KB) | downloaded by `setup.sh:36` |
| `VAD_MODEL` constant | `src/config.py:26` | defined, **referenced nowhere else** |
| whisper.cpp `--vad` support | built `whisper-cli` | confirmed via `--help` |

Relevant `whisper-cli` flags:

```
--vad                          enable VAD
-vm,  --vad-model FNAME        VAD model path
-vt   --vad-threshold N        [0.50]
-vspd --vad-min-speech-duration-ms  [250]
-vsd  --vad-min-silence-duration-ms [100]
```

So this needs **no new dependency, no download, no API key**. Consistent with
the project rule that the whole pipeline runs on-device with no accounts.

## The one thing that makes this hard

**VAD detects voice, and singing is voice.** This corpus is Instagram reels —
most carry music, and a large share carry *vocal* music. A naive VAD pass will
mark every lip-sync and trending-audio reel as "talking", which is exactly the
class of video the flag exists to skip. A detector that says yes to everything
is worse than no detector, because it teaches Geno to ignore it.

So the job is **not** "run VAD". It is "run VAD and then decide whether what it
found is a person talking to camera or a backing track."

## Suggested approach, in order of cost

Investigate and choose; do not assume this ordering is right.

1. **VAD alone, measured first.** Run `--vad` over the existing `audio.wav` for
   a sample of ~20 library videos spanning known talking-heads and known
   silent/music posts (`transcriber.transcripts.word_count` tells you which is
   which — rows with `word_count > 20` definitely have speech, rows at 0 do
   not). Report the confusion matrix before writing any product code. If VAD
   alone separates them cleanly, stop here — you are done.

2. **Speech ratio, not speech presence.** VAD returns segments. A talking head
   is voiced for most of its duration in long runs; a music bed is either
   continuously "voiced" or scattered. Try `voiced_seconds / duration` plus
   longest-run length as the discriminator, with the threshold tuned on the
   sample from step 1.

3. **whisper's own `no_speech_prob`.** whisper emits a per-segment
   no-speech probability, which is trained to reject music. Cheaper variant:
   run `ggml-base-q5_1.bin` (already vendored, `src/config.py`) over the first
   ~15 s rather than large-v3-turbo over the whole thing, and judge from its
   confidence and from whether the text looks like whisper's known music
   hallucinations (repeated phrases, "Thanks for watching", subtitle credits).

4. **Measure whether the speech pass is even expensive.** Nobody has timed
   large-v3-turbo on a 10–30 s reel on this Mac with Metal. If it is ~3 s, the
   cheapest honest answer may be to transcribe everything and use the *result*
   to set the chip — the flag then becomes a data-quality control (keeping
   whisper's music hallucinations out of the full-text index and the
   autotagger) rather than a time saver. **Time this before building anything**;
   it may change the design.

## Rules for the result

- **Suggest, never decide.** The existing tag system already draws this
  distinction and you must match it: a guess is outlined/dashed, a human's
  decision is filled (`.chip[data-origin='auto']` vs `[data-origin='human']` in
  `cloud/src/app/library.css`). A detected chip must be visibly a guess, and
  **must never overwrite a value a human set** — same contract as
  `POST /api/retag`, which never touches a confirmed tag.
- Store the detector's opinion separately from `jobs.transcribe`, which is the
  human's instruction. Suggest a nullable `transcripts.speech_ratio real` and
  `transcripts.speech_guess boolean`, set by the worker.
- The worker computes it — the Mac holds the audio, and Vercel cannot.
  `cloud/` never sees a media file.
- Detection runs on `audio.wav` **during the fetch**, so it is available on a
  video added without a speech pass. Note that path currently skips audio
  extraction entirely (`src/pipeline.py`, `if options.transcribe:`); a VAD pass
  needs the wav, so extraction has to move out of that branch. Guard it —
  `media.extract_audio` raises on a file with no audio track, and handling that
  case is the whole reason this feature exists.

## Landmarks

| File | Why |
|---|---|
| `src/pipeline.py` | `_process_in`, the `options.transcribe` branch |
| `src/asr.py` | how `whisper-cli` is invoked; add a VAD-only call beside it |
| `src/config.py` | `VAD_MODEL`, `ASR_MODELS`, `WHISPER_CLI` |
| `src/worker.py` | `run_job` / `_payload` — what gets posted back |
| `cloud/src/app/api/worker/complete/route.ts` | where a payload lands |
| `cloud/src/components/Queue.tsx` | the Talking / No speech chip |
| `cloud/src/app/api/items/[id]/route.ts` | `PATCH`, the human override |
| `docs/CONTENT-LIBRARY.md` | "Adding without listening" — update it when done |

## Traps this project has already paid for

- **A no-speech video's `plain` is `"\n"`, not `""`.** Never test for empty
  string; use `word_count`.
- **Postgres `btrim(x)` with one argument strips spaces only, not newlines.**
- **Neon returns `count(*)` as a string.** Cast `::int` or `"2" + "0"` is `"20"`.
- **Regexes and escapes inside JS template literals eat their backslashes.**
  SQL fragments needing them live in `cloud/src/lib/sql.ts`.
- **Restart the worker after touching Python**:
  `launchctl kickstart -k gui/$(id -u)/com.geno.social-transcriber.worker`
- **Back up `cloud/.env.local` before any `vercel` command** — store commands
  trigger an implicit `env pull` that overwrites it.
- Verify in a real browser. Chrome headless over CDP using Node's built-in
  global `WebSocket` (no puppeteer): mint a `tx_session` cookie from
  `SESSION_SECRET` and inject with `Network.setCookie`. Use
  `Emulation.setDeviceMetricsOverride`, not `--window-size`.
