'use client'

import { useState } from 'react'
import { initials } from './format'

/** Her roster photo, or her initials when there is none or it will not load. */
export default function Avatar({ name, src, size = 32 }: { name: string; src: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className="dash-avatar" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {src && !broken
        ? <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />
        : initials(name)}
    </span>
  )
}
