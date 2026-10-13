import { redirect } from 'next/navigation'

/** The bare path opens the first tool; the layout draws it. */
export default function VideoBatcherIndex() {
  redirect('/video-batcher/effects')
}
