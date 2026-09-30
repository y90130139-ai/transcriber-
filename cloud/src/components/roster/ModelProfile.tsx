'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import type { IntakePick } from './IntakeDrop'
import AccessTab, { type Override } from './profile/AccessTab'
import ProfileFigures from './profile/ProfileFigures'
import BrandTab from './profile/BrandTab'
import ReelsTab from './profile/ReelsTab'
import BlueprintTab from './profile/BlueprintTab'
import ProfileHead from './profile/ProfileHead'
import ProfileTab from './profile/ProfileTab'
import TagsTab from './profile/TagsTab'
import WeekTab from './profile/WeekTab'
import { BLANK, fromModel, type ProfileForm } from './profile/form'
import type { Reading } from './profile/reach'
import type { HerPost, RosterModel } from './types'
import type { Standing } from '@/lib/standing'
import TelegramLink from './profile/TelegramLink'
import AnalyticsTab from './profile/AnalyticsTab'
import EarningsTab from '../earnings/EarningsTab'

export type ProfileTab = Tab
type Tab = 'analytics' | 'earnings' | 'profile' | 'reels' | 'brand' | 'blueprint' | 'week' | 'access'

const TABS: { key: Tab; label: string }[] = [
  // Short enough that four of them fit a 390px screen without scrolling. The
  // section each one opens says the rest.
  { key: 'profile', label: 'Profile' },
  // Her Instagram numbers: growth, views, the auto tag. lib/performance/.
  { key: 'analytics', label: 'Analytics' },
  // Her OnlyFans money from Infloww, every account of hers together (2026-09-30).
  { key: 'earnings', label: 'Earnings' },
  // Review and Editor in one, as videos (2026-09-27: "we don't need so many
  // tabs"). Tags moved into Profile the same day.
  { key: 'reels', label: 'Reels' },
  // Worked out from her accounts, never typed — see lib/insights.ts.
  { key: 'brand', label: 'Brand' },
  { key: 'blueprint', label: 'Blueprint' },
  { key: 'week', label: 'Week' },
  // Heat is gone as a tab (2026-09-27): priority and revenue sit in the
  // header, the score on Analytics, the sent weeks on Reels.
  { key: 'access', label: 'Link' },
]

/**
 * One of our models, as a profile rather than as a form.
 *
 * Replaces the right-edge `ModelSheet`. Two things drove the rewrite, both
 * Geno's: the panel could not be scrolled past its own header on a phone, and
 * there was nowhere to keep the accounts he actually wanted to open — so
 * reviewing someone's content meant leaving the app and searching for her.
 *
 * The scroll fault was in the shared panel shell and is fixed there too, for
 * the library reader and the plan editor; see `.reader` in globals.css. This
 * sheet does not reuse that shell, because a centred modal and a right-edge
 * drawer want different answers at the top and bottom, but it obeys the same
 * rule that caused the bug: one scroll region, and the whole sheet is it.
 */
/** Must match `--sc-dur-fast` in tokens.css, which is what the `float-out`
 *  animation on `.console .sheet[data-closing]` runs for. Longer and the panel
 *  sits finished-but-present; shorter and it is cut off mid-fade. */
const EXIT_MS = 150

export default function ModelProfile({
  model,
  onClose,
  onSaved,
  onStanding,
  standing,
  initialTab = 'profile',
}: {
  model: RosterModel | null
  onClose: () => void
  onSaved: () => void
  /** Her priority or revenue band changed. Saved on the spot, so the roster
   *  behind the sheet can regroup without waiting for Save. */
  onStanding?: () => void
  /** Her heat, priority and trend, for the corner of her photo. */
  standing?: Standing
  /** Opened from the dashboard, it lands on Analytics. */
  initialTab?: Tab
}) {
  const [form, setForm] = useState<ProfileForm>(() => (model ? fromModel(model) : BLANK))
  const [tab, setTab] = useState<Tab>(initialTab)
  const [token, setToken] = useState(model?.access_token ?? null)
  const [revoked, setRevoked] = useState(Boolean(model?.token_revoked_at))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  /** What she has turned down, across every week she has ever had. */
  const [declines, setDeclines] = useState<{ code: string | null; n: number }[]>([])
  /** Her own answers for the brief's fields, in front of the global tables. */
  const [defaults, setDefaults] = useState<Override[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [posts, setPosts] = useState<HerPost[]>([])
  /** The intake form this sheet was filled from, stamped once the save lands so
   *  a form that was read and then ignored stays distinguishable from one that
   *  actually became her profile. */
  const [fromIntake, setFromIntake] = useState<string | null>(null)

  const modelId = model?.id ?? null

  const loadReadings = useCallback(() => {
    if (!modelId) return
    fetch(`/api/models/${modelId}/followers`)
      .then((response) => (response.ok ? response.json() : { readings: [] }))
      .then((body) => setReadings(body.readings ?? []))
      .catch(() => setReadings([]))
  }, [modelId])

  useEffect(() => {
    if (!modelId) return
    fetch(`/api/models/${modelId}`)
      .then((response) => (response.ok ? response.json() : { declines: [] }))
      .then((body) => setDeclines(body.declines ?? []))
      .catch(() => setDeclines([]))
    fetch(`/api/models/${modelId}/brief`)
      .then((response) => (response.ok ? response.json() : { defaults: [] }))
      .then((body) => setDefaults(body.defaults ?? []))
      .catch(() => setDefaults([]))
    // Her own posts, for "her best posts" and the count in the strip. Already
    // ingested metadata-only and matched on her handle — nothing here asks
    // Instagram for anything.
    fetch(`/api/models/${modelId}/posts`)
      .then((response) => (response.ok ? response.json() : { posts: [] }))
      .then((body) => setPosts(body.posts ?? []))
      .catch(() => setPosts([]))
  }, [modelId])

  useEffect(() => { loadReadings() }, [loadReadings])

  /**
   * The way out.
   *
   * The sheet arrived with a float and then vanished on close, because
   * RosterTab unmounts it the instant it is dismissed — the one place in the
   * app where something appeared with care and left like a dropped call.
   *
   * `closing` puts `data-closing` on the panel and its scrim, which runs the
   * exit animation in globals.css, and holds the unmount for exactly as long
   * as that animation lasts. The timer is cleared on unmount so a sheet closed
   * and reopened quickly cannot call `onClose` for a panel that is already
   * gone.
   */
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const close = useCallback(() => {
    if (closeTimer.current) return // already on the way out
    setClosing(true)
    closeTimer.current = setTimeout(onClose, EXIT_MS)
  }, [onClose])

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const set: <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => void =
    (key, value) => setForm((current) => ({ ...current, [key]: value }))

  async function takePhoto(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setNote({ text: 'Uploading the photo…' })
    try {
      // Straight to Blob from the browser, the same path the phone uploads take.
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/uploads/photo',
      })
      set('photo_url', blob.url)
      setNote(null)
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Upload failed.', bad: true })
    }
    setBusy(false)
  }

  /**
   * Fold a read intake form into the sheet.
   *
   * Added to what is already here rather than replacing it — a form arrives
   * after somebody has usually typed something, and losing that is worse than a
   * duplicate tag. Scalar answers only overwrite when they were ticked, and a
   * refusal beats a format on the same tag for the reason `match.ts` states:
   * recommending what she has said no to is the worse error.
   */
  function applyIntake(picked: IntakePick) {
    const union = (held: string[], added: string[]) => [...new Set([...held, ...added])]
    setForm((current) => {
      const wontDo = union(current.wont_do, picked.wont_do)
      const { fields } = picked
      return {
        ...current,
        persona: union(current.persona, picked.persona),
        formats: union(current.formats, picked.formats).filter((tag) => !wontDo.includes(tag)),
        hooks: union(current.hooks, picked.hooks),
        wont_do: wontDo,
        ...(fields.name ? { name: fields.name } : {}),
        ...(fields.handle ? { handle: fields.handle } : {}),
        // The zone rides with the place, never on its own — the clock below
        // the picker is what proves the right half of a shared name was taken.
        ...(fields.place ? { place: fields.place, timezone: fields.timezone ?? current.timezone } : {}),
        ...(fields.filming_days ? { filming_days: fields.filming_days } : {}),
        ...(fields.weekly_target ? { weekly_target: fields.weekly_target } : {}),
        ...(fields.ig_account_type ? { ig_account_type: fields.ig_account_type } : {}),
        ...(fields.drive_url ? { drive_url: fields.drive_url } : {}),
        ...(fields.standing_rules ? { standing_rules: fields.standing_rules } : {}),
      }
    })
    setFromIntake(picked.intakeId)
  }

  async function save(tokenAction?: 'rotate' | 'revoke') {
    if (!form.name.trim()) {
      setNote({ text: 'They need a name.', bad: true })
      setTab('profile')
      return
    }
    setBusy(true)
    setNote(null)

    const response = await fetch(model ? `/api/models/${model.id}` : '/api/models', {
      method: model ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        handle: form.handle || null,
        standing_rules: form.standing_rules || null,
        notes: form.notes || null,
        drive_url: form.drive_url || null,
        delivery_note: form.delivery_note || null,
        ...(tokenAction ? { token: tokenAction } : {}),
      }),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(false)

    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not save that.', bad: true })
      return
    }
    if (tokenAction) {
      setToken(body.model?.access_token ?? null)
      setRevoked(Boolean(body.model?.token_revoked_at))
      setNote({ text: tokenAction === 'rotate' ? 'New link minted. The old one is dead.' : 'Link revoked.' })
      return
    }

    // The accounts come back normalised by the server — a bare handle typed in
    // is a full URL by now — so the sheet is re-seeded from what was actually
    // stored rather than from what was typed.
    if (body.model?.socials) set('socials', body.model.socials)

    // After the profile, never before: the route only accepts an override for a
    // format she actually does, and the formats it checks against are the ones
    // the save above has just written.
    const id = model?.id ?? body.model?.id
    if (id) {
      await fetch(`/api/models/${id}/brief`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaults }),
      }).catch(() => null)
    }

    // Only now is the form the thing her profile was actually built from.
    if (id && fromIntake) {
      await fetch(`/api/models/${id}/intake`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fromIntake }),
      }).catch(() => null)
    }

    onSaved()
  }

  async function remove() {
    if (!model) return
    if (!confirm(`Remove ${model.name} and every plan of theirs?`)) return
    setBusy(true)
    await fetch(`/api/models/${model.id}`, { method: 'DELETE' })
    setBusy(false)
    onSaved()
  }

  const shareUrl = token && typeof window !== 'undefined' ? `${window.location.origin}/p/${token}` : null

  return (
    <>
      <button
        className="sheet-scrim"
        data-closing={closing || undefined}
        onClick={close}
        aria-label="Close"
      />
      <aside
        className="sheet"
        data-closing={closing || undefined}
        aria-label={model ? `${model.name}'s profile` : 'Add a model'}
      >
        <ProfileHead
          standing={standing}
          form={form}
          isNew={!model}
          busy={busy}
          onPhoto={(file) => void takePhoto(file)}
          onClose={close}
          onAddLinks={() => setTab('profile')}
          modelId={modelId}
          onStanding={onStanding}
        />

        <ProfileFigures
          readings={readings}
          posts={posts.length}
          week={model ? { items: model.week_items, filmed: model.week_filmed } : null}
          onRecord={() => setTab('profile')}
        />

        <nav className="sheet-tabs" aria-label="Profile sections">
          {TABS.filter((one) => !['analytics', 'reels'].includes(one.key) || modelId).map((one) => (
            <button
              key={one.key}
              className="sheet-tab"
              data-on={tab === one.key}
              aria-pressed={tab === one.key}
              onClick={() => setTab(one.key)}
            >
              {one.label}
              {one.key === 'profile' && form.persona.length + form.formats.length === 0 && (
                <em>!</em>
              )}
            </button>
          ))}
        </nav>

        <div className="sheet-panel">
          {tab === 'profile' && (
            <ProfileTab
              form={form}
              set={set}
              modelId={modelId}
              readings={readings}
              posts={posts}
              onIntake={applyIntake}
              onRecorded={loadReadings}
            />
          )}
          {tab === 'profile' && (
            <section className="profile-tags" aria-label="Tags">
              <h3 className="profile-tags-head">Tags</h3>
              <TagsTab form={form} set={set} setForm={setForm} />
            </section>
          )}
          {tab === 'analytics' && modelId && <AnalyticsTab modelId={modelId} />}
          {tab === 'earnings' && modelId && <EarningsTab modelId={modelId} />}
          {tab === 'reels' && modelId && <ReelsTab modelId={modelId} name={form.name || model?.name || ''} photo={model?.photo_url ?? null} />}
          {tab === 'brand' && modelId && <BrandTab modelId={modelId} />}
          {tab === 'blueprint' && modelId && <BlueprintTab modelId={modelId} />}
          {tab === 'week' && (
            <>
              {modelId && <TelegramLink modelId={modelId} initial={model?.telegram_chat_id ?? null} />}
              <WeekTab form={form} set={set} setForm={setForm} />
            </>
          )}
          {tab === 'access' && (
            <AccessTab
              form={form}
              set={set}
              shareUrl={shareUrl}
              revoked={revoked}
              busy={busy}
              hasModel={Boolean(model)}
              defaults={defaults}
              setDefaults={setDefaults}
              declines={declines}
              onToken={(action) => void save(action)}
            />
          )}
        </div>

        <div className="sheet-bar">
          <button className="btn" disabled={busy} onClick={() => void save()}>
            {busy ? 'Working' : model ? 'Save' : 'Add them'}
          </button>
          {model && (
            <button className="btn btn-quiet" disabled={busy} onClick={() => void remove()}>
              Remove
            </button>
          )}
          {note && <span className="hint" data-tone={note.bad ? 'bad' : undefined}>{note.text}</span>}
        </div>
      </aside>
    </>
  )
}
