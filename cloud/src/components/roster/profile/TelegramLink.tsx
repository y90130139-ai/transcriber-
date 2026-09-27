'use client'

import { useEffect, useState } from 'react'

type Group = {
  chat_id: string
  title: string
  creator_name: string | null
  skip_campaigns: boolean
  linked_to: string[] | null
}

/**
 * Which Gosian bot group this model's plans are posted in.
 *
 * Saved the moment it is picked, apart from the profile form: it is a link to
 * something outside this app, not part of her sheet. The list is whatever the
 * bot last shared; a model linked to a group the bot has since dropped is told
 * so, not quietly unlinked.
 */
export default function TelegramLink({ modelId, initial }: { modelId: string; initial: string | null }) {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [chatId, setChatId] = useState(initial)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/bot/groups')
      .then((response) => (response.ok ? response.json() : { groups: [] }))
      .then((body) => setGroups(body.groups ?? []))
      .catch(() => setGroups([]))
  }, [])

  async function link(next: string) {
    const value = next || null
    setNote('Saving…')
    const response = await fetch(`/api/models/${modelId}/telegram`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: value }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) { setNote(body.error ?? 'That did not save.'); return }
    setChatId(body.telegram_chat_id ?? null)
    setNote(value ? 'Linked. "Send on Telegram" now posts their plan there.' : 'Unlinked.')
  }

  const current = groups?.find((group) => group.chat_id === chatId) ?? null
  const gone = Boolean(chatId && groups && !current)

  return (
    <div className="form-row">
      <label className="axis-name" htmlFor="model-telegram">Telegram group — where the bot posts their plan</label>
      <select
        id="model-telegram"
        className="field"
        value={current ? chatId ?? '' : ''}
        disabled={!groups}
        onChange={(event) => void link(event.target.value)}
      >
        <option value="">{groups ? 'Not linked' : 'Loading the bot’s groups…'}</option>
        {(groups ?? []).map((group) => {
          const others = (group.linked_to ?? []).filter(Boolean)
          const taken = others.length > 0 && group.chat_id !== chatId
          return (
            <option key={group.chat_id} value={group.chat_id}>
              {group.title}
              {group.creator_name ? ` · ${group.creator_name}` : ''}
              {group.skip_campaigns ? ' · marketing off' : ''}
              {taken ? ` · linked to ${others.join(', ')}` : ''}
            </option>
          )
        })}
      </select>
      <span className="hint" role="status">
        {note ??
          (gone
            ? 'Their linked group is no longer on the bot. Pick another, or send plans yourself.'
            : groups && groups.length === 0
              ? 'The bot has not shared its groups yet.'
              : !chatId
                ? 'No Telegram linked — "Send on Telegram" is off for them until one is picked.'
                : current?.skip_campaigns
                  ? 'This group is switched off for marketing on the bot, so nothing will be posted there.'
                  : 'Plans sent with "Send on Telegram" go to MARKETING in this group.')}
      </span>
    </div>
  )
}
