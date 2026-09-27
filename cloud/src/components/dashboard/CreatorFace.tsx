'use client'

import { useState } from 'react'
import { compact, initials } from './format'

export type Face = { thumb: string; followers?: number | null }

/**
 * A creator at a glance: a picture (the cover of their best reel in the
 * library — nothing stores profile photos), their @handle, and one short line.
 * Taps through to their Instagram.
 */
export default function CreatorFace({ handle, face, line, size = 'small' }: {
  handle: string
  face?: Face
  line?: string
  size?: 'small' | 'large'
}) {
  const [broken, setBroken] = useState(false)
  return (
    <a className="face" data-size={size} href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noreferrer">
      <span className="face-pic" aria-hidden>
        {face && !broken ? <img src={face.thumb} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(handle)}
      </span>
      <span className="face-text">
        <b>@{handle}</b>
        {(line || face?.followers) && <small>{[line, face?.followers ? `${compact(face.followers)} followers` : null].filter(Boolean).join(' · ')}</small>}
      </span>
    </a>
  )
}
