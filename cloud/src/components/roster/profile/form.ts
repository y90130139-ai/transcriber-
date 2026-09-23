/** The editable shape of a model, shared by the profile sheet and its tabs.
 *
 *  Lifted out of the sheet itself so each tab can be typed against it without
 *  importing the component that owns it, and so `BLANK` and `fromModel` stay
 *  the single answer to "what does a new model start as". */
import { isCreatorType, type CreatorType } from '@/lib/models'
import type { Social } from '@/lib/socials'
import { DEFAULT_ZONE, displayPlace, placeFor } from '@/lib/timezones'
import type { Model } from '../types'

/** What a new model gets in the delivery note before anyone types anything.
 *  Geno's decision on 2026-09-06: the Drive folder is the route, the Telegram
 *  marketing channel is the stated alternative. Pre-filled rather than
 *  required, because the failure this exists to prevent is the field being
 *  left empty and her having nowhere to send a week of footage. */
export const DELIVERY_NOTE_DEFAULT =
  'Drop the finished videos in your Drive folder. If it will not open, send them in the Telegram channel.'

export type ProfileForm = {
  name: string
  handle: string
  photo_url: string | null
  socials: Social[]
  persona: string[]
  formats: string[]
  hooks: string[]
  wont_do: string[]
  status: 'active' | 'paused'
  tier: 'A' | 'B' | 'C'
  filming_days: number[]
  weekly_target: number
  timezone: string
  /** The place is what the picker is keyed on; the zone is what everything
   *  else reads. Both are held so the picker can show what was picked. */
  place: string | null
  standing_rules: string
  notes: string
  drive_url: string
  delivery_note: string
  ig_account_type: 'unknown' | 'personal' | 'professional'
  creator_type: CreatorType
}

export type SetField = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => void

export const BLANK: ProfileForm = {
  name: '',
  handle: '',
  photo_url: null,
  socials: [],
  persona: [],
  formats: [],
  hooks: [],
  wont_do: [],
  status: 'active',
  tier: 'B',
  filming_days: [],
  weekly_target: 21,
  timezone: DEFAULT_ZONE,
  place: placeFor(DEFAULT_ZONE),
  standing_rules: '',
  notes: '',
  drive_url: '',
  // Unknown until somebody has looked at her account, which is not the same
  // as personal. Only a professional account can ever hand back Insights.
  ig_account_type: 'unknown',
  creator_type: 'unknown',
  delivery_note: DELIVERY_NOTE_DEFAULT,
}

export function fromModel(model: Model): ProfileForm {
  return {
    name: model.name,
    handle: model.handle ?? '',
    photo_url: model.photo_url,
    socials: model.socials ?? [],
    persona: model.persona,
    formats: model.formats ?? [],
    hooks: model.hooks ?? [],
    wont_do: model.wont_do ?? [],
    status: model.status,
    tier: model.tier ?? 'B',
    filming_days: model.filming_days,
    weekly_target: model.weekly_target,
    timezone: model.timezone,
    place: displayPlace(model.place ?? null, model.timezone),
    standing_rules: model.standing_rules ?? '',
    notes: model.notes ?? '',
    drive_url: model.drive_url ?? '',
    // An existing model has no note until she is next saved. The default is
    // offered to her too — an empty box here is the bug, not a state worth
    // preserving.
    delivery_note: model.delivery_note ?? DELIVERY_NOTE_DEFAULT,
    ig_account_type: model.ig_account_type ?? 'unknown',
    creator_type: isCreatorType(model.creator_type) ? model.creator_type : 'unknown',
  }
}
