"""Align ASR segments with diarizer turns, then regroup into readable speaker blocks."""
from __future__ import annotations

from dataclasses import dataclass

from .asr import Segment
from .diarize import Turn


@dataclass(frozen=True)
class Block:
    """A contiguous run of speech from one speaker."""

    speaker: str | None
    start: float
    end: float
    text: str


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def _best_speaker(segment: Segment, turns: tuple[Turn, ...]) -> int | None:
    """Speaker owning the most of this segment; falls back to the nearest turn."""
    scores: dict[int, float] = {}
    for turn in turns:
        shared = _overlap(segment.start, segment.end, turn.start, turn.end)
        if shared > 0:
            scores[turn.speaker] = scores.get(turn.speaker, 0.0) + shared
    if scores:
        return max(scores.items(), key=lambda kv: kv[1])[0]
    if not turns:
        return None
    center = (segment.start + segment.end) / 2
    nearest = min(turns, key=lambda t: min(abs(center - t.start), abs(center - t.end)))
    return nearest.speaker


def order_by_appearance(assignments: list[int | None]) -> dict[int, int]:
    """Renumber raw cluster ids so Speaker 1 is whoever talks first."""
    order: dict[int, int] = {}
    for raw in assignments:
        if raw is not None and raw not in order:
            order[raw] = len(order) + 1
    return order


def label_for(index: int) -> str:
    return f"Speaker {index}"


def assign_speakers(
    segments: tuple[Segment, ...], turns: tuple[Turn, ...]
) -> tuple[tuple[Segment, ...], dict[int, int]]:
    """Return segments tagged with display labels, plus the raw->display id map."""
    if not turns:
        return segments, {}
    raw = [_best_speaker(segment, turns) for segment in segments]
    order = order_by_appearance(raw)
    labeled = tuple(
        segment.with_speaker(label_for(order[value]) if value is not None else None)
        for segment, value in zip(segments, raw)
    )
    return labeled, order


def group_blocks(segments: tuple[Segment, ...], *, max_gap: float = 2.5) -> tuple[Block, ...]:
    """Merge consecutive same-speaker segments into paragraph-sized blocks."""
    blocks: list[Block] = []
    for segment in segments:
        previous = blocks[-1] if blocks else None
        same_speaker = previous is not None and previous.speaker == segment.speaker
        close_enough = previous is not None and segment.start - previous.end <= max_gap
        if previous is not None and same_speaker and close_enough:
            blocks[-1] = Block(
                speaker=previous.speaker,
                start=previous.start,
                end=segment.end,
                text=f"{previous.text} {segment.text}".strip(),
            )
            continue
        blocks.append(Block(segment.speaker, segment.start, segment.end, segment.text))
    return tuple(blocks)
