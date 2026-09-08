"""Paths, model registry, and tunable constants.

Everything the tool needs lives inside the project (vendor/), so there are no
system-wide dependencies and no API keys anywhere in the pipeline.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor"
BIN_DIR = VENDOR / "bin"
MODEL_DIR = VENDOR / "models"

YT_DLP = BIN_DIR / "yt-dlp"
CLOUDFLARED = BIN_DIR / "cloudflared"
FFMPEG = BIN_DIR / "ffmpeg"
FFPROBE = BIN_DIR / "ffprobe"
OCR_TEXT = BIN_DIR / "ocr-text"
WHISPER_CLI = VENDOR / "whisper.cpp" / "build" / "bin" / "whisper-cli"

ASR_MODELS = {
    "fast": MODEL_DIR / "ggml-base-q5_1.bin",
    "best": MODEL_DIR / "ggml-large-v3-turbo-q5_0.bin",
}
VAD_MODEL = MODEL_DIR / "ggml-silero-v5.1.2.bin"
SEGMENTATION_MODEL = MODEL_DIR / "sherpa-onnx-pyannote-segmentation-3-0" / "model.onnx"
EMBEDDING_MODEL = MODEL_DIR / "nemo_en_titanet_large.onnx"

DEFAULT_OUT_DIR = ROOT / "out"
INBOX_DIR = ROOT / "inbox"
USER_CONFIG = ROOT / "config.json"

SAMPLE_RATE = 16_000
ASR_THREADS = 8
# Short ASR segments give the speaker assigner something to work with; render.py
# merges consecutive same-speaker segments back into readable turns.
MAX_SEGMENT_CHARS = 80
# Clustering threshold, tuned on the sherpa 2- and 4-speaker reference clips:
# the 0.80-0.85 band scored 4/4; below 0.75 it over-splits, above 0.90 it merges.
SPEAKER_THRESHOLD = 0.82
MIN_SPEECH_ON = 0.3
MIN_SILENCE_OFF = 0.5
# Two speakers must differ by at least this much before we call one the lower
# voice; below it they are reported as similarly pitched.
MIN_PITCH_GAP_HZ = 15.0

DEFAULT_FORMATS = ("md", "txt", "srt", "vtt", "json")

# The media server binds loopback only; the tunnel is the sole way in.
MEDIA_PORT = 8788


def load_user_config() -> dict:
    """Read optional config.json (cookie source, defaults). Missing file is fine."""
    if not USER_CONFIG.exists():
        return {}
    try:
        return json.loads(USER_CONFIG.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise SystemExit(f"config.json is present but unreadable: {exc}")
