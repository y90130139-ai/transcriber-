import { requirePage } from '@/lib/access'
/**
 * The captions tool of the Video Batcher. The UI is drawn by the layout above
 * (so the queue survives switching tools); this page only gives the route
 * its address.
 */
export default async function Page() {
  await requirePage('studio_captions')
  return null
}
