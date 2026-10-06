import { notFound } from 'next/navigation'
import DiscoverView from '@/components/plan/DiscoverView'
import { THEME_SCRIPT } from '@/components/plan/ThemeToggle'
import { modelForToken } from '@/lib/plans'
import { styleScript } from '@/lib/portal-style'

// Same rules as her plan: the token is the auth, never cached.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = { title: 'Discover' }

export default async function DiscoverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const model = await modelForToken(token)
  if (!model) notFound()
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      {styleScript(model.portal_style) && (
        <script dangerouslySetInnerHTML={{ __html: styleScript(model.portal_style) }} />
      )}
      <DiscoverView token={token} />
    </>
  )
}
