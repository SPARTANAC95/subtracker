import { addDays, addMonthsClamped, formatDateOnly, parseLocalDate, startOfDay } from './dates.js'
import { getBillsInRange } from './stats.js'
import { isCanceled, isReminder } from './subscriptions.js'
import { downloadBlob } from './download.js'

function escapeIcs(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function icsDay(value) {
  return formatDateOnly(value).replaceAll('-', '')
}

// RFC 5545 requires DTSTAMP on every VEVENT. Google Calendar and Outlook
// reject or silently drop events without it.
function icsTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function eventBlock({ uid, title, date, description, stamp }) {
  const end = addDays(date, 1)
  return [
    'BEGIN:VEVENT',
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDay(date)}`,
    `DTEND;VALUE=DATE:${icsDay(end)}`,
    `SUMMARY:${escapeIcs(title)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    'END:VEVENT',
  ].join('\r\n')
}

export function buildCalendarIcs(subs, options = {}) {
  const start = startOfDay(options.start || new Date())
  const end = startOfDay(options.end || addMonthsClamped(start, 12, start.getDate()))
  const stamp = icsTimestamp(options.now instanceof Date ? options.now : new Date())
  const events = []

  subs.filter(sub => !sub.paused && !isCanceled(sub)).forEach(sub => {
    // One-time reminders export their end date, not a renewal series.
    if (isReminder(sub)) {
      const endDate = parseLocalDate(sub.endDate)
      if (endDate && endDate >= start && endDate <= end) {
        events.push(eventBlock({
          uid: `${sub.id}-end-${formatDateOnly(endDate)}@subtracker.local`,
          title: `${sub.name} ends`,
          date: endDate,
          description: 'One-time purchase runs out today. Rebuy it or let it go.',
          stamp,
        }))
      }
      return
    }

    if (sub.isTrial) {
      const trialEnd = parseLocalDate(sub.trialEnd)
      if (trialEnd && trialEnd >= start && trialEnd <= end) {
        events.push(eventBlock({
          uid: `${sub.id}-trial-${formatDateOnly(trialEnd)}@subtracker.local`,
          title: `${sub.name} trial ends`,
          date: trialEnd,
          description: 'Review this trial before it converts to a paid subscription.',
          stamp,
        }))
      }
      return
    }

    getBillsInRange(sub, start, end).forEach(date => {
      events.push(eventBlock({
        uid: `${sub.id}-${formatDateOnly(date)}@subtracker.local`,
        title: `${sub.name} renewal`,
        date,
        description: `Scheduled ${sub.cycle || 'recurring'} renewal. Confirm the amount in SubTracker.`,
        stamp,
      }))
    })
  })

  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SubTracker Pro//Renewals//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].join('\r\n')
}

export function downloadCalendarIcs(subs) {
  const blob = new Blob([buildCalendarIcs(subs)], { type: 'text/calendar;charset=utf-8' })
  downloadBlob(blob, `subtracker-renewals-${formatDateOnly(new Date())}.ics`)
}
