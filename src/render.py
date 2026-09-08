"""Write the transcript out in every format we support."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .asr import Segment, Transcript
from .merge import Block
from .speakers import SpeakerProfile
from .util import fmt_clock, fmt_subtitle_time


@dataclass(frozen=True)
class Result:
    meta: dict
    transcript: Transcript
    segments: tuple[Segment, ...]
    blocks: tuple[Block, ...]
    profiles: tuple[SpeakerProfile, ...]
    created_at: str
    # What the speech pass found, as opposed to what was asked for. `checked`
    # is False when no pass ran at all (no audio track), which is a different
    # statement from "listened, heard nobody".
    speech: dict = field(default_factory=dict)
    # What the screen showed. Same `checked` convention as speech above: False
    # means no visual pass ran at all.
    visual: dict = field(default_factory=dict)


def _header_lines(result: Result) -> list[str]:
    meta = result.meta
    duration = meta.get("duration_sec")
    speaker_count = len(result.profiles)
    rows = [
        ("Source", meta.get("webpage_url") or meta.get("source")),
        ("Platform", meta.get("platform")),
        ("Creator", f"@{meta['author']}" if meta.get("author") else None),
        ("Posted", meta.get("upload_date")),
        ("Duration", fmt_clock(duration) if duration else None),
        ("Language", result.transcript.language),
        ("Speakers", f"{speaker_count} detected" if speaker_count else "not separated"),
        ("Model", f"whisper.cpp / {result.transcript.model} (local)"),
        ("Transcribed", result.created_at),
    ]
    return [f"- **{name}:** {value}" for name, value in rows if value]


def _speaker_table(profiles: tuple[SpeakerProfile, ...]) -> list[str]:
    if not profiles:
        return []
    lines = [
        "",
        "## Speakers",
        "",
        "| Label | Talk time | Share | Pitch (relative to this video) |",
        "| --- | --- | --- | --- |",
    ]
    for profile in profiles:
        voice = profile.voice or "not comparable"
        pitch = f" ({profile.median_f0:.0f} Hz)" if profile.median_f0 else ""
        lines.append(
            f"| {profile.label} | {fmt_clock(profile.talk_seconds)} "
            f"| {profile.share * 100:.0f}% | {voice}{pitch} |"
        )
    return lines


def write_markdown(result: Result, path: Path) -> Path:
    meta = result.meta
    lines = [f"# {meta.get('title') or 'Untitled'}", ""]
    lines += _header_lines(result)
    lines += _speaker_table(result.profiles)

    caption = meta.get("caption")
    if caption:
        lines += ["", "## Caption", ""]
        lines += [f"> {line}" if line.strip() else ">" for line in caption.splitlines()]

    lines += ["", "## Transcript", ""]
    if not result.blocks:
        lines.append("_No speech detected in this video._")
    for block in result.blocks:
        who = block.speaker or "Speech"
        lines.append(f"**{who}** · {fmt_clock(block.start)}")
        lines.append("")
        lines.append(block.text)
        lines.append("")

    path.write_text("\n".join(lines).rstrip() + "\n")
    return path


def write_text(result: Result, path: Path) -> Path:
    lines = []
    for block in result.blocks:
        prefix = f"{block.speaker}: " if block.speaker else ""
        lines.append(f"[{fmt_clock(block.start)}] {prefix}{block.text}")
    path.write_text("\n\n".join(lines).strip() + "\n")
    return path


def _subtitle(result: Result, path: Path, *, vtt: bool) -> Path:
    lines = ["WEBVTT", ""] if vtt else []
    for index, segment in enumerate(result.segments, start=1):
        if not vtt:
            lines.append(str(index))
        lines.append(
            f"{fmt_subtitle_time(segment.start, comma=not vtt)} --> "
            f"{fmt_subtitle_time(segment.end, comma=not vtt)}"
        )
        prefix = f"{segment.speaker}: " if segment.speaker else ""
        lines.append(f"{prefix}{segment.text}")
        lines.append("")
    path.write_text("\n".join(lines))
    return path


def write_srt(result: Result, path: Path) -> Path:
    return _subtitle(result, path, vtt=False)


def write_vtt(result: Result, path: Path) -> Path:
    return _subtitle(result, path, vtt=True)


def write_json(result: Result, path: Path) -> Path:
    payload = {
        "meta": result.meta,
        "transcribed_at": result.created_at,
        "language": result.transcript.language,
        "model": result.transcript.model,
        "speakers": [p.as_dict() for p in result.profiles],
        "blocks": [
            {"speaker": b.speaker, "start": b.start, "end": b.end, "text": b.text}
            for b in result.blocks
        ],
        "segments": [
            {"speaker": s.speaker, "start": s.start, "end": s.end, "text": s.text}
            for s in result.segments
        ],
        "full_text": result.transcript.text,
        "speech": result.speech,
        "visual": result.visual,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    return path


WRITERS = {
    "md": ("transcript.md", write_markdown),
    "txt": ("transcript.txt", write_text),
    "srt": ("transcript.srt", write_srt),
    "vtt": ("transcript.vtt", write_vtt),
    "json": ("transcript.json", write_json),
}


def write_all(result: Result, outdir: Path, formats: tuple[str, ...]) -> list[Path]:
    written = []
    for key in formats:
        if key not in WRITERS:
            raise SystemExit(f"unknown format '{key}' (choose from {', '.join(WRITERS)})")
        filename, writer = WRITERS[key]
        written.append(writer(result, outdir / filename))
    return written


def now_stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")
