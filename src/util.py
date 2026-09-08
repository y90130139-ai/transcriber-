"""Small shared helpers: process running, slugs, timestamp formatting."""
from __future__ import annotations

import re
import subprocess
import unicodedata
from pathlib import Path
from typing import Sequence

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def run(
    cmd: Sequence[str],
    *,
    cwd: Path | None = None,
    quiet: bool = True,
    timeout: float | None = None,
) -> str:
    """Run a command, returning stdout. Raises RuntimeError with context on failure.

    `timeout` guards against commands that can wedge indefinitely rather than
    fail — notably yt-dlp's browser-cookie reader, which blocks forever when the
    browser holds a lock on its cookie store.
    """
    try:
        proc = subprocess.run(
            [str(c) for c in cmd],
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE if quiet else None,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"command timed out after {timeout:g}s: "
            f"{' '.join(str(c) for c in cmd[:3])}..."
        ) from exc
    if proc.returncode != 0:
        detail = (proc.stderr or "").strip().splitlines()[-12:]
        raise RuntimeError(
            f"command failed ({proc.returncode}): {' '.join(str(c) for c in cmd[:3])}...\n"
            + "\n".join(detail)
        )
    return proc.stdout


def slugify(text: str, *, max_len: int = 60) -> str:
    """ASCII, lowercase, hyphenated slug safe for directory names."""
    normalized = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    slug = _SLUG_STRIP.sub("-", normalized.lower()).strip("-")
    return slug[:max_len].strip("-") or "untitled"


def fmt_clock(seconds: float) -> str:
    """Seconds -> M:SS or H:MM:SS, for human-facing transcripts."""
    total = int(seconds)
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def fmt_subtitle_time(seconds: float, *, comma: bool) -> str:
    """Seconds -> SRT (comma) or WebVTT (dot) timestamp."""
    millis = max(0, int(round(seconds * 1000)))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    sep = "," if comma else "."
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{sep}{millis:03d}"
