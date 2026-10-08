import type { Metadata } from 'next'
import MediaFeed from '@/components/platform/MediaFeed'

/**
 * X's feed: the OFMPro import — videos, pictures and slideshows — drawn
 * as the reference's card grid. Data comes from the trimmed asset at
 * public/twitter/medias.json (scripts/import-ofmpro.mjs twitter).
 *
 * `no-referrer` is load-bearing, not hygiene: video.twimg.com serves 403 to
 * any referer that is not twitter.com / x.com (localhost included), and the
 * referrer policy of the document is the only lever a <video> request has —
 * media elements do not take a per-element referrerpolicy. With the header
 * suppressed, the CDN answers 206 like it does for curl.
 */
export const metadata: Metadata = { referrer: 'no-referrer' }

export default function TwitterPage() {
  return (
    <MediaFeed
      platform="x"
      label="Twitter / X"
      dataUrl="/twitter/medias.json"
      unit="posts"
    />
  )
}
