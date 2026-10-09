'use client'

import { DayPicker, type DayPickerProps } from 'react-day-picker'
import 'react-day-picker/style.css'

/**
 * Calendar — DayPicker wrapped for this console (same idea as shadcn's
 * Calendar, styled with Sinaura tokens instead of Tailwind).
 */
export type CalendarProps = DayPickerProps

export function Calendar({
  className,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={['rdp-root', 'sc-calendar', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
