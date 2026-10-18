import { requirePage } from '@/lib/access'
import { redirect } from 'next/navigation'

/** The bare path opens the first tool; the layout draws it. */
export default async function VideoBatcherIndex() {
  await requirePage('studio_effects')
  redirect('/video-batcher/effects')
}
