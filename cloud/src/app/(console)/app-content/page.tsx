import { requirePage } from '@/lib/access'
import { redirect } from 'next/navigation'

/** App Content opens on the welcome — the first document the app shows. */
export default async function AppContentPage() {
  await requirePage('content_welcome')
  redirect('/app-content/welcome')
}
