"""Per-speaker pitch measurement, used to tell voices apart in a transcript.

Deliberately limited to *relative* pitch within a single recording. Absolute
inference of a speaker's sex from pitch does not survive contact with social
media audio: clips are commonly sped up on repost (which shifts pitch upward),
heavily compressed, and low-passed. On our reference clips an elderly male
speaker measured 216 Hz, which any absolute threshold would call female.
Ranking speakers against each other inside one recording is robust, because
every voice in it shares the same codec and playback speed.
"""
from __future__ import annotations

import numpy as np

from . import config

FRAME = int(0.04 * config.SAMPLE_RATE)
HOP = int(0.02 * config.SAMPLE_RATE)
MIN_F0, MAX_F0 = 70, 350
MIN_LAG = config.SAMPLE_RATE // MAX_F0
MAX_LAG = config.SAMPLE_RATE // MIN_F0
SILENCE_RMS = 0.01
VOICED_PEAK = 0.35
MIN_VOICED_FRAMES = 8


def median_f0(samples: np.ndarray) -> float | None:
    """Autocorrelation pitch tracker over voiced frames; None when too little signal."""
    if samples.size < FRAME * 2:
        return None
    pitches: list[float] = []
    for start in range(0, samples.size - FRAME, HOP):
        window = samples[start : start + FRAME]
        if float(np.sqrt(np.mean(window**2))) < SILENCE_RMS:
            continue
        centered = window - window.mean()
        correlation = np.correlate(centered, centered, mode="full")[FRAME - 1 :]
        if correlation[0] <= 0:
            continue
        candidates = correlation[MIN_LAG:MAX_LAG]
        if candidates.size == 0:
            continue
        lag = int(np.argmax(candidates)) + MIN_LAG
        if correlation[lag] / correlation[0] < VOICED_PEAK:
            continue
        pitches.append(config.SAMPLE_RATE / lag)
    if len(pitches) < MIN_VOICED_FRAMES:
        return None
    return round(float(np.median(pitches)), 1)


def relative_labels(pitches: dict[str, float | None]) -> dict[str, str | None]:
    """Describe each speaker's pitch relative to the others in the same video."""
    measured = {label: hz for label, hz in pitches.items() if hz is not None}
    if len(measured) < 2:
        return {label: None for label in pitches}

    ranked = sorted(measured.items(), key=lambda kv: kv[1])
    lowest, highest = ranked[0][1], ranked[-1][1]
    if highest - lowest < config.MIN_PITCH_GAP_HZ:
        return {label: ("similar pitch" if label in measured else None) for label in pitches}

    if len(ranked) == 2:
        names = ["lower voice", "higher voice"]
    else:
        names = ["lowest voice"] + ["mid-range voice"] * (len(ranked) - 2) + ["highest voice"]

    labels: dict[str, str | None] = {label: None for label in pitches}
    for (label, _), name in zip(ranked, names):
        labels[label] = name
    return labels
