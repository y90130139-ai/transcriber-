'use client'

import { useState } from 'react'
import { thumbUrl } from '@/lib/format'

type Props = {
  jobId: string | null | undefined
  className?: string
  blankClassName?: string
  blank?: string
  width: number
  height: number
}

/** Cover frame for a plan card — always tries the thumb when a job is set. */
export default function CoverThumb({
  jobId, className, blankClassName, blank, width, height,
}: Props) {
  const [failed, setFailed] = useState(false)
  if (!jobId || failed) {
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
      src={thumbUrl(jobId)}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
