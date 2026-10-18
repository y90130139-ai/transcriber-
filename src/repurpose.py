"""Turn one of her reels into a brand-new video (repo: docs/REPURPOSE.md).

The ♻ button used to mean "marked" — a person then downloaded the reel and
drove the Video Batcher by hand. This is the studio pass that makes the promise
true automatically. Recipe `fresh-v1`, every value derived from one seed:

  - hflip                mirror — the single strongest break against a
                         perceptual match of the original
  - centre crop 93–97%   the framing is not the framing Instagram saw
  - eq / hue             ±2% brightness, ±5% contrast, ±6% saturation, ±3° hue
  - noise                grain on every frame, luma and chroma
  - speed 1.012–1.03     `setpts` + matching `atempo` — the audio timeline the
                         original was fingerprinted on no longer exists
  - head/tail trim       the first and last frames are not the same frames
  - re-encode            libx264 CRF 20–24, AAC 128k, faststart
  - metadata             `-map_metadata -1`, a fresh creation_time, no encoder
                         tag — nothing of the original container survives

Two renders of the same reel with different seeds do not match each other
either. The render lives here, beside the ffmpeg it drives, because the Mac is
the machine holding the videos, the codecs and the R2 credentials; the cloud
queues the work and presigns the result (lib/repurpose.ts, worker.py).
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config, media
from .util import run

RECIPE = "fresh-v1"

# A clip repackaged on a laptop; generous because a slow machine still beats a
# timed-out job, and the Mac works through one render at a time anyway.
RENDER_TIMEOUT_SEC = 900.0

# Creation times land deterministically inside this window (2026-01-01 on),
# so the stamp is fresh and plausible but never follows "today" around.
CREATION_ANCHOR = datetime(2026, 1, 1, tzinfo=timezone.utc)
CREATION_WINDOW_DAYS = 270

# Below this the trim is skipped: taking frames off a 4-second reel risks
# removing the hook the whole repost is for.
MIN_TRIM_SECONDS = 6.0


def _creation_time(seed: int) -> str:
    span = seed % CREATION_WINDOW_DAYS
    hours = (seed >> 7) % 24
    minutes = (seed >> 12) % 60
    stamp = CREATION_ANCHOR + timedelta(days=span, hours=hours, minutes=minutes)
    return stamp.strftime("%Y-%m-%dT%H:%M:%SZ")


def _plan(seed: int, duration: float | None) -> dict:
    """Every jitter this render will apply, as plain numbers. Pure, so the
    shape of a recipe can be read (and tested) without running ffmpeg."""
    rng = random.Random(seed)
    plan = {
        "crop": round(rng.uniform(0.93, 0.97), 4),
        # ffmpeg's eq: the identity for contrast and saturation is 1.0, not 0.
        # Centred here on purpose — a "0.02 contrast" flattens the frame to
        # flat grey and the file to nothing (caught by the live test,
        # 2026-10-18). Brightness is the delta one, and it is centred on 0.
        "brightness": round(rng.uniform(-0.02, 0.02), 4),
        "contrast": round(1 + rng.uniform(-0.05, 0.05), 4),
        "saturation": round(1 + rng.uniform(-0.06, 0.06), 4),
        "hue": round(rng.uniform(-3.0, 3.0), 3),
        "grain": rng.randint(3, 7),
        "speed": round(rng.uniform(1.012, 1.03), 5),
        "crf": rng.randint(20, 24),
        "start": 0.0,
        "end": None,
    }
    if duration and duration > MIN_TRIM_SECONDS:
        plan["start"] = round(rng.uniform(0.05, 0.2), 3)
        tail = rng.uniform(0.05, 0.2)
        plan["end"] = round((duration - plan["start"] - tail) / plan["speed"], 3)
    return plan


def build_render_args(source: Path, destination: Path, seed: int,
                      duration: float | None = None) -> list[str]:
    """The ffmpeg argument list for one seed. Pure apart from the clock-free
    creation stamp, so it can be asserted on in tests."""
    if duration is None:
        duration = media.probe_duration(source)
    plan = _plan(seed, duration)

    filters = ",".join([
        "hflip",
        f"crop=iw*{plan['crop']}:ih*{plan['crop']}",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        f"eq=brightness={plan['brightness']}:contrast={plan['contrast']}:saturation={plan['saturation']}",
        f"hue=h={plan['hue']}",
        f"noise=alls={plan['grain']}:allf=t+u",
        f"setpts=PTS/{plan['speed']}",
    ])
    args = ["-y", "-loglevel", "error"]
    if plan["start"]:
        args += ["-ss", f"{plan['start']:.3f}"]
    args += [
        "-i", str(source),
        "-vf", filters,
        "-af", f"atempo={plan['speed']}",
    ]
    if plan["end"]:
        args += ["-t", f"{plan['end']:.3f}"]
    args += [
        # Nothing of the original container survives: no source tags, no GPS,
        # no encoder line, and a creation time that belongs to this cut.
        "-map_metadata", "-1",
        "-metadata", f"creation_time={_creation_time(seed)}",
        "-c:v", "libx264", "-preset", "medium", "-crf", str(plan["crf"]),
        "-pix_fmt", "yuv420p", "-profile:v", "high",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(destination),
    ]
    return args


def render(source: Path, destination: Path, seed: int, log=print) -> dict:
    """Render one fresh copy. Returns the facts the cloud records."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    run([config.FFMPEG, *build_render_args(source, destination, seed)],
        timeout=RENDER_TIMEOUT_SEC)
    if not destination.exists() or destination.stat().st_size == 0:
        raise RuntimeError("the repurpose render produced an empty file")
    bytes_out = destination.stat().st_size
    log(f"repurpose {RECIPE} seed {seed}: {bytes_out / 1e6:.1f} MB")
    return {"bytes": bytes_out, "recipe": RECIPE, "seed": seed}
