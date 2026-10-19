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
  /* The switcher's lead mark (Geno, 2026-10-19): two arrows passing — the
     same ⇄ the invoice workspace's Switch button wears. */
  swap: (
    <>
      <path d="m8.5 3.5-4 4 4 4" />
      <path d="M4.5 7.5h15" />
      <path d="m15.5 20.5 4-4-4-4" />
      <path d="M19.5 16.5h-15" />
    </>
  ),
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
  video: (
    <>
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V3.5" />
      <path d="m7.5 8 4.5-4.5L16.5 8" />
      <path d="M4.5 16v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" />
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
  link: (
    <>
      <path d="M10 14a5 5 0 0 0 7.1 0l2.4-2.4a5 5 0 0 0-7.1-7.1L11 5.9" />
      <path d="M14 10a5 5 0 0 0-7.1 0l-2.4 2.4a5 5 0 0 0 7.1 7.1L13 18.1" />
    </>
  ),
  chat: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9.6L5 19.7a.7.7 0 0 1-1-.7z" />
    </>
  ),
  // Drawn 2026-10-13 for the rail's second pass: the marks the first set
  // had no twin for. Same 24×24 grid, same 1.7 line.
  search: (
    <>
      <circle cx="11" cy="11" r="7.5" />
      <path d="m20.5 20.5-4.4-4.4" />
    </>
  ),
  sparkles: (
    <>
      <path d="M9.9 15.5A2 2 0 0 0 8.5 14.1l-6.1-1.6a.5.5 0 0 1 0-1l6.1-1.6a2 2 0 0 0 1.4-1.4l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z" />
      <path d="M20 3.5v3.4" />
      <path d="M21.7 5.2h-3.4" />
      <path d="M4.6 16.6v2.6" />
      <path d="M5.9 17.9H3.3" />
    </>
  ),
  command: (
    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5" />
    </>
  ),
  sound: (
    <>
      <path d="M4 10.5v3" />
      <path d="M8 7.5v9" />
      <path d="M12 4.5v15" />
      <path d="M16 7.5v9" />
      <path d="M20 10.5v3" />
    </>
  ),
  compress: (
    <>
      <path d="m8 7.5 4 4.5 4-4.5" />
      <path d="m8 16.5 4-4.5 4 4.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m3.5 7.5 8.5 6 8.5-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
