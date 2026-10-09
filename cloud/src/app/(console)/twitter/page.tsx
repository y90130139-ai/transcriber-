import type { Metadata } from 'next'
import MediaFeed from '@/components/platform/MediaFeed'

/**
 * X's feed: OFMPro's tracked media — videos, pictures and slideshows — served
 * from transcriber.ofmpro_media by /api/ofmpro/twitter.
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
      dataUrl="/api/ofmpro/twitter"
      unit="posts"
    />
  )
}
