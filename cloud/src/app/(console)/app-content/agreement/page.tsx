import { requirePage } from '@/lib/access'
/**
 * The management agreement document of App Content. The editor is drawn by the
 * layout above (so drafts survive switching documents); this page only gives
 * the route its address.
 */
export default async function Page() {
  await requirePage('content_agreement')
  return null
}
