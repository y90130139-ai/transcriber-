import type { Metadata } from 'next'
import MediaFeed from '@/components/platform/MediaFeed'

/**
 * X's feed: OFMPro's tracked media — videos, pictures and slideshows — served
 * from transcriber.ofmpro_media by /api/ofmpro/twitter.
 *
 * `no-referrer` is load-bearing. video.twimg.com answers 200 when the request
 * carries no Referer, and 403 when it carries any other origin — the
 * dashboard included. The document policy covers a full load of this page.
 * Each <video> also sets referrerPolicy, because a client navigation keeps
 * the policy of whichever page was loaded first, and that 403 is what the
 * card was calling "link expired".
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
