#!/usr/bin/env bash
# Rebuild the whole toolchain from scratch (no Homebrew, no sudo, no API keys).
# Safe to re-run: it skips anything already in place.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

YTDLP_VERSION="2026.08.19"
FFMPEG_VERSION="b6.1.1"
CMAKE_VERSION="4.4.3"

mkdir -p vendor/bin vendor/models inbox out

fetch() { # url dest
  [ -s "$2" ] || { echo "  downloading $(basename "$2")"; curl -fsSL -o "$2" "$1"; }
}

echo "==> binaries"
fetch "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_macos" vendor/bin/yt-dlp
fetch "https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_VERSION}/ffmpeg-darwin-arm64" vendor/bin/ffmpeg
fetch "https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_VERSION}/ffprobe-darwin-arm64" vendor/bin/ffprobe
chmod +x vendor/bin/yt-dlp vendor/bin/ffmpeg vendor/bin/ffprobe

# cloudflared publishes the local video server so the hosted library can play
# clips that never leave this Mac. Ships as a tarball rather than a bare binary.
if [ ! -x vendor/bin/cloudflared ]; then
  echo "  downloading cloudflared"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz" \
    | tar xz -C vendor/bin
  chmod +x vendor/bin/cloudflared
fi

echo "==> whisper models"
fetch "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin" vendor/models/ggml-large-v3-turbo-q5_0.bin
fetch "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin" vendor/models/ggml-base-q5_1.bin
fetch "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin" vendor/models/ggml-silero-v5.1.2.bin

echo "==> speaker models"
fetch "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_large.onnx" vendor/models/nemo_en_titanet_large.onnx
if [ ! -d vendor/models/sherpa-onnx-pyannote-segmentation-3-0 ]; then
  fetch "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2" vendor/models/seg.tar.bz2
  tar xjf vendor/models/seg.tar.bz2 -C vendor/models && rm -f vendor/models/seg.tar.bz2
fi

echo "==> whisper.cpp (Metal)"
if [ ! -x vendor/whisper.cpp/build/bin/whisper-cli ]; then
  if ! command -v cmake >/dev/null 2>&1 && [ ! -x vendor/cmake/CMake.app/Contents/bin/cmake ]; then
    echo "  fetching cmake"
    mkdir -p vendor/cmake
    curl -fsSL "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-macos-universal.tar.gz" \
      | tar xz -C vendor/cmake --strip-components=1
  fi
  export PATH="$ROOT/vendor/cmake/CMake.app/Contents/bin:$PATH"
  [ -d vendor/whisper.cpp ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git vendor/whisper.cpp
  cmake -S vendor/whisper.cpp -B vendor/whisper.cpp/build \
    -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF >/dev/null
  cmake --build vendor/whisper.cpp/build --config Release -j "$(sysctl -n hw.ncpu)" >/dev/null
fi

echo "==> on-screen text OCR (Apple Vision)"
# Reads text burned into the frame, on-device, no account and no API key —
# the only hook signal the ~29% of the corpus that never speaks carries.
# swiftc ships with the Xcode command line tools; if they are absent the
# visual pass simply does not run and everything else works unchanged.
if [ ! -x vendor/bin/ocr-text ] || [ src/ocr/ocr.swift -nt vendor/bin/ocr-text ]; then
  if command -v swiftc >/dev/null 2>&1; then
    mkdir -p vendor/bin
    swiftc -O src/ocr/ocr.swift -o vendor/bin/ocr-text
  else
    echo "  swiftc not found — skipping (run: xcode-select --install)"
  fi
fi
# Same for the picture reader: faces, bodies and scene labels per frame
# (src/shots.py). Also Apple Vision, also on-device.
if [ ! -x vendor/bin/look-frame ] || [ src/look/look.swift -nt vendor/bin/look-frame ]; then
  if command -v swiftc >/dev/null 2>&1; then
    mkdir -p vendor/bin
    swiftc -O src/look/look.swift -o vendor/bin/look-frame
  else
    echo "  swiftc not found — skipping (run: xcode-select --install)"
  fi
fi

echo "==> python env"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet sherpa-onnx numpy

echo
echo "Ready. Try:  ./bin/transcribe <instagram-or-tiktok-url>"
