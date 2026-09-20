"""One video in, one labeled transcript folder out."""
from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass
from pathlib import Path

from . import asr, config, diarize, library, media, merge, render, speakers, visual


@dataclass(frozen=True)
class Options:
    out_dir: Path
    model: str = "best"
    language: str = "auto"
    formats: tuple[str, ...] = config.DEFAULT_FORMATS
    num_speakers: int | None = None
    diarization: bool = True
    # Measured 2026-09-03 on this Mac: large-v3-turbo with Metal takes ~1s on a
    # 6-30s reel, against a fetch that takes tens of seconds. The pass is free
    # in practice, so everything gets listened to and the *result* says whether
    # anyone talked. Left as an option only so the CLI can skip it deliberately.
    transcribe: bool = True
    # The visual pass reads text burned into the frame. Measured 2026-09-06 on
    # the 50 silent folders in out/: 44 of them (88%) carry on-screen text, and
    # the pass costs ~0.8s against a fetch of tens of seconds. For a video
    # nobody speaks in, this is the only hook signal there is.
    look: bool = True
    keep_video: bool = True
    keep_audio: bool = False
    force: bool = False


def job_key(source: str) -> str:
    return hashlib.sha256(source.encode()).hexdigest()[:8]


def _resolve(source: str, workdir: Path, user_config: dict, direct: dict | None = None) -> media.Source:
    if media.is_url(source):
        return media.download(source, workdir, user_config, direct)
    path = Path(source).expanduser().resolve()
    if not path.exists():
        raise RuntimeError(f"no such file: {source}")
    return media.adopt_local(path, workdir)


def _speech_report(
    transcript: "asr.Transcript", duration: float | None, *, checked: bool
) -> dict:
    """What the pass heard, in the terms the app labels a video with.

    whisper runs behind Silero VAD (see asr.transcribe), and on this corpus that
    gate is what makes the answer trustworthy: a music-only reel comes back with
    zero segments rather than a page of hallucinated lyrics. So the presence of
    any segment at all is the signal, and the ratio is there to describe how
    much of the video is someone speaking.
    """
    voiced = sum(segment.end - segment.start for segment in transcript.segments)
    ratio = None
    if duration and duration > 0:
        ratio = round(min(voiced / duration, 1.0), 3)
    return {
        "checked": checked,
        "has_speech": bool(transcript.segments),
        "voiced_sec": round(voiced, 2),
        "ratio": ratio,
    }


def _visual_report(seen: dict) -> dict:
    """What the screen said, in the shape the app stores.

    `checked` carries the same meaning it does for speech: False means no pass
    ran, which is not the same claim as "looked and found nothing on screen".
    """
    captions = seen.get("captions") or ()
    return {
        "checked": bool(seen.get("checked")),
        "has_text": bool(captions),
        "text": seen.get("text", ""),
        "captions": [{"t": c.t, "text": c.text} for c in captions],
        "frames_read": seen.get("frames_read", 0),
    }


def _finalize(workdir: Path, out_dir: Path, slug: str, key: str) -> Path:
    final = out_dir / f"{slug}--{key}"
    if final.exists():
        shutil.rmtree(final)
    workdir.rename(final)
    return final


def process(source: str, options: Options, user_config: dict, *, log=print,
            direct: dict | None = None) -> Path:
    """Download/adopt, transcribe, diarize, and write every requested format."""
    key = job_key(source)
    workdir = options.out_dir / ".work" / key
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        return _process_in(source, workdir, options, user_config, log=log)
    except BaseException:
        # Never leave a half-finished job behind for the next run to trip over.
        shutil.rmtree(workdir, ignore_errors=True)
        raise


def _process_in(
    source: str, workdir: Path, options: Options, user_config: dict, *, log=print
) -> Path:
    key = job_key(source)

    log("  fetching…")
    resolved = _resolve(source, workdir, user_config, direct)

    if resolved.meta.get("source_type") == "url":
        media.ensure_playable(resolved.media_path)

    wav: Path | None = None
    # Everything downstream already copes with nothing having been said:
    # diarization is gated on segments, and the writers emit empty files.
    transcript = asr.Transcript(language="", segments=(), model="none")
    checked = False
    if not options.transcribe:
        log("  no speech pass asked for…")
    elif not media.has_audio(resolved.media_path):
        # A reel with a muted or stripped audio track is an ordinary thing to
        # add, not a job that should fail. It is simply a video nobody talks in.
        log("  no audio track…")
        checked = True
    else:
        log("  extracting audio…")
        wav = media.extract_audio(resolved.media_path, workdir / "audio.wav")

        log(f"  transcribing ({options.model})…")
        transcript = asr.transcribe(
            wav,
            workdir=workdir,
            model_key=options.model,
            language=options.language,
        )
        checked = True

    # Read the screen. This never raises and never fails the job: a video with
    # no legible text is an ordinary thing to add, exactly like one nobody
    # speaks in. `checked` False means nothing looked, which the app must not
    # read as "looked, found nothing".
    seen: dict = {"checked": False, "captions": (), "text": ""}
    if options.look:
        if visual.available():
            log("  reading the screen…")
            seen = visual.analyze(resolved.media_path, workdir)
            if seen.get("captions"):
                log(f"    {len(seen['captions'])} on-screen caption(s)")
        else:
            log("  (OCR binary missing — skipping the visual pass)")

    turns: tuple[diarize.Turn, ...] = ()
    if options.diarization and transcript.segments and wav is not None:
        if diarize.available():
            log("  separating speakers…")
            turns = diarize.diarize(wav, num_speakers=options.num_speakers)
        else:
            log("  (speaker models missing — skipping diarization)")

    segments, order = merge.assign_speakers(transcript.segments, turns)
    profiles = speakers.build_profiles(wav, turns, order) if turns and wav else ()
    blocks = merge.group_blocks(segments)

    meta = dict(resolved.meta)
    if not meta.get("duration_sec"):
        # Instagram often omits duration in its metadata; probe the file instead.
        meta["duration_sec"] = media.probe_duration(resolved.media_path)
    result = render.Result(
        meta=meta,
        transcript=transcript,
        segments=segments,
        blocks=blocks,
        profiles=profiles,
        created_at=render.now_stamp(),
        speech=_speech_report(transcript, meta.get("duration_sec"), checked=checked),
        visual=_visual_report(seen),
    )
    render.write_all(result, workdir, options.formats)

    if wav is not None and not options.keep_audio:
        wav.unlink(missing_ok=True)
    if not options.keep_video:
        resolved.media_path.unlink(missing_ok=True)

    final = _finalize(workdir, options.out_dir, resolved.slug, key)
    library.upsert(
        options.out_dir,
        {
            "source": source,
            "folder": final.name,
            "platform": meta.get("platform"),
            "author": meta.get("author"),
            "title": meta.get("title"),
            "language": transcript.language,
            "speaker_count": len(profiles),
            "duration_sec": meta.get("duration_sec"),
            "word_count": len(transcript.text.split()),
            "transcribed_at": result.created_at,
        },
    )
    return final
