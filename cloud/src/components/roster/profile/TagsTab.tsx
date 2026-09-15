'use client'

import AxisPicker from '../AxisPicker'
import type { ProfileForm, SetField } from './form'

/** What she does, in the library's own vocabulary — the half of her profile
 *  that `match.ts` actually reads when it decides what to put on her week. */
export default function TagsTab({
  form,
  set,
  setForm,
}: {
  form: ProfileForm
  set: SetField
  /** Two of these pickers have to change two fields at once, because a format
   *  cannot be both something she does and something she refuses. */
  setForm: (update: (current: ProfileForm) => ProfileForm) => void
}) {
  return (
    <>
      <AxisPicker
        title="Persona"
        axis="persona"
        chosen={form.persona}
        hint="Where she sits, in the same vocabulary as the library."
        onChange={(next) => set('persona', next)}
      />

      <AxisPicker
        title="Formats she does"
        axis="format"
        chosen={form.formats}
        hint="Tick what she can actually shoot. This is what drives recommendations."
        onChange={(next) =>
          setForm((current) => ({
            ...current,
            formats: next,
            wont_do: current.wont_do.filter((tag) => !next.includes(tag)),
          }))
        }
      />

      <AxisPicker
        title="Hooks that work for her"
        axis="hook"
        chosen={form.hooks}
        hint="Optional — a tiebreaker, not a requirement."
        onChange={(next) => set('hooks', next)}
      />

      <AxisPicker
        title="Won't do"
        axis="format"
        tone="refuse"
        chosen={form.wont_do}
        hint="Anything here is excluded outright, never just ranked lower."
        onChange={(next) =>
          setForm((current) => ({
            ...current,
            wont_do: next,
            formats: current.formats.filter((tag) => !next.includes(tag)),
          }))
        }
      />
    </>
  )
}
