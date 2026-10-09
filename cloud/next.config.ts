import type { NextConfig } from 'next'

const config: NextConfig = {
  // Transcripts are the payload; a long one can run past the default cap.
  experimental: { serverActions: { bodySizeLimit: '8mb' } },
  async headers() {
    return [
      {
        // Video Batcher only. Cross-origin isolation is what unlocks
        // SharedArrayBuffer, which is what the multithreaded FFmpeg core needs
        // (§9). It is deliberately scoped to this one route so nothing else in
        // the console changes behaviour: COOP same-origin would sever
        // window.opener relationships with third-party pages, and COEP blocks
        // cross-origin subresources (credentialless keeps no-cors media and
        // images working without credentials). The batcher page embeds nothing
        // cross-origin, so this is safe here and nowhere else.
        source: '/video-batcher',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
      {
        // The FFmpeg cores are version-pinned by the vendored package, so they
        // can cache forever. The worker itself is ours and must revalidate.
        // Both carry COEP + CORP because a cross-origin isolated document
        // (the batcher page) requires embedded workers and scripts to declare
        // an embedder policy of their own.
        source: '/vb/ffmpeg/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
      {
        source: '/vb/vb-worker.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ]
  },
}

export default config
