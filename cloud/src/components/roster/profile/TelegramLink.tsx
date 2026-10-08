'use client'

import { useState } from 'react'
import { useLive } from '@/lib/live'
import DropSelect from '../../dashboard/DropSelect'

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
  // The bot's group list changes slowly and serves every model, so it is read
  // through the cache: the first sheet warms it, the rest open with it. Settled
  // without a list still counts as read, or a failed fetch reads as "Loading…"
  // forever.
  const groupsLive = useLive<{ groups: Group[] }>('/api/bot/groups')
  const groups = groupsLive.ready ? (groupsLive.data?.groups ?? []) : null
  const [chatId, setChatId] = useState(initial)
  const [note, setNote] = useState<string | null>(null)

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
    setNote(value
      ? `Linked. "Send on Telegram" now posts their plan there.${body.questionnaire_queued ? ' Her creator questionnaire is on its way too.' : ''}`
      : 'Unlinked.')
  }

  const current = groups?.find((group) => group.chat_id === chatId) ?? null
  const gone = Boolean(chatId && groups && !current)

  return (
    <div className="form-row">
      <label className="axis-name" htmlFor="model-telegram">Telegram group — where the bot posts their plan</label>
      <DropSelect
        id="model-telegram"
        label="Telegram group"
        value={current ? chatId ?? '' : ''}
        disabled={!groups}
        onChange={(next) => void link(next)}
        options={[
          { value: '', label: groups ? 'Not linked' : 'Loading the bot’s groups…' },
          ...(groups ?? []).map((group) => {
            const others = (group.linked_to ?? []).filter(Boolean)
            const taken = others.length > 0 && group.chat_id !== chatId
            return {
              value: group.chat_id,
              label: `${group.title}${group.creator_name ? ` · ${group.creator_name}` : ''}` +
                `${group.skip_campaigns ? ' · marketing off' : ''}` +
                `${taken ? ` · linked to ${others.join(', ')}` : ''}`,
            }
          }),
        ]}
      />
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
