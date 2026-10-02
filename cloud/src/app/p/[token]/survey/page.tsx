import { notFound } from 'next/navigation'
import Survey from '@/components/survey/Survey'
import { THEME_SCRIPT } from '@/components/plan/ThemeToggle'
import { surveyPage } from '@/lib/survey/store'
import '../../../survey.css'

// Same rules as her plan: the token is the auth, never cached.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = { title: 'Your creator profile' }

export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const page = await surveyPage(token)
  if (!page) notFound()
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <Survey token={token} name={page.model.name} photo={page.model.photo_url} last={page.last} />
    </>
  )
}
