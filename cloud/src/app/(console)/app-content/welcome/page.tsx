import { requirePage } from '@/lib/access'
/**
 * The welcome document of App Content. The editor is drawn by the
 * layout above (so drafts survive switching documents); this page only gives
 * the route its address.
 */
export default async function Page() {
  await requirePage('content_welcome')
  return null
}
