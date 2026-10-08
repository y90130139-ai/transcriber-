import MediaFeed from '@/components/platform/MediaFeed'

/** TikTok's feed: the OFMPro import, drawn as the reference's card grid.
 *  Data comes from the trimmed asset at public/tiktok/medias.json
 *  (scripts/import-ofmpro.mjs tiktok). */
export default function TikTokPage() {
  return (
    <MediaFeed
      platform="tiktok"
      label="TikTok"
      dataUrl="/tiktok/medias.json"
      unit="videos"
    />
  )
}
