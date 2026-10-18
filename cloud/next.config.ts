import type { NextConfig } from 'next'

const config: NextConfig = {
  // Transcripts are the payload; a long one can run past the default cap.
  experimental: { serverActions: { bodySizeLimit: '8mb' } },

  turbopack: {
    resolveAlias: {
      // The Video Batcher's ffmpeg wrapper is vendored (src/vendor/ffmpeg,
      // 2026-10-18): upstream's dynamic `new URL(classWorkerURL, ...)` branch
      // is a hard Turbopack resolution failure, and the app never uses it.
      '@ffmpeg/ffmpeg': './src/vendor/ffmpeg/index.js',
    },
  },
}

export default config
