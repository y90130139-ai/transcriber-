import { ImageResponse } from 'next/og'
import { formatDate } from '@/lib/dates'
import { modelForToken } from '@/lib/plans'
import { scorecardFor } from '@/lib/performance/scorecard'

type Params = { params: Promise<{ token: string }> }

const INK = '#0A0A0A'
const PANEL = '#1A1917'
const BONE = '#EDE9E3'
const MUTED = '#9C968D'
const EMBER = '#E8663A'
const UP = '#6FCF97'
const DOWN = '#F08A80'

const TREND = {
  up: { word: 'Trending up', arrow: '↑', color: UP },
  flat: { word: 'Steady', arrow: '→', color: BONE },
  down: { word: 'Trending down', arrow: '↓', color: DOWN },
} as const

function short(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(1).replace(/\.0$/, '')}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K` : String(Math.round(a))
  return n < 0 ? `−${s}` : s
}

function line(values: number[], w: number, h: number): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  return values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ')
}

/**
 * Her weekly scorecard as a picture, for the Gosian bot to send (Telegram
 * fetches this URL). Behind her own plan token — the same link she already
 * has — so it shows only her own numbers. lib/performance/scorecard.ts.
 */
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params
  const model = await modelForToken(token)
  if (!model) return new Response('not found', { status: 404 })
  const card = await scorecardFor(model.id)
  if (!card) return new Response('not found', { status: 404 })
  const trend = card.trend ? TREND[card.trend] : null
  const W = 860
  const H = 190
  const path = line(card.series, W, H)
  const gain = card.followers_gain

  const stat = (label: string, value: string, note?: string, color = BONE) => (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: PANEL, borderRadius: 24, padding: '28px 30px' }}>
      <div style={{ fontSize: 22, color: MUTED, letterSpacing: 3, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 64, fontWeight: 700, color, marginTop: 8 }}>{value}</div>
      {note ? <div style={{ fontSize: 24, color: MUTED, marginTop: 4 }}>{note}</div> : null}
    </div>
  )

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: INK, color: BONE, padding: 70, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {card.photo_url
            ? <img src={card.photo_url} width={150} height={150} style={{ borderRadius: 75, objectFit: 'cover', border: `5px solid ${EMBER}` }} />
            : <div style={{ width: 150, height: 150, borderRadius: 75, background: EMBER, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60, fontWeight: 700 }}>{card.name.slice(0, 1)}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 36 }}>
            <div style={{ fontSize: 26, color: EMBER, letterSpacing: 4, textTransform: 'uppercase' }}>{`Your week · ${formatDate(card.week_label.slice(8))}`}</div>
            <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>{card.name}</div>
            {card.handle ? <div style={{ fontSize: 30, color: MUTED }}>{`@${card.handle}`}</div> : null}
          </div>
        </div>

        <div style={{ display: 'flex', marginTop: 56, alignItems: 'center', background: PANEL, borderRadius: 24, padding: '26px 32px', borderLeft: `10px solid ${trend?.color ?? MUTED}` }}>
          <div style={{ fontSize: 72, fontWeight: 800, color: trend?.color ?? MUTED, marginRight: 24 }}>{trend?.arrow ?? '•'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ fontSize: 44, fontWeight: 800, color: trend?.color ?? BONE }}>{trend?.word ?? 'Building your trend'}</div>
            <div style={{ fontSize: 28, color: BONE, marginTop: 6, lineHeight: 1.3 }}>{card.next_step}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 22, marginTop: 34 }}>
          {stat('Followers', short(card.followers), gain === null ? undefined : `${gain >= 0 ? '+' : ''}${short(gain)} this week`, BONE)}
          {stat('Views', short(card.views), 'on reels posted this week')}
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 22 }}>
          {stat('Posting', `${card.reels_per_week}`, 'reels a week')}
          {stat('Stories', card.story_days_observed ? `${card.story_days}/${card.story_days_observed}` : '—', 'days with a story up')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 34, background: PANEL, borderRadius: 24, padding: '26px 30px', flex: 1 }}>
          <div style={{ fontSize: 22, color: MUTED, letterSpacing: 3, textTransform: 'uppercase' }}>Audience growth</div>
          {path ? (
            <svg width={W + 20} height={H + 20} viewBox={`-10 -10 ${W + 20} ${H + 20}`} style={{ marginTop: 16 }}>
              <path d={path} fill="none" stroke={EMBER} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : <div style={{ fontSize: 26, color: MUTED, marginTop: 20 }}>Your growth line appears after a few days of readings.</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, fontSize: 22, color: MUTED }}>
          <div>Your weekly scorecard</div>
          <div>Questions? Ask in your group 🧡</div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350, headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
