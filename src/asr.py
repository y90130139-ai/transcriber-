"""Speech recognition via a locally built whisper.cpp (Metal-accelerated)."""
from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from . import config
from .util import run


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str
    speaker: str | None = None

    def with_speaker(self, speaker: str | None) -> "Segment":
        return Segment(self.start, self.end, self.text, speaker)


@dataclass(frozen=True)
class Transcript:
    language: str
    segments: tuple[Segment, ...]
    model: str

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.segments).strip()


def clean_text(raw: str) -> str:
    """Drop invisible format/control characters and collapse whitespace.

    Byte-level BPE can emit zero-width and directional-formatting codepoints that
    are invisible in a terminal but corrupt downstream search and diffing.
    """
    kept = [ch for ch in raw if unicodedata.category(ch) not in ("Cf", "Cc")]
    return " ".join("".join(kept).split())


def transcribe(
    wav: Path,
    *,
    workdir: Path,
    model_key: str = "best",
    language: str = "auto",
) -> Transcript:
    model = config.ASR_MODELS[model_key]
    if not model.exists():
        raise RuntimeError(f"missing ASR model: {model}")

    prefix = workdir / "whisper"
    cmd = [
        config.WHISPER_CLI,
        "-m", model,
        "-f", wav,
        "-l", language,
        "-t", str(config.ASR_THREADS),
        "-ml", str(config.MAX_SEGMENT_CHARS),
        "-sow",
        "-oj", "-of", prefix,
        "-np",
    ]
    # Deliberately no --prompt: feeding the post caption in as an initial prompt
    # was measurably harmful. Emoji- and quote-heavy captions pushed the decoder
    # toward exotic codepoints and, on one clip, collapsed the whole output to a
    # single quote character. The caption still ships in the transcript metadata.
    if config.VAD_MODEL.exists():
        # VAD keeps whisper from hallucinating lyrics over music-only stretches,
        # which is the single most common failure on Reels and TikToks.
        cmd += ["--vad", "-vm", config.VAD_MODEL]

    run(cmd)

    payload_path = prefix.with_suffix(".json")
    if not payload_path.exists():
        raise RuntimeError("whisper produced no JSON output")
    payload = json.loads(payload_path.read_text())
    payload_path.unlink()

    segments = []
    for item in payload.get("transcription", []):
        text = clean_text(item.get("text", ""))
        if not text:
            continue
        segments.append(
            Segment(
                start=item["offsets"]["from"] / 1000.0,
                end=item["offsets"]["to"] / 1000.0,
                text=text,
            )
        )
    detected = (payload.get("result") or {}).get("language") or language
    return Transcript(language=detected, segments=tuple(segments), model=model.name)
