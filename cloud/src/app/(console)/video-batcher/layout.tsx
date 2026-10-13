'use client'

import { usePathname } from 'next/navigation'
import VideoBatcher, { workspaceFromPath } from '@/components/video-batcher/VideoBatcher'

/**
 * The Video Batcher's shell (Geno, 2026-10-12): every tool is its own page —
 * /video-batcher/effects, /captions, /audio, /metadata, /watermark, /converter,
 * /compressor, /downloads — listed under Tools in the sidebar. The batcher
 * itself lives in this layout, not on the pages, so it stays mounted while
 * you move between tools: the loaded files, the settings and the running
 * queue all survive the switch.
 */
export default function VideoBatcherLayout() {
  const pathname = usePathname()
  return <VideoBatcher workspace={workspaceFromPath(pathname)} />
}
