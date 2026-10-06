import type { Metadata } from 'next'
import '../../plan.css'

/** Per token, so "Add to Home Screen" installs HER plan: the manifest and
 *  the apple meta both point at her own link. No service worker anywhere —
 *  the installed app fetches fresh on every open. */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  return {
    title: 'Your content plan',
    // Her plan is a private link. It must never end up in an index.
    robots: { index: false, follow: false, nocache: true },
    manifest: `/p/${encodeURIComponent(token)}/manifest.webmanifest`,
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Your plan' },
    icons: { apple: '/pwa-icon/192' },
  }
}

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return children
}
