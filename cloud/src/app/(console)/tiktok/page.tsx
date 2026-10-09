import MediaFeed from '@/components/platform/MediaFeed'

/** TikTok's feed: OFMPro's tracked media, served from transcriber.ofmpro_media
 *  by /api/ofmpro/tiktok. */
export default function TikTokPage() {
  return (
    <MediaFeed
      platform="tiktok"
      label="TikTok"
      dataUrl="/api/ofmpro/tiktok"
      unit="videos"
    />
  )
}
