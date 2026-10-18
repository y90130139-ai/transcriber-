'use client'

import { useState } from 'react'
import { thumbUrl } from '@/lib/format'

type Props = {
  jobId: string | null | undefined
  hasThumb: boolean
  previewVideoUrl?: string | null
  className?: string
  blankClassName?: string
  blank?: string
  width: number
  height: number
}

/** Cover frame for a plan card — waits until its thumbnail is ready. */
export default function CoverThumb({
  jobId, hasThumb, previewVideoUrl, className, blankClassName, blank, width, height,
}: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = jobId ? thumbUrl(jobId) : null
  const videoUrl = previewVideoUrl
    ? previewVideoUrl.includes('#') ? previewVideoUrl : `${previewVideoUrl}#t=0.001`
    : null
  const previewUrl = !hasThumb && videoUrl ? videoUrl : null
  // A newly queued link has a job id before its transcript and poster frame
  // exist. Do not request the thumbnail endpoint until the plan read confirms
  // one is ready — an early 404 used to leave the image blank for the life of
  // the card, even after Instagram/TikTok/X finished downloading.
  if (previewUrl && failedUrl !== previewUrl) {
    return (
      <video
        className={className}
        src={previewUrl}
        muted
        autoPlay
        playsInline
        preload="metadata"
        onLoadedData={(event) => event.currentTarget.pause()}
        onError={() => setFailedUrl(previewUrl)}
        aria-hidden="true"
      />
    )
  }
  if (!url || !hasThumb || failedUrl === url) {
    return (
      <span className={blankClassName} aria-hidden="true">
        {blank ?? null}
      </span>
    )
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      className={className}
      src={url}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      onError={() => setFailedUrl(url)}
    />
  )
}
