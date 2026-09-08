import type { Metadata } from 'next'
import '../../plan.css'

export const metadata: Metadata = {
  title: 'Your content plan',
  // Her plan is a private link. It must never end up in an index.
  robots: { index: false, follow: false, nocache: true },
}

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return children
}
