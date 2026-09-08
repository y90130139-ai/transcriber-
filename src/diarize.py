"""Offline speaker diarization (who spoke when) via sherpa-onnx.

Runs entirely on-device with the pyannote segmentation model plus a NeMo TitaNet
speaker-embedding model. No account, no token, no network call.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config
from .audio import read_wav


@dataclass(frozen=True)
class Turn:
    start: float
    end: float
    speaker: int


def available() -> bool:
    return config.SEGMENTATION_MODEL.exists() and config.EMBEDDING_MODEL.exists()


def _build(num_speakers: int | None):
    import sherpa_onnx

    clustering = (
        sherpa_onnx.FastClusteringConfig(num_clusters=num_speakers)
        if num_speakers
        else sherpa_onnx.FastClusteringConfig(threshold=config.SPEAKER_THRESHOLD)
    )
    settings = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(config.SEGMENTATION_MODEL)
            ),
            num_threads=config.ASR_THREADS,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(config.EMBEDDING_MODEL), num_threads=config.ASR_THREADS
        ),
        clustering=clustering,
        min_duration_on=config.MIN_SPEECH_ON,
        min_duration_off=config.MIN_SILENCE_OFF,
    )
    if not settings.validate():
        raise RuntimeError("diarization config rejected by sherpa-onnx")
    return sherpa_onnx.OfflineSpeakerDiarization(settings)


def diarize(wav: Path, *, num_speakers: int | None = None) -> tuple[Turn, ...]:
    """Return speaker turns sorted by start time. Empty tuple if models are absent."""
    if not available():
        return ()
    samples = read_wav(wav)
    if samples.size < config.SAMPLE_RATE // 2:
        return ()
    engine = _build(num_speakers)
    result = engine.process(samples).sort_by_start_time()
    return tuple(
        Turn(start=round(s.start, 3), end=round(s.end, 3), speaker=int(s.speaker))
        for s in result
    )


def samples_for_speaker(
    samples: np.ndarray, turns: tuple[Turn, ...], speaker: int, *, max_seconds: float = 20.0
) -> np.ndarray:
    """Concatenate up to max_seconds of one speaker's audio, for voice analysis."""
    chunks: list[np.ndarray] = []
    collected = 0.0
    for turn in turns:
        if turn.speaker != speaker:
            continue
        start = int(turn.start * config.SAMPLE_RATE)
        end = min(int(turn.end * config.SAMPLE_RATE), samples.size)
        if end <= start:
            continue
        chunks.append(samples[start:end])
        collected += (end - start) / config.SAMPLE_RATE
        if collected >= max_seconds:
            break
    return np.concatenate(chunks) if chunks else np.empty(0, dtype=np.float32)
