import MediaFeed from '@/components/platform/MediaFeed'

/** The platform rail's first feed: the OFMPro Instagram import, drawn as
 *  the reference's card grid. Data comes from the trimmed asset at
 *  public/instagram/medias.json (scripts/import-ofmpro.mjs instagram). */
export default function InstagramPage() {
  return (
    <MediaFeed
      platform="instagram"
      label="Instagram"
      dataUrl="/instagram/medias.json"
      unit="videos"
    />
  )
}
