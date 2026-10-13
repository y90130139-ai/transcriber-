'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * The console inbox (Geno, 2026-10-12). A mail client, not a chat bubble.
 * Three panes: the list with search and filters, the conversation, and a
 * people/details rail. The same engine the app uses (lib/inbox.ts); the
 * console and her phone are two doors onto one set of threads.
 *
 * Inter, bigger everything, one colour (2026-10-13): ink on the dark
 * ground - real model photos lead every face (Face below, off
 * /api/photo/[id]) with quiet initials as the fallback. Right-click a
 * thread to mark unread, mute or delete it; right-click one of your own
 * messages to edit or delete it. The popup card fades in and out.
 * Styles live in inbox.css, scoped to .inbox-full.
 */

type Member = { type: 'model' | 'team'; id: string; name: string | null }
type Last = {
  body: string
  author_type: 'team' | 'model' | null
  author_name: string | null
  attachment_type: string | null
  deleted: boolean
  at: string
}
type ThreadSummary = {
  id: string
  title: string | null
  photo: string | null
  members: Member[]
  last: Last | null
  unread: number
  muted: boolean
  files: number
  messages_count: number
  created_at: string
}
type Reaction = { emoji: string; count: number; mine: boolean }
type ReplyPreview = {
  id: string
  author_type: 'team' | 'model'
  author_name: string | null
  body: string
  attachment_type: string | null
  deleted: boolean
}
type Message = {
  id: string
  author_type: 'team' | 'model'
  author_id: string | null
  author_name: string | null
  body: string
  attachment_key: string | null
  attachment_type: string | null
  attachment_name: string | null
  kind: 'user' | 'system'
  edited: boolean
  deleted: boolean
  /** Tapbacks from either side, one entry per emoji (2026-10-13). */
  reactions?: Reaction[]
  /** The message this one answers, drawn as a quiet quote. */
  reply_to?: ReplyPreview | null
  /** A forwarded copy wears its mark. */
  forwarded?: boolean
  at: string
}
type ModelRow = { id: string; name: string }
type TeamRow = { id: string; name: string | null; email: string; role: string }
type Tab = 'all' | 'unread' | 'files'
type Menu = { kind: 'thread' | 'message'; id: string; x: number; y: number }

/** The right-click card's one size, in css and in the clamp maths. */
const MENU_W = 224
const MENU_H = 148

/* ------------------------------------------------------------- helpers */

function threadName(thread: ThreadSummary): string {
  if (thread.title) return thread.title
  const names = thread.members.map((member) => member.name).filter(Boolean) as string[]
  if (names.length === 0) return 'No one yet'
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`
}

/** The member whose face leads a thread - a model when there is one. */
function leadOf(thread: ThreadSummary): Member | null {
  return thread.members.find((member) => member.type === 'model') ?? thread.members[0] ?? null
}

function photoIdOf(member: Member | null): string | null {
  return member && member.type === 'model' ? member.id : null
}

/** Three or more people is a group - it wears its own face (2026-10-13). */
function isGroupOf(thread: ThreadSummary | null): boolean {
  return Boolean(thread && thread.members.length > 2)
}

function threadPhotoSrc(thread: ThreadSummary | null): string | null {
  return thread?.photo ? `/api/inbox/file/${thread.photo}` : null
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function when(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const today = new Date()
  return at.toDateString() === today.toDateString()
    ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function dayLabel(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (at.toDateString() === today.toDateString()) return 'Today'
  if (at.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function previewOf(thread: ThreadSummary): string {
  if (!thread.last) return 'No messages yet'
  if (thread.last.deleted) return 'Message deleted'
  const who = thread.last.author_type === 'team' && thread.last.author_name ? `${thread.last.author_name}: ` : ''
  const kind = thread.last.attachment_type?.split('/')[0]
  const body = thread.last.body || (kind === 'video' ? 'Video' : kind === 'audio' ? 'Voice note' : 'Photo')
  return `${who}${body}`
}

/** Which face a thread wears: a group wears its picture (or initials of
 *  its name), a 1:1 wears the person (2026-10-13). */
function threadFace(thread: ThreadSummary): { name: string; photoId: string | null; src: string | null } {
  if (isGroupOf(thread)) {
    return { name: threadName(thread), photoId: null, src: threadPhotoSrc(thread) }
  }
  const lead = leadOf(thread)
  return { name: lead?.name ?? threadName(thread), photoId: photoIdOf(lead), src: null }
}

function attLabel(type: string | null | undefined): string {
  const kind = type?.split('/')[0]
  if (kind === 'video') return 'Video'
  if (kind === 'audio') return 'Audio'
  if (kind === 'image') return 'Photo'
  return 'File'
}

function authorName(message: Message): string {
  if (message.author_type === 'team') return message.author_name ?? 'Team'
  return message.author_name ?? 'Model'
}

/** The reaction bar's shelf — the same emoji the app's menu offers
 *  (2026-10-13). Ten, one row. */
const REACT_EMOJIS = ['❤️', '👍', '🙏', '🥲', '🔥', '💯', '😂', '😮', '😡', '🎉']
const REACT_BAR_W = 394

/** The optimistic half of a tapback — server truth lands right after.
 *  One reaction per member per message: the same emoji again removes it,
 *  a different one replaces it; everyone else's count stays. */
function bumpReaction(current: Reaction[] | undefined, emoji: string): Reaction[] {
  const list = current ?? []
  const mine = list.find((one) => one.mine)
  if (mine && mine.emoji === emoji) {
    return list
      .map((one) => (one.emoji === emoji ? { ...one, count: one.count - 1, mine: false } : one))
      .filter((one) => one.count > 0)
  }
  let next = list
  if (mine) {
    next = next
      .map((one) => (one.emoji === mine.emoji ? { ...one, count: one.count - 1 } : one))
      .filter((one) => one.count > 0)
  }
  const existing = next.find((one) => one.emoji === emoji)
  return existing
    ? next.map((one) => (one.emoji === emoji ? { ...one, count: one.count + 1, mine: true } : one))
    : [...next, { emoji, count: 1, mine: true }]
}

/* ------------------------------------------------------------- icons */

function IcoPencil() {
  return (
    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M9.9 2.1a1.55 1.55 0 0 1 2.2 2.2l-7 7-2.9.7.7-2.9 7-7Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function IcoSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="6.2" cy="6.2" r="4.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="m9.5 9.5 3.1 3.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function IcoRefresh() {
  return (
    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M12 7A5 5 0 1 1 10.2 3.1M12 2.4v2.9h-2.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IcoClip() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M12.1 6.3l-5 5a2.6 2.6 0 0 1-3.7-3.7l5.4-5.4a1.9 1.9 0 0 1 2.7 2.7l-5.2 5.2a1.1 1.1 0 0 1-1.6-1.6l4.6-4.6"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IcoSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 11.8V2.9M3.5 6.2 7 2.7l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IcoX() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2.6 2.6l6.8 6.8M9.4 2.6 2.6 9.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IcoPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 1.8v8.4M1.8 6h8.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IcoCamera() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M1.9 4.6h2.2l.9-1.5h4l.9 1.5h2.2a.8.8 0 0 1 .8.8v5a.8.8 0 0 1-.8.8H1.9a.8.8 0 0 1-.8-.8v-5a.8.8 0 0 1 .8-.8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="7" cy="7.6" r="1.8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function IcoCheck() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="m2.4 6.4 2.4 2.4 4.8-5.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IcoBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M8.7 2.6 4.3 7l4.4 4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IcoDownload() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 2v7.2M3.8 6.2 7 9.4l3.2-3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.2 11.6h9.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IcoInbox() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2.2 8.2 3 3.6a1.2 1.2 0 0 1 1.2-1h5.6A1.2 1.2 0 0 1 11 3.6l.8 4.6v3.5a1.2 1.2 0 0 1-1.2 1.2H4.2a1.2 1.2 0 0 1-1.2-1.2V8.2Z" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
      <path d="M2.4 8.2h2.3l.8 1.4h3l.8-1.4h2.3" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
    </svg>
  )
}

function IcoDoc() {
  return (
    <svg width="17" height="17" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M4 1.8h3.6l2.6 2.6v7.8H4V1.8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M7.5 1.9v2.7h2.6" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function IcoEnvelope() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1.8" y="3" width="10.4" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="m2.6 4.2 4.4 3.4 4.4-3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IcoBell() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 1.9c-2 0-3.3 1.5-3.3 3.5v2.3L2.7 9.5h8.6l-1-1.8V5.4c0-2-1.3-3.5-3.3-3.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.9 11.1a1.25 1.25 0 0 0 2.2 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="m2.2 2.2 9.6 9.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function IcoTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2.4 3.7h9.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.6 3.5V2.3a.5.5 0 0 1 .5-.5h1.8a.5.5 0 0 1 .5.5v1.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="m3.6 3.9.6 7.9h5.6l.6-7.9" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function IcoSmile() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.9" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.9 8.4a2.6 2.6 0 0 0 4.2 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.5 5.7h.01M8.5 5.7h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** A face: initials always underneath, a photo layered on top when we have
 *  one — a model's via /api/photo/[id], a group's straight from its inbox
 *  key. A missing or failed photo simply falls back to the initials that
 *  were there the whole time - never a blank disc. */
function Face({
  name,
  photoId,
  src,
  size,
}: {
  name: string
  photoId?: string | null
  src?: string | null
  size?: 'lg' | 's' | 'xs' | 'tiny'
}) {
  const [failed, setFailed] = useState(false)
  const url = src ?? (photoId ? `/api/photo/${photoId}` : null)
  const className = `ix-av${size ? ` ix-av--${size}` : ''}${url && !failed ? ' ix-av--photo' : ''}`
  return (
    <span className={className}>
      {initialsOf(name)}
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : null}
    </span>
  )
}

/* ------------------------------------------------------------- component */

export default function InboxTab() {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [team, setTeam] = useState<TeamRow[]>([])
  const [models, setModels] = useState<ModelRow[]>([])
  const [me, setMe] = useState<{ id: string; name: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadSummary | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [staggerCount, setStaggerCount] = useState(0)
  const [flashId, setFlashId] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')

  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<{ key: string; type: string; name: string | null } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const [picker, setPicker] = useState<'new' | 'add' | null>(null)
  const [closing, setClosing] = useState(false)
  const [picked, setPicked] = useState<Record<string, Member>>({})
  const [groupTitle, setGroupTitle] = useState('')
  const [pickSearch, setPickSearch] = useState('')

  const [menu, setMenu] = useState<Menu | null>(null)
  const [menuClosing, setMenuClosing] = useState(false)
  const [menuSure, setMenuSure] = useState(false)
  const [reactFor, setReactFor] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [viewer, setViewer] = useState<{ src: string; name: string } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [shotBusy, setShotBusy] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const groupShotRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)

  // The list is threads + team only - the models roster is heavy and the
  // picker is the only place that needs it, so it loads on first open
  // (Geno, 2026-10-13: the phone was paying for 41 models every refresh).
  const loadList = useCallback(async () => {
    const response = await fetch('/api/inbox')
    if (response.ok) {
      const body = await response.json()
      setThreads(body.threads ?? [])
      setTeam(body.team ?? [])
      setMe(body.me ?? null)
    }
    setLoading(false)
  }, [])

  const ensureModels = useCallback(async () => {
    if (models.length > 0) return
    const response = await fetch('/api/models')
    if (response.ok) {
      const body = await response.json()
      setModels(
        (body.models ?? []).map((model: { id: string; name: string }) => ({ id: String(model.id), name: String(model.name) })),
      )
    }
  }, [models.length])

  const openThread = useCallback(
    async (id: string) => {
      setOpenId(id)
      setPending(null)
      setNote(null)
      setEditing(null)
      setRenaming(false)
      const response = await fetch(`/api/inbox/${id}`)
      if (!response.ok) {
        setNote({ text: 'Could not open that thread.', bad: true })
        return
      }
      const data = await response.json()
      setThread(data.thread)
      setMessages(data.messages ?? [])
      setStaggerCount((data.messages ?? []).length)
      // Opening reads it - clear the badge locally instead of paying for a
      // whole second list fetch (Geno, 2026-10-13).
      setThreads((current) => current.map((one) => (one.id === id ? { ...one, unread: 0 } : one)))
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 60)
    },
    [],
  )

  useEffect(() => {
    void loadList()
  }, [loadList])

  // A quiet refresh while a thread is open - messages only, and only when
  // the tab is actually visible. Four seconds is as close to live as a
  // poll gets; on the console's own network it reads as realtime.
  useEffect(() => {
    if (!openId) return
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const response = await fetch(`/api/inbox/${openId}`)
      if (response.ok) {
        const data = await response.json()
        setMessages(data.messages ?? [])
        setThread((current) => (current && current.id === openId ? { ...current, ...data.thread, last: null } : current))
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [openId])

  // The list (unread badges, revived threads) refreshes on a slower clock.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadList()
    }, 20000)
    return () => clearInterval(timer)
  }, [loadList])

  const closePicker = useCallback(() => {
    setClosing((wasClosing) => {
      if (wasClosing) return wasClosing
      window.setTimeout(() => {
        setPicker(null)
        setClosing(false)
        setPicked({})
        setPickSearch('')
      }, 190)
      return true
    })
  }, [])

  // The menu leaves the way it came in (Geno, 2026-10-13): fade out, then
  // unmount. Fixed box, so nothing jumps while it goes.
  const closeMenu = useCallback(() => {
    setMenuClosing((wasClosing) => {
      if (wasClosing) return wasClosing
      window.setTimeout(() => {
        setMenu(null)
        setMenuClosing(false)
        setMenuSure(false)
      }, 150)
      return true
    })
  }, [])

  // Escape closes the viewer, then the menu, then the popup card.
  useEffect(() => {
    if (!menu && !picker && !viewer) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (viewer) {
        setViewer(null)
        return
      }
      if (menu) {
        closeMenu()
        return
      }
      if (picker) closePicker()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, picker, viewer, closePicker, closeMenu])

  // The viewer's download: the same route, signed as an attachment, so the
  // browser saves the file without leaving the page (a fetch of the stream
  // URL would die on R2's CORS — the redirect lands off-origin).
  function downloadViewer() {
    if (!viewer) return
    const anchor = document.createElement('a')
    anchor.href = `${viewer.src}?download=${encodeURIComponent(viewer.name || 'photo')}`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  function openMenu(kind: Menu['kind'], id: string, x: number, y: number) {
    // One fixed box for both menus (Geno, 2026-10-13) - same width, same
    // height, so the card never resizes between the row and the message.
    setMenuSure(false)
    setMenuClosing(false)
    setMenu({
      kind,
      id,
      x: Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - MENU_H - 8)),
    })
  }

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await loadList()
      if (openId) {
        const response = await fetch(`/api/inbox/${openId}`)
        if (response.ok) {
          const data = await response.json()
          setMessages(data.messages ?? [])
        }
      }
    } finally {
      setRefreshing(false)
    }
  }

  async function threadAction(action: 'mark-unread' | 'mark-read' | 'mute' | 'unmute', id: string) {
    setThreads((current) =>
      current.map((one) =>
        one.id === id
          ? {
              ...one,
              muted: action === 'mute' ? true : action === 'unmute' ? false : one.muted,
              unread: action === 'mark-unread' ? Math.max(1, one.unread) : action === 'mark-read' ? 0 : one.unread,
            }
          : one,
      ),
    )
    await fetch(`/api/inbox/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    void loadList()
  }

  async function removeThread(id: string) {
    await fetch(`/api/inbox/${id}`, { method: 'DELETE' })
    if (openId === id) {
      setOpenId(null)
      setThread(null)
      setMessages([])
    }
    void loadList()
  }

  async function send() {
    if (!openId || busy) return
    const text = draft.trim()
    if (!text && !pending) return
    setBusy(true)
    setNote(null)
    try {
      const response = await fetch(`/api/inbox/${openId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, attachment: pending }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setNote({ text: data?.error ?? 'Could not send.', bad: true })
        return
      }
      setMessages((current) => [...current, data.message])
      setFlashId(data.message.id)
      setDraft('')
      setPending(null)
      // Whoever speaks is in the room - show Yourself in the rail right
      // away, the server records it in the background (2026-10-13).
      if (me) {
        setThread((current) =>
          current && !current.members.some((member) => member.type === 'team' && member.id === me.id)
            ? { ...current, members: [...current.members, { type: 'team', id: me.id, name: me.name }] }
            : current,
        )
      }
      if (composerRef.current) {
        composerRef.current.style.height = ''
        composerRef.current.focus()
      }
      void loadList()
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 60)
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(messageId: string) {
    const text = editing?.body.trim() ?? ''
    if (!openId || !text) return
    const response = await fetch(`/api/inbox/${openId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text }),
    })
    if (!response.ok) {
      setNote({ text: 'Could not save the edit.', bad: true })
      return
    }
    setMessages((current) => current.map((one) => (one.id === messageId ? { ...one, body: text, edited: true } : one)))
    setEditing(null)
  }

  /** A tapback (2026-10-13): the tally moves at once, the server confirms.
   *  Anyone in the room can react — several people may wear the same emoji;
   *  the same one again takes it back. */
  async function toggleReaction(messageId: string, emoji: string) {
    if (!openId) return
    setMessages((current) =>
      current.map((one) => (one.id === messageId ? { ...one, reactions: bumpReaction(one.reactions, emoji) } : one)),
    )
    try {
      const response = await fetch(`/api/inbox/${openId}/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !Array.isArray(data.reactions)) throw new Error('refused')
      setMessages((current) => current.map((one) => (one.id === messageId ? { ...one, reactions: data.reactions } : one)))
    } catch {
      setNote({ text: 'Could not react — try again.', bad: true })
      void refresh()
    }
  }

  async function removeMessage(messageId: string) {
    if (!openId) return
    const response = await fetch(`/api/inbox/${openId}/messages/${messageId}`, { method: 'DELETE' })
    if (!response.ok) {
      setNote({ text: 'Could not delete that message.', bad: true })
      return
    }
    // A tombstone, not a hole: the bubble stays and says so.
    setMessages((current) =>
      current.map((one) =>
        one.id === messageId
          ? { ...one, body: '', attachment_key: null, attachment_type: null, attachment_name: null, deleted: true }
          : one,
      ),
    )
    void loadList()
  }

  /** The group's name, set once and heard on every device. */
  async function saveGroupName() {
    if (!openId || !thread) return
    const title = nameDraft.trim()
    await fetch(`/api/inbox/${openId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    setThread({ ...thread, title: title || null })
    setRenaming(false)
    void loadList()
  }

  /** The group's picture: upload to the thread's own folder, then point
   *  the row at it - both doors read the same key. */
  async function setGroupPhoto(file: File | undefined) {
    if (!file || !openId || !thread || shotBusy) return
    if (!file.type.startsWith('image/')) return
    setShotBusy(true)
    setNote(null)
    try {
      const response = await fetch(`/api/inbox/${openId}/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: file.type, name: file.name }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setNote({ text: data?.error ?? 'Could not upload that.', bad: true })
        return
      }
      const put = await fetch(data.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }).catch(() => null)
      if (!put?.ok) {
        setNote({ text: 'The upload did not go through — try again.', bad: true })
        return
      }
      await fetch(`/api/inbox/${openId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_key: data.key }),
      })
      setThread({ ...thread, photo: data.key })
      void loadList()
    } finally {
      setShotBusy(false)
    }
  }

  async function attach(file: File | undefined) {
    if (!file || !openId || uploading) return
    setUploading(true)
    setNote(null)
    try {
      const response = await fetch(`/api/inbox/${openId}/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: file.type, name: file.name }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setNote({ text: data?.error ?? 'That file type is not supported.', bad: true })
        return
      }
      const put = await fetch(data.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }).catch(() => null)
      if (!put?.ok) {
        setNote({ text: 'The upload did not go through — try again.', bad: true })
        return
      }
      setPending({ key: data.key, type: data.content_type, name: file.name })
    } finally {
      setUploading(false)
    }
  }

  async function createThread() {
    const members = Object.values(picked)
    if (members.length === 0) {
      setNote({ text: 'Pick at least one person.', bad: true })
      return
    }
    const response = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: groupTitle, members }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setNote({ text: data?.error ?? 'Could not create it.', bad: true })
      return
    }
    setGroupTitle('')
    setNote(null)
    await loadList()
    void openThread(data.id)
    closePicker()
  }

  async function addPeople() {
    if (!openId || !thread) return
    const members = Object.values(picked)
    if (members.length === 0) return
    await fetch(`/api/inbox/${openId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members }),
    })
    closePicker()
    void openThread(openId)
  }

  function togglePick(member: Member) {
    setPicked((current) => {
      const key = `${member.type}:${member.id}`
      const next = { ...current }
      if (next[key]) delete next[key]
      else next[key] = member
      return next
    })
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return threads.filter((one) => {
      if (tab === 'unread' && one.unread === 0) return false
      if (tab === 'files' && one.files === 0) return false
      if (!needle) return true
      const haystack = `${threadName(one)} ${one.last?.author_name ?? ''} ${one.last?.body ?? ''}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [threads, tab, search])

  const pickNeedle = pickSearch.trim().toLowerCase()
  const filteredModels = useMemo(
    () => (pickNeedle ? models.filter((model) => model.name.toLowerCase().includes(pickNeedle)) : models),
    [models, pickNeedle],
  )
  const filteredTeam = useMemo(() => {
    // Add people offers the team only, minus whoever is already in the
    // thread (Geno, 2026-10-13). The roster itself is access-filtered
    // server-side: CEO, admin, or a transcribing member.
    const inThread = new Set(picker === 'add' ? (thread?.members ?? []).map((member) => `${member.type}:${member.id}`) : [])
    return team
      .filter((member) => (pickNeedle ? `${member.name ?? ''} ${member.email}`.toLowerCase().includes(pickNeedle) : true))
      .filter((member) => !inThread.has(`team:${member.id}`))
  }, [team, pickNeedle, picker, thread])

  const files = useMemo(() => messages.filter((message) => message.attachment_key), [messages])

  const unreadTotal = threads.reduce((total, one) => total + (one.muted ? 0 : one.unread), 0)
  const filesTotal = threads.filter((one) => one.files > 0).length
  const pickedCount = Object.keys(picked).length
  const lead = thread ? leadOf(thread) : null

  const menuThread = menu?.kind === 'thread' ? threads.find((one) => one.id === menu.id) ?? null : null
  const menuMessage = menu?.kind === 'message' ? messages.find((one) => one.id === menu.id) ?? null : null

  const tabButton = (key: Tab, label: string, count: number) => (
    <button key={key} type="button" className="ix-tab" data-on={tab === key || undefined} onClick={() => setTab(key)}>
      {label} <b>{count}</b>
    </button>
  )

  return (
    <>
      <div className="inbox-full" data-view={thread ? 'convo' : 'list'}>
        {/* ---------------------------------------------------------- list */}
        <section className="ix-list">
          <header className="ix-list-head">
            <div className="ix-list-title">
              <h2>Inbox</h2>
              {unreadTotal > 0 ? (
                <span className="ix-title-n" key={unreadTotal}>
                  {unreadTotal}
                </span>
              ) : null}
              <span className="ix-title-actions">
                <button
                  type="button"
                  className="ix-iconbtn"
                  data-busy={refreshing || undefined}
                  title="Refresh"
                  aria-label="Refresh"
                  onClick={() => void refresh()}>
                  <IcoRefresh />
                </button>
                <button
                  type="button"
                  className="ix-compose"
                  title="New message"
                  aria-label="New message"
                  onClick={() => {
                    void ensureModels()
                    setClosing(false)
                    setPicker('new')
                    setPicked({})
                    setGroupTitle('')
                    setPickSearch('')
                    setNote(null)
                  }}>
                  <IcoPencil />
                </button>
              </span>
            </div>

            <div className="ix-search">
              <IcoSearch />
              <input
                placeholder="Search mail..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search mail"
              />
            </div>

            <div className="ix-tabs" role="tablist" aria-label="Filter threads">
              {tabButton('all', 'All', threads.length)}
              {tabButton('unread', 'Unread', unreadTotal)}
              {tabButton('files', 'Files', filesTotal)}
            </div>
          </header>

          <div className="ix-rows ix-scroll" key={tab}>
            {loading ? (
              Array.from({ length: 8 }, (_, index) => (
                <div className="ix-sk" key={index}>
                  <span className="ix-sk-av" />
                  <span className="ix-sk-lines">
                    <i />
                    <i />
                  </span>
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="ix-empty">
                <span className="ix-empty-glyph">
                  <IcoInbox />
                </span>
                <b>{threads.length === 0 ? 'No threads yet' : 'Nothing matches that'}</b>
              </div>
            ) : (
              filtered.map((one, index) => {
                const active = openId === one.id
                const face = threadFace(one)
                return (
                  <button
                    key={one.id}
                    type="button"
                    className="ix-row"
                    data-open={active || undefined}
                    data-unread={one.unread > 0 || undefined}
                    style={{ animationDelay: `${Math.min(index * 26, 260)}ms` }}
                    onClick={() => void openThread(one.id)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      openMenu('thread', one.id, event.clientX, event.clientY)
                    }}>
                    <span className="ix-face">
                      <Face name={face.name} photoId={face.photoId} src={face.src} />
                      {one.unread > 0 && !one.muted ? <i className="ix-dot" /> : null}
                    </span>

                    <span className="ix-row-body">
                      <span className="ix-row-top">
                        <span className="ix-row-name">{threadName(one)}</span>
                        <span className="ix-row-time">{one.last ? when(one.last.at) : when(one.created_at)}</span>
                      </span>

                      <span className="ix-row-prev">{previewOf(one)}</span>

                      <span className="ix-row-meta">
                        {one.muted ? <span className="ix-chip">Muted</span> : null}
                        {one.last?.attachment_type ? <span className="ix-chip">{attLabel(one.last.attachment_type)}</span> : null}
                        {one.members.length > 2 ? <span className="ix-chip">{one.members.length} people</span> : null}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </section>

        {/* -------------------------------------------------- conversation */}
        <section className="ix-convo">
          {thread ? (
            <>
              <header className="ix-convo-head">
                <button
                  type="button"
                  className="ix-back ix-iconbtn"
                  title="Back"
                  aria-label="Back to the list"
                  onClick={() => {
                    setOpenId(null)
                    setThread(null)
                    setMessages([])
                  }}>
                  <IcoBack />
                </button>

                <div className="ix-stack">
                  {isGroupOf(thread) ? (
                    <Face size="s" name={threadName(thread)} src={threadPhotoSrc(thread)} />
                  ) : (
                    <>
                      {thread.members.slice(0, 4).map((member) => (
                        <Face key={`${member.type}:${member.id}`} size="s" name={member.name ?? member.id} photoId={photoIdOf(member)} />
                      ))}
                      {thread.members.length > 4 ? <span className="ix-av ix-av--s ix-more">+{thread.members.length - 4}</span> : null}
                    </>
                  )}
                </div>

                <div className="ix-head-text">
                  <span className="ix-head-name">{threadName(thread)}</span>
                  {isGroupOf(thread) || thread.muted ? (
                    <span className="ix-head-sub">
                      {isGroupOf(thread) ? `${thread.members.length} people` : ''}
                      {isGroupOf(thread) && thread.muted ? ' \u00b7 ' : ''}
                      {thread.muted ? 'Muted' : ''}
                    </span>
                  ) : null}
                </div>

                <div className="ix-head-actions">
                  <button
                    className="ix-pill"
                    onClick={() => {
                      void ensureModels()
                      setClosing(false)
                      setPicker('add')
                      setPicked({})
                      setPickSearch('')
                    }}>
                    <IcoPlus /> Add people
                  </button>
                  <button
                    type="button"
                    className="ix-iconbtn"
                    data-busy={refreshing || undefined}
                    title="Refresh"
                    aria-label="Refresh"
                    onClick={() => void refresh()}>
                    <IcoRefresh />
                  </button>
                </div>
              </header>

              <div ref={scrollRef} className="ix-stream ix-scroll">
                {messages.length === 0 ? (
                  <div className="ix-empty">
                    <span className="ix-empty-glyph">
                      <IcoInbox />
                    </span>
                    <b>Nothing here yet</b>
                  </div>
                ) : (
                  messages.map((message, index) => {
                    const author = authorName(message)
                    const dayKey = message.at.slice(0, 10)
                    const prevKey = index > 0 ? messages[index - 1].at.slice(0, 10) : null
                    const src = `/api/inbox/file/${message.attachment_key}`
                    const delay = index < staggerCount ? Math.min(index * 22, 260) : 0
                    const isEditing = editing?.id === message.id
                    if (message.kind === 'system') {
                      return (
                        <Fragment key={message.id}>
                          {dayKey !== prevKey ? <span className="ix-day">{dayLabel(message.at)}</span> : null}
                          <span className="ix-sys" style={{ animationDelay: `${delay}ms` }}>
                            {message.body}
                          </span>
                        </Fragment>
                      )
                    }
                    return (
                      <Fragment key={message.id}>
                        {dayKey !== prevKey ? <span className="ix-day">{dayLabel(message.at)}</span> : null}
                        <div
                          className={`ix-msg${flashId === message.id ? ' ix-msg--flash' : ''}`}
                          data-side={message.author_type}
                          style={{ animationDelay: `${delay}ms` }}>
                          <Face
                            size="xs"
                            name={author}
                            photoId={message.author_type === 'model' && message.author_id ? message.author_id : null}
                          />
                          <div className="ix-msg-col">
                            <span className="ix-msg-meta">
                              <b>{author}</b> {'\u00b7'} {when(message.at)}
                              {message.edited && !message.deleted ? ' \u00b7 edited' : ''}
                              {!message.deleted && !isEditing ? (
                                <button
                                  type="button"
                                  className="ix-react-open"
                                  title="React"
                                  aria-label="React"
                                  onClick={(event) => {
                                    const rect = event.currentTarget.getBoundingClientRect()
                                    setReactFor({ id: message.id, x: rect.left, y: rect.bottom + 8 })
                                  }}>
                                  <IcoSmile />
                                </button>
                              ) : null}
                            </span>
                            {isEditing ? (
                              <div className="ix-bubble">
                                <div className="ix-edit">
                                  <textarea
                                    ref={editRef}
                                    autoFocus
                                    value={editing.body}
                                    onChange={(event) => setEditing({ id: message.id, body: event.target.value })}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault()
                                        void saveEdit(message.id)
                                      }
                                      if (event.key === 'Escape') {
                                        event.stopPropagation()
                                        setEditing(null)
                                      }
                                    }}
                                  />
                                  <div className="ix-edit-actions">
                                    <button type="button" className="ix-edit-cancel" onClick={() => setEditing(null)}>
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="ix-edit-save"
                                      disabled={!editing.body.trim()}
                                      onClick={() => void saveEdit(message.id)}>
                                      Save
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : message.deleted ? (
                              <div className="ix-bubble ix-bubble--gone">
                                {message.author_type === 'team' ? 'You deleted this message' : 'This message was deleted'}
                              </div>
                            ) : (
                              <div
                                className="ix-bubble"
                                onContextMenu={
                                  message.author_type === 'team'
                                    ? (event) => {
                                        event.preventDefault()
                                        openMenu('message', message.id, event.clientX, event.clientY)
                                      }
                                    : undefined
                                }>
                                {message.forwarded ? <span className="ix-fwd">Forwarded</span> : null}
                                {message.reply_to ? (
                                  <span className="ix-quote">
                                    <b>{message.reply_to.author_name ?? (message.reply_to.author_type === 'team' ? 'The team' : 'Model')}</b>
                                    <i>
                                      {message.reply_to.deleted
                                        ? 'Message deleted'
                                        : message.reply_to.body || attLabel(message.reply_to.attachment_type)}
                                    </i>
                                  </span>
                                ) : null}
                                {message.attachment_key && message.attachment_type?.startsWith('image/') ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    className="ix-att-img"
                                    src={src}
                                    alt={message.attachment_name ?? 'image'}
                                    onClick={() => setViewer({ src, name: message.attachment_name ?? 'photo.jpg' })}
                                  />
                                ) : null}
                                {message.attachment_key && message.attachment_type?.startsWith('video/') ? (
                                  <video className="ix-att-video" src={src} controls preload="metadata" />
                                ) : null}
                                {message.attachment_key && message.attachment_type?.startsWith('audio/') ? (
                                  <span className="ix-att-audio-wrap">
                                    <span>{attLabel(message.attachment_type)}</span>
                                    <audio className="ix-att-audio" src={src} controls preload="metadata" />
                                  </span>
                                ) : null}
                                {message.body ? <p>{message.body}</p> : null}
                              </div>
                            )}
                            {!isEditing && !message.deleted && message.reactions && message.reactions.length > 0 ? (
                              <span className="ix-reactions">
                                {message.reactions.map((reaction) => (
                                  <button
                                    key={reaction.emoji}
                                    type="button"
                                    className="ix-reaction"
                                    data-mine={reaction.mine || undefined}
                                    title="Tap to toggle"
                                    onClick={() => void toggleReaction(message.id, reaction.emoji)}>
                                    {reaction.emoji}
                                    {reaction.count > 1 ? <b>{reaction.count}</b> : null}
                                  </button>
                                ))}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </Fragment>
                    )
                  })
                )}
              </div>

              <div className="ix-composer">
                {pending ? (
                  <span className="ix-pending">
                    <b>{pending.name ?? attLabel(pending.type)}</b>
                    <button type="button" onClick={() => setPending(null)} aria-label="Remove attachment">
                      <IcoX />
                    </button>
                  </span>
                ) : null}
                <div className="ix-composer-bar">
                  <textarea
                    ref={composerRef}
                    rows={1}
                    placeholder="Write to them..."
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      const element = event.target
                      element.style.height = 'auto'
                      element.style.height = `${Math.min(element.scrollHeight, 150)}px`
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void send()
                      }
                    }}
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,video/*,audio/*"
                    hidden
                    onChange={(event) => {
                      void attach(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                  <button
                    type="button"
                    className="ix-attach"
                    title="Attach a file"
                    aria-label="Attach a file"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}>
                    <IcoClip />
                  </button>
                  <button
                    type="button"
                    className="ix-send"
                    title="Send"
                    aria-label="Send"
                    disabled={busy || (!draft.trim() && !pending)}
                    onClick={() => void send()}>
                    <IcoSend />
                  </button>
                </div>
                {note || uploading || busy ? (
                  <span className="ix-footline" data-tone={note?.bad ? 'bad' : undefined}>
                    {note ? note.text : uploading ? 'Uploading...' : 'Sending...'}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <div className="ix-empty" style={{ margin: 'auto' }}>
              <span className="ix-empty-glyph">
                <IcoInbox />
              </span>
              <b>Pick a thread on the left</b>
            </div>
          )}
        </section>

        {/* ------------------------------------------------- people/details */}
        <aside className="ix-rail ix-scroll">
          {thread ? (
            <>
              <div className="ix-hero" key={thread.id}>
                {isGroupOf(thread) ? (
                  <span className="ix-hero-face">
                    <Face size="lg" name={threadName(thread)} src={threadPhotoSrc(thread)} />
                    <button
                      type="button"
                      className="ix-hero-shot"
                      title="Set group photo"
                      aria-label="Set group photo"
                      disabled={shotBusy}
                      onClick={() => groupShotRef.current?.click()}>
                      <IcoCamera />
                    </button>
                    <input
                      ref={groupShotRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => {
                        void setGroupPhoto(event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                  </span>
                ) : (
                  <Face size="lg" name={lead?.name ?? threadName(thread)} photoId={photoIdOf(lead)} />
                )}
                <div className="ix-hero-text">
                  {renaming && isGroupOf(thread) ? (
                    <span className="ix-hero-rename">
                      <input
                        className="ix-hero-input"
                        value={nameDraft}
                        autoFocus
                        placeholder="Group name"
                        maxLength={80}
                        onChange={(event) => setNameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveGroupName()
                          if (event.key === 'Escape') setRenaming(false)
                        }}
                      />
                      <button type="button" className="ix-hero-save" onClick={() => void saveGroupName()}>
                        Save
                      </button>
                    </span>
                  ) : (
                    <>
                      <b>{threadName(thread)}</b>
                      <span>
                        {thread.members.length > 2
                          ? `Group \u00b7 ${thread.members.length} people`
                          : thread.members.length > 1
                            ? `${thread.members.length} people`
                            : lead?.type === 'team'
                              ? 'Team'
                              : 'Model'}
                      </span>
                    </>
                  )}
                </div>
                {isGroupOf(thread) && !renaming ? (
                  <button
                    type="button"
                    className="ix-hero-pencil"
                    title="Rename group"
                    aria-label="Rename group"
                    onClick={() => {
                      setNameDraft(thread.title ?? '')
                      setRenaming(true)
                    }}>
                    <IcoPencil />
                  </button>
                ) : null}
              </div>

              <div className="ix-sec">
                <span className="ix-sec-name">
                  People
                  <span>{thread.members.length}</span>
                </span>
                {thread.members.map((member) => (
                  <div className="ix-person" key={`${member.type}:${member.id}`}>
                    <Face size="s" name={member.name ?? member.id} photoId={photoIdOf(member)} />
                    <span className="ix-person-text">
                      <b>{member.name ?? member.id}</b>
                    </span>
                    <span className="ix-chip">
                      {member.type === 'team' ? (me && member.id === me.id ? 'You' : 'Team') : 'Model'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="ix-sec">
                <span className="ix-sec-name">Details</span>
                <span className="ix-detail">
                  Created <b>{when(thread.created_at)}</b>
                </span>
                <span className="ix-detail">
                  Messages <b>{thread.messages_count}</b>
                </span>
                <span className="ix-detail">
                  Files <b>{thread.files}</b>
                </span>
              </div>

              {files.length > 0 ? (
                <div className="ix-sec">
                  <span className="ix-sec-name">
                    Shared
                    <span>{files.length}</span>
                  </span>
                  <div className="ix-files">
                    {files.map((file, index) => {
                      const href = `/api/inbox/file/${file.attachment_key}`
                      const isImage = file.attachment_type?.startsWith('image/')
                      const isVideo = file.attachment_type?.startsWith('video/')
                      const tile = (
                        <>
                          {isImage ? <img src={href} alt={file.attachment_name ?? 'photo'} loading="lazy" /> : null}
                          {isVideo ? <video src={`${href}#t=0.1`} muted playsInline preload="metadata" /> : null}
                          {!isImage && !isVideo ? (
                            <span>
                              <IcoDoc />
                              {file.attachment_name ?? attLabel(file.attachment_type)}
                            </span>
                          ) : null}
                          <span className="ix-file-tag">{attLabel(file.attachment_type)}</span>
                          <span className="ix-file-time">{when(file.at)}</span>
                        </>
                      )
                      return isImage ? (
                        <button
                          key={file.id}
                          type="button"
                          className="ix-file"
                          title={`View ${file.attachment_name ?? 'photo'}`}
                          style={{ animationDelay: `${Math.min(index * 40, 240)}ms` }}
                          onClick={() => setViewer({ src: href, name: file.attachment_name ?? 'photo.jpg' })}>
                          {tile}
                        </button>
                      ) : (
                        <a
                          key={file.id}
                          className={`ix-file${!isImage && !isVideo ? ' ix-file--doc' : ''}`}
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          title={file.attachment_name ?? attLabel(file.attachment_type)}
                          style={{ animationDelay: `${Math.min(index * 40, 240)}ms` }}>
                          {tile}
                        </a>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="ix-sec">
              <span className="ix-sec-name">People</span>
              <span className="ix-detail">Open a thread to see who is in it.</span>
            </div>
          )}
        </aside>
      </div>

      {/* ------------------------------------------- the right-click menu */}
      {menu ? (
        <div
          className="ix-menu-veil"
          data-closing={menuClosing || undefined}
          onClick={closeMenu}
          onContextMenu={(event) => {
            event.preventDefault()
            closeMenu()
          }}>
          <div
            className="ix-menu"
            data-closing={menuClosing || undefined}
            style={{ left: menu.x, top: menu.y }}
            onClick={(event) => event.stopPropagation()}>
            {menu.kind === 'thread' && menuThread ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void threadAction(menuThread.unread > 0 ? 'mark-read' : 'mark-unread', menuThread.id)
                    closeMenu()
                  }}>
                  <IcoEnvelope />
                  {menuThread.unread > 0 ? 'Mark as read' : 'Mark as unread'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void threadAction(menuThread.muted ? 'unmute' : 'mute', menuThread.id)
                    closeMenu()
                  }}>
                  <IcoBell />
                  {menuThread.muted ? 'Unmute' : 'Mute'}
                </button>
                <span className="ix-menu-sep" />
                <button
                  type="button"
                  className="ix-menu-danger"
                  onClick={() => {
                    if (!menuSure) {
                      setMenuSure(true)
                      return
                    }
                    void removeThread(menuThread.id)
                    closeMenu()
                  }}>
                  <IcoTrash />
                  {menuSure ? 'Sure? Delete it' : 'Delete chat'}
                </button>
              </>
            ) : null}

            {menu.kind === 'message' && menuMessage ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing({ id: menuMessage.id, body: menuMessage.body })
                    closeMenu()
                  }}>
                  <IcoPencil />
                  Edit message
                </button>
                <span className="ix-menu-sep" />
                <button
                  type="button"
                  className="ix-menu-danger"
                  onClick={() => {
                    if (!menuSure) {
                      setMenuSure(true)
                      return
                    }
                    void removeMessage(menuMessage.id)
                    closeMenu()
                  }}>
                  <IcoTrash />
                  {menuSure ? 'Sure? Delete it' : 'Delete message'}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------- the reaction bar */}
      {reactFor ? (
        <div
          className="ix-react-veil"
          onClick={() => setReactFor(null)}
          onContextMenu={(event) => {
            event.preventDefault()
            setReactFor(null)
          }}>
          <div
            className="ix-react-bar"
            style={{
              left: Math.max(8, Math.min(reactFor.x, window.innerWidth - REACT_BAR_W - 8)),
              top: Math.max(8, Math.min(reactFor.y, window.innerHeight - 68)),
            }}
            onClick={(event) => event.stopPropagation()}>
            {REACT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  void toggleReaction(reactFor.id, emoji)
                  setReactFor(null)
                }}>
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Tap an image: full view, download, done */}
      {viewer ? (
        <div className="ix-viewer" onClick={() => setViewer(null)}>
          <div className="ix-viewer-bar" onClick={(event) => event.stopPropagation()}>
            <span className="ix-viewer-name">{viewer.name}</span>
            <button type="button" onClick={() => void downloadViewer()}>
              <span style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 6 }}>
                <IcoDownload />
              </span>
              Download
            </button>
            <button type="button" className="ix-viewer-x" aria-label="Close" onClick={() => setViewer(null)}>
              <IcoX />
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewer.src} alt={viewer.name} onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}

      {/* New message / add people - fades in, fades out */}
      {picker ? (
        <div className="ix-modal-veil" data-closing={closing || undefined} onClick={closePicker}>
          <div
            className="adddialog ix-dialog ix-modal-card"
            data-closing={closing || undefined}
            role="dialog"
            aria-modal="true"
            style={{ width: 'min(560px, 100%)', maxHeight: '86vh', overflowY: 'auto' }}
            onClick={(event) => event.stopPropagation()}>
            <header className="adddialog-head">
              <div>
                <p className="adddialog-kicker">{picker === 'new' ? 'Start' : 'Grow'}</p>
                <h2>{picker === 'new' ? 'New message' : 'Add people'}</h2>
              </div>
              <button className="adddialog-x" onClick={closePicker} aria-label="Close">
                ×
              </button>
            </header>

            <div className="adddialog-body">
              {picker === 'new' ? (
                <div className="form-row">
                  <label className="axis-name" htmlFor="thread-title">
                    Group name (optional)
                  </label>
                  <input
                    id="thread-title"
                    className="field"
                    value={groupTitle}
                    placeholder="e.g. Weekend shoot"
                    onChange={(event) => setGroupTitle(event.target.value)}
                  />
                </div>
              ) : null}

              <div className="ix-search">
                <IcoSearch />
                <input
                  placeholder="Search people..."
                  value={pickSearch}
                  onChange={(event) => setPickSearch(event.target.value)}
                  aria-label="Search people"
                />
              </div>

              {pickedCount > 0 ? (
                <div className="ix-pick-tray">
                  {Object.values(picked).map((member) => (
                    <span className="ix-tray-chip" key={`${member.type}:${member.id}`}>
                      <Face size="tiny" name={member.name ?? member.id} photoId={photoIdOf(member)} />
                      {member.name ?? member.id}
                      <button type="button" onClick={() => togglePick(member)} aria-label={`Remove ${member.name ?? member.id}`}>
                        <IcoX />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="ix-people ix-scroll">
                {picker === 'new' ? (
                  <div className="ix-group">
                    <span className="ix-group-name">
                      Models <b>{filteredModels.length}</b>
                    </span>
                    {filteredModels.length === 0 ? <span className="ix-people-empty">No models match that.</span> : null}
                    {filteredModels.map((model, index) => {
                      const key = `model:${model.id}`
                      const on = Boolean(picked[key])
                      return (
                        <button
                          key={key}
                          type="button"
                          className="ix-choice"
                          data-on={on || undefined}
                          style={{ animationDelay: `${Math.min(index * 12, 140)}ms` }}
                          onClick={() => togglePick({ type: 'model', id: model.id, name: model.name })}>
                          <Face size="s" name={model.name} photoId={model.id} />
                          <span className="ix-choice-text">
                            <b>{model.name}</b>
                            <small>Model</small>
                          </span>
                          <span className="ix-choice-mark">{on ? <IcoCheck /> : <IcoPlus />}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                <div className="ix-group">
                  <span className="ix-group-name">
                    Team <b>{filteredTeam.length}</b>
                  </span>
                  {filteredTeam.length === 0 ? (
                    <span className="ix-people-empty">
                      {picker === 'add' ? 'Everyone who can be added is already in.' : 'No team members match that.'}
                    </span>
                  ) : null}
                  {filteredTeam.map((member, index) => {
                    const key = `team:${member.id}`
                    const label = member.name ?? member.email.split('@')[0]
                    const on = Boolean(picked[key])
                    return (
                      <button
                        key={key}
                        type="button"
                        className="ix-choice"
                        data-on={on || undefined}
                        style={{ animationDelay: `${Math.min(index * 12, 140)}ms` }}
                        onClick={() => togglePick({ type: 'team', id: member.id, name: label })}>
                        <Face size="s" name={label} />
                        <span className="ix-choice-text">
                          <b>
                            {label}
                            {me && member.id === me.id ? ' (You)' : ''}
                          </b>
                          <small>{member.role === 'ceo' ? 'CEO' : member.role === 'admin' ? 'Admin' : 'Member'}</small>
                        </span>
                        <span className="ix-choice-mark">{on ? <IcoCheck /> : <IcoPlus />}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {note ? (
                <span className="ix-footline" data-tone={note.bad ? 'bad' : undefined}>
                  {note.text}
                </span>
              ) : null}
            </div>

            <footer className="adddialog-foot">
              <span className="adddialog-note">{pickedCount > 0 ? `${pickedCount} picked` : ''}</span>
              <button className="adddialog-cancel" onClick={closePicker}>
                Cancel
              </button>
              <button
                className="adddialog-save"
                disabled={pickedCount === 0}
                onClick={() => (picker === 'new' ? void createThread() : void addPeople())}>
                {picker === 'new' ? 'Create thread' : 'Add them'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  )
}
