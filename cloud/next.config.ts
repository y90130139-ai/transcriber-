import type { NextConfig } from 'next'

const config: NextConfig = {
  // Transcripts are the payload; a long one can run past the default cap.
  experimental: { serverActions: { bodySizeLimit: '8mb' } },
}

export default config
