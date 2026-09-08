"""What the video *shows*, for the videos that never speak.

29% of the local corpus (50 of 170 folders, measured 2026-09-06) returns zero
spoken words. Those videos reach the autotagger with nothing but a caption and a
duration, so their hook axis is empty, `match.ts` cannot recommend them to a
model, and `brief.ts` drafts an empty brief. The text stamped on the frame is
the hook for that half of the library, and Apple's Vision framework reads it
on-device for free.

Two rules govern this module, both learned the hard way elsewhere in this repo:

1. **It never raises.** A video nobody can read is an ordinary outcome, exactly
   as a video nobody talks in turned out to be (see pipeline._process_in). Every
   failure path returns a report saying "looked, found nothing".
2. **`checked` is the record of whether anything looked at all.** The app stores
   it as `has_looked`, and null there means "nothing has looked" — NOT "looked
   and found no text". Conflating those re-OCRs every wordless video forever,
   the same trap `has_speech` set for the speech pass.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from . import config

# Reels are short. One candidate per second reads every text card that holds for
# a beat, and the cap keeps a stray long upload from turning into a hundred
# OCR calls.
CANDIDATE_FPS = 1.0
MAX_CANDIDATES = 24

# Frames go to Vision at this width. Vision wants readable glyphs, not detail —
# 720px reads burned-in reel text reliably and keeps each call quick.
FRAME_WIDTH = 720

# Near-duplicate threshold, mean absolute difference on a 16x16 grayscale
# thumbnail (0-255 scale). Measured on the library sample: a held text card
# produced six byte-identical frames, so without this every OCR call but one is
# wasted. Deliberately low — it measures brightness, not structure, so two
# differently-worded cards on the same background still survive.
DEDUP_SIZE = 16
DEDUP_THRESHOLD = 2.0

# Two OCR readings this similar are the same text card read twice. Tuned on
# the library sample: 0.85 merges the jitter variants of one held card without
# merging a setup line into its punchline.
SAME_CARD_RATIO = 0.85


@dataclass(frozen=True)
class Caption:
    """One run of on-screen text, and when it first appeared."""
    t: float
    text: str


def available() -> bool:
    """Whether the OCR binary was built. Absence is a normal state."""
    return config.OCR_TEXT.exists()


def _run(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    # -nostdin matters: ffmpeg reads stdin by default and will happily eat the
    # caller's loop input if this is ever driven from a shell pipeline.
    return subprocess.run(args, capture_output=True, text=True, **kwargs)


def _extract_frames(media: Path, frames_dir: Path) -> list[Path]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    result = _run([
        str(config.FFMPEG), "-nostdin", "-y", "-loglevel", "error",
        "-i", str(media),
        "-vf", f"fps={CANDIDATE_FPS},scale={FRAME_WIDTH}:-2",
        "-frames:v", str(MAX_CANDIDATES),
        "-q:v", "3",
        str(frames_dir / "f%04d.jpg"),
    ])
    if result.returncode != 0:
        return []
    return sorted(frames_dir.glob("f*.jpg"))


def _thumbnails(frames: list[Path], workdir: Path) -> list[bytes] | None:
    """One tiny grayscale thumbnail per frame, for the dedup comparison.

    A single ffmpeg call over the frame sequence, then pure stdlib. Returns None
    if the sizes do not line up, which makes the caller skip dedup rather than
    compare garbage.
    """
    raw = workdir / "dedup.gray"
    result = _run([
        str(config.FFMPEG), "-nostdin", "-y", "-loglevel", "error",
        "-i", str(frames[0].parent / "f%04d.jpg"),
        "-vf", f"scale={DEDUP_SIZE}:{DEDUP_SIZE}",
        "-pix_fmt", "gray", "-f", "rawvideo", str(raw),
    ])
    if result.returncode != 0 or not raw.exists():
        return None
    data = raw.read_bytes()
    raw.unlink(missing_ok=True)
    stride = DEDUP_SIZE * DEDUP_SIZE
    if len(data) != stride * len(frames):
        return None
    return [data[i * stride:(i + 1) * stride] for i in range(len(frames))]


def _distinct(frames: list[Path], thumbs: list[bytes] | None) -> list[int]:
    """Indices of frames worth reading.

    Compares against the last frame *kept*, not the previous one. A slow fade
    never trips a frame-to-frame threshold but drifts well past it over a few
    seconds, and that drift is usually a new text card arriving.
    """
    if not thumbs:
        return list(range(len(frames)))
    kept = [0]
    reference = thumbs[0]
    for i in range(1, len(thumbs)):
        current = thumbs[i]
        delta = sum(abs(a - b) for a, b in zip(reference, current)) / len(current)
        if delta > DEDUP_THRESHOLD:
            kept.append(i)
            reference = current
    return kept


def _ocr(paths: list[Path]) -> dict[Path, str]:
    if not paths:
        return {}
    result = _run([str(config.OCR_TEXT), *[str(p) for p in paths]])
    if result.returncode != 0:
        return {}
    out: dict[Path, str] = {}
    for line in result.stdout.splitlines():
        path, _, text = line.partition("\t")
        if text in ("ERR_LOAD", "ERR_VISION"):
            continue
        if text.strip():
            out[Path(path)] = text.strip()
    return out


def _normalise(text: str) -> str:
    """Comparison form: letters and digits only, lowercased."""
    return "".join(ch for ch in text.lower() if ch.isalnum())


def _dedupe_runs(captions: list[Caption]) -> list[Caption]:
    """Collapse repeat readings of the same card into one caption.

    Pixel dedup does not do this job. It keeps a frame whenever the *picture*
    changes, and in a talking-to-camera reel the person moves constantly while
    the text card holds — so a card that never changes is read on nearly every
    frame. Measured on the library sample: one held POV card came back four
    times as `big -`, `big`, `big >`, `big>»`, which is OCR jitter on the same
    string, not four captions.

    So the collapse happens on the text. Two readings belong to the same card
    when one normalises to a prefix of the other (progressive reveal, or a
    truncated read) or when they are ~85% similar. The longest variant wins,
    because the jitter is nearly always something dropped off the end.
    """
    out: list[Caption] = []
    for caption in captions:
        if not out:
            out.append(caption)
            continue
        previous = out[-1]
        a, b = _normalise(previous.text), _normalise(caption.text)
        if not a or not b:
            out.append(caption)
            continue
        same = a.startswith(b) or b.startswith(a)
        if not same:
            same = SequenceMatcher(None, a, b).ratio() >= SAME_CARD_RATIO
        if same:
            # Keep the fuller reading, but the timestamp of its first sighting.
            if len(caption.text) > len(previous.text):
                out[-1] = Caption(t=previous.t, text=caption.text)
            continue
        out.append(caption)
    return out


def analyze(media: Path, workdir: Path, *, duration: float | None = None) -> dict:
    """Read the text on screen. Always returns a report; never raises."""
    blank = {"checked": False, "captions": (), "text": "", "frames_read": 0,
             "candidates": 0}
    if not available():
        return blank
    try:
        frames_dir = workdir / "frames"
        frames = _extract_frames(media, frames_dir)
        if not frames:
            # A file ffmpeg cannot pull a single frame out of. Nothing looked.
            return blank

        thumbs = _thumbnails(frames, workdir)
        keep = _distinct(frames, thumbs)
        found = _ocr([frames[i] for i in keep])

        captions = _dedupe_runs([
            Caption(t=round(i / CANDIDATE_FPS, 2), text=found[frames[i]])
            for i in keep if frames[i] in found
        ])

        return {
            "checked": True,
            "captions": tuple(captions),
            "text": " ".join(caption.text for caption in captions),
            "frames_read": len(keep),
            "candidates": len(frames),
        }
    except Exception:
        # Deliberately broad. This stage is an enrichment; nothing it can do
        # justifies failing a job that already has a video and a transcript.
        return blank
    finally:
        # The frames were only ever scratch for the OCR pass.
        for stray in (workdir / "frames").glob("f*.jpg"):
            stray.unlink(missing_ok=True)
