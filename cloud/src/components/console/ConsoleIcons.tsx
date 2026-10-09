/**
 * The shell's one icon set: 24×24 line marks drawn in `currentColor`.
 *
 * Inline rather than a dependency — the rail and the top bar need a baker's
 * dozen between them, and the console ships no icon library. 1.7 stroke at
 * 24 reads as the same weight at every size the shell asks for.
 */

import type { ReactNode } from 'react'

const ICONS = {
  home: (
    <>
      <path d="m3 10.6 9-7.4 9 7.4" />
      <path d="M5.5 9.1V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.1" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  layers: (
    <>
      <path d="m12 2.5 9.5 5-9.5 5-9.5-5Z" />
      <path d="m2.5 12.5 9.5 5 9.5-5" />
      <path d="m2.5 17 9.5 5 9.5-5" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6h13" />
      <path d="M8.5 12h13" />
      <path d="M8.5 18h13" />
      <path d="M3.5 6h.01" />
      <path d="M3.5 12h.01" />
      <path d="M3.5 18h.01" />
    </>
  ),
  trending: (
    <>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  // The community mark: a round face with two antennae and a quiet smile —
  // deliberately generic rather than Reddit's own mascot.
  reddit: (
    <>
      <circle cx="12" cy="13.5" r="6.8" />
      <path d="M12 6.7V3.6" />
      <circle cx="12" cy="3" r="1.1" />
      <path d="M9.2 12.6h.01" />
      <path d="M14.8 12.6h.01" />
      <path d="M9.4 16.2c1.5 1.1 3.7 1.1 5.2 0" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5.5l11-2v12.5" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  userCheck: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m16.5 11.5 2 2 4-4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  calendarCheck: (
    <>
      <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
      <path d="M8 2.5v4" />
      <path d="M16 2.5v4" />
      <path d="M3 10h18" />
      <path d="m9.5 16 1.8 1.8 3.7-3.8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
      <path d="M8 2.5v4" />
      <path d="M16 2.5v4" />
      <path d="M3 10h18" />
    </>
  ),
  chevron: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  menu: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8.5a6 6 0 0 1 12 0c0 7 3 8.5 3 8.5H3s3-1.5 3-8.5" />
      <path d="M10.3 20.5a2 2 0 0 0 3.4 0" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="m8.5 12.5 2.3 2.3 4.7-5.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 6.5V12l3.5 2" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.5" />
      <path d="M12 17.2h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4.5" />
      <path d="m16 16.5 4.5-4.5L16 7.5" />
      <path d="M20.5 12H9.5" />
    </>
  ),
  /* --- Video Batcher ------------------------------------------------ */
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7.5 4v16" />
      <path d="M16.5 4v16" />
      <path d="M3 9h4.5" />
      <path d="M3 15h4.5" />
      <path d="M16.5 9H21" />
      <path d="M16.5 15H21" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 8h9" />
      <path d="M17 8h3" />
      <circle cx="15" cy="8" r="2" />
      <path d="M4 16h3" />
      <path d="M11 16h9" />
      <circle cx="9" cy="16" r="2" />
    </>
  ),
  type: (
    <>
      <path d="M4 7V5h16v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 18 5.5-5.5 3.5 3.5 3-3L20 17" />
    </>
  ),
  tag: (
    <>
      <path d="m3.5 12.6 8.4 8.4a2 2 0 0 0 2.9 0l6.2-6.2a2 2 0 0 0 0-2.9l-8.4-8.4" />
      <path d="M3.5 3.5h6l-6 9" />
      <circle cx="7.3" cy="7.3" r="1.3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 20.5h15" />
    </>
  ),
  play: <path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11-7.2a.8.8 0 0 0 0-1.4l-11-7.2A.8.8 0 0 0 7 4.8Z" />,
  pause: (
    <>
      <path d="M8.5 5v14" />
      <path d="M15.5 5v14" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  trash: (
    <>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7" />
      <path d="M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5" />
      <path d="M10 10.5v6" />
      <path d="M14 10.5v6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 3.5V9h-5.5" />
    </>
  ),
  dice: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8.2 8.2h.01" />
      <path d="M15.8 8.2h.01" />
      <path d="M12 12h.01" />
      <path d="M8.2 15.8h.01" />
      <path d="M15.8 15.8h.01" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  x: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h4l2 2.5h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </>
  ),
  gauge: (
    <>
      <path d="M4.5 19a9.5 9.5 0 1 1 15 0" />
      <path d="m12 15 4-5.5" />
      <circle cx="12" cy="16" r="1.4" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}
