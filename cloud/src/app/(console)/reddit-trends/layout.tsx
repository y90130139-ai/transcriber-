import RedditNav from '@/components/reddit/RedditNav'

/** The section frame: the title and the section nav on one line, then the
 *  page. Nothing here fetches — every page reads its own cache slice. */
export default function RedditTrendsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rt">
      <header className="rt-head">
        <h1 className="rt-title">Reddit Trends</h1>
        <RedditNav />
      </header>
      {children}
    </div>
  )
}
