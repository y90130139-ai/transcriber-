"""Per-speaker profiles: talk time, share of the video, and a relative pitch label."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from . import diarize as diarize_mod
from .audio import read_wav
from .diarize import Turn
from .merge import label_for
from .voice import median_f0, relative_labels


@dataclass(frozen=True)
class SpeakerProfile:
    label: str
    talk_seconds: float
    share: float
    median_f0: float | None
    voice: str | None

    def as_dict(self) -> dict:
        return {
            "label": self.label,
            "talk_seconds": self.talk_seconds,
            "share": self.share,
            "median_f0_hz": self.median_f0,
            "relative_pitch": self.voice,
        }


def build_profiles(
    wav: Path, turns: tuple[Turn, ...], order: dict[int, int]
) -> tuple[SpeakerProfile, ...]:
    if not turns or not order:
        return ()
    samples = read_wav(wav)

    totals = {raw: 0.0 for raw in order}
    for turn in turns:
        if turn.speaker in totals:
            totals[turn.speaker] += turn.end - turn.start
    speech_total = sum(totals.values()) or 1.0

    ranked = sorted(order.items(), key=lambda kv: kv[1])
    pitches = {
        label_for(display): median_f0(diarize_mod.samples_for_speaker(samples, turns, raw))
        for raw, display in ranked
    }
    labels = relative_labels(pitches)

    return tuple(
        SpeakerProfile(
            label=label_for(display),
            talk_seconds=round(totals[raw], 1),
            share=round(totals[raw] / speech_total, 3),
            median_f0=pitches[label_for(display)],
            voice=labels[label_for(display)],
        )
        for raw, display in ranked
    )
