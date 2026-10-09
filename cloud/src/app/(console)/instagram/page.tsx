import MediaFeed from '@/components/platform/MediaFeed'

/** The platform rail's first feed: OFMPro's tracked Instagram media, served
 *  from transcriber.ofmpro_media by /api/ofmpro/instagram (the worker owns
 *  the table; the old public/instagram/medias.json is its backfill). */
export default function InstagramPage() {
  return (
    <MediaFeed
      platform="instagram"
      label="Instagram"
      dataUrl="/api/ofmpro/instagram"
      unit="videos"
    />
  )
}
