const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/

export const DAY_MS = 86400000

export function parseLocalDate(value) {
  if (!value) return null

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }

  if (typeof value === 'string') {
    const match = DATE_PREFIX.exec(value.trim())
    if (match) {
      const year = Number(match[1])
      const month = Number(match[2])
      const day = Number(match[3])
      const date = new Date(year, month - 1, day)
      if (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
      ) {
        return date
      }
      return null
    }
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function startOfDay(value = new Date()) {
  return parseLocalDate(value)
}

export function formatDateOnly(value = new Date()) {
  const date = parseLocalDate(value) || parseLocalDate(new Date())
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDisplayDate(value, options) {
  const date = parseLocalDate(value)
  return date ? date.toLocaleDateString(undefined, options) : 'N/A'
}

export function daysBetween(start, end) {
  const a = parseLocalDate(start)
  const b = parseLocalDate(end)
  if (!a || !b) return 0
  return calendarDayNumber(b) - calendarDayNumber(a)
}

// Convert a local calendar date to a timezone-independent day number. Local
// midnights can be 23 or 25 hours apart around DST transitions, so subtracting
// Date objects and dividing by 24 hours is not safe for calendar-day labels.
export function calendarDayNumber(value) {
  const date = parseLocalDate(value)
  if (!date) return 0
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS)
}

export function addDays(value, days) {
  const date = parseLocalDate(value)
  if (!date) return null
  date.setDate(date.getDate() + days)
  return date
}

export function addMonthsClamped(value, months, anchorDay) {
  const date = parseLocalDate(value)
  if (!date) return null
  const desiredDay = anchorDay || date.getDate()
  const firstOfTarget = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate()
  return new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), Math.min(desiredDay, lastDay))
}
