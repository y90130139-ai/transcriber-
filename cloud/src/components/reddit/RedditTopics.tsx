'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { OverviewTopic } from '@/lib/reddit/queries'
import { TOPIC_CATEGORIES } from '@/lib/reddit/registry'
import DropSelect from '../dashboard/DropSelect'
import Sparkline from '../dashboard/Sparkline'
import { GrowthText, StatusPill, timeAgo } from './bits'
import { useJson } from './useReddit'

/** Adult-creator topics, grouped by category. */
export default function RedditTopics() {
  const { data, error, loading } = useJson<{ rows: OverviewTopic[]; categories: string[] }>('/api/reddit/topics')
  const [category, setCategory] = useState('')

  const rows = useMemo(() => {
    const list = data?.rows ?? []
    return list.filter((row) => (category ? row.category === category : true))
  }, [data, category])

  const grouped = useMemo(() => {
    const map = new Map<string, OverviewTopic[]>()
    for (const row of rows) {
      const list = map.get(row.category) ?? []
      list.push(row)
      map.set(row.category, list)
    }
    return [...map.entries()]
  }, [rows])

  return (
    <div className="rt-page">
      <div className="rt-toolbar">
        <div className="rt-filters">
          <DropSelect className="rt-dd" label="Category" value={category} onChange={setCategory}
            options={[{ value: '', label: 'Every category' }, ...TOPIC_CATEGORIES.map((option) => ({ value: option, label: option }))]} />
        </div>
      </div>

      {error && <div className="rt-error"><b>Could not load topics</b><p>{error}</p></div>}
      {loading && !data && (
        <div className="rt-cards">
          {Array.from({ length: 6 }, (_, index) => <article className="rt-card rt-card-skel" key={index}><i /></article>)}
        </div>
      )}

      {grouped.map(([groupCategory, topics]) => (
        <section className="rt-group" key={groupCategory}>
          <div className="rt-group-head">
            <h2>{groupCategory}</h2>
            <span className="rt-dim">{topics.length} topic{topics.length === 1 ? '' : 's'}</span>
          </div>
          <div className="rt-topicgrid">
            {topics.map((topic) => (
              <Link className="rt-topiccard" key={topic.id} href={`/reddit-trends/topics/${topic.id}`}>
                <div className="rt-topiccard-top">
                  <b>{topic.name}</b>
                  <StatusPill status={topic.status} />
                </div>
                <div className="rt-topiccard-figs">
                  <span>
                    <i>Interest</i>
                    <b>{topic.interest === null ? '—' : topic.interest.toFixed(1)}</b>
                  </span>
                  <span>
                    <i>24h change</i>
                    <b><GrowthText value={topic.growth} /></b>
                  </span>
                  <span>
                    <i>Mentions</i>
                    <b>{topic.mentions}</b>
                  </span>
                  <span>
                    <i>Communities</i>
                    <b>{topic.subreddits}</b>
                  </span>
                </div>
                <div className="rt-topiccard-foot">
                  <Sparkline values={topic.spark} width={120} height={26} area />
                  <span className="rt-dim">updated {timeAgo(topic.captured_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {!loading && !grouped.length && (
        <div className="rt-empty">
          <b>No topics with readings yet</b>
        </div>
      )}
    </div>
  )
}
