"""Read the pipeline's 16 kHz mono WAV into float32 samples (no extra deps)."""
from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

from . import config


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as handle:
        if handle.getframerate() != config.SAMPLE_RATE or handle.getnchannels() != 1:
            raise RuntimeError(
                f"expected {config.SAMPLE_RATE} Hz mono, got "
                f"{handle.getframerate()} Hz / {handle.getnchannels()}ch"
            )
        raw = handle.readframes(handle.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
