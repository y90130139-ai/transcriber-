'use client'

import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import DropSelect from '../dashboard/DropSelect'

export type Target = { id: string; name: string }

/** This week and next. Anything further out is a plan nobody is writing yet. */
export function assignableWeeks(): string[] {
  const thisWeek = currentWeekOf()
  return [thisWeek, addDays(thisWeek, 7)]
}

/**
 * Her, and which week.
 *
 * Lifted out of `AssignBar` unchanged so the bulk path in the library's
 * selection bar offers exactly the same two controls the single-item path
 * always has — same markup, same classes, same weeks. Two pickers that drift
 * apart is how "add to her week" starts meaning two different things.
 */
export default function ModelWeekPicker({
  models,
  modelId,
  weekOf,
  onModel,
  onWeek,
}: {
  models: Target[]
  modelId: string
  weekOf: string
  onModel: (id: string) => void
  onWeek: (week: string) => void
}) {
  return (
    <>
      <DropSelect
        value={modelId}
        onChange={onModel}
        label="Model"
        options={models.map((model) => ({ value: model.id, label: model.name }))}
      />
      <DropSelect
        value={weekOf}
        onChange={onWeek}
        label="Week"
        options={assignableWeeks().map((week, index) => ({
          value: week,
          label: `${index === 0 ? 'This week' : 'Next week'} · ${formatDate(week)}`,
        }))}
      />
    </>
  )
}
