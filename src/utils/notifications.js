import { getDaysUntilBilling, getNextBillingDate, getEffectiveAmount } from './stats'
import { isCanceled, isReminder } from './subscriptions'
import { formatMoney } from './currencies'
import { daysBetween, formatDateOnly, parseLocalDate } from './dates'

const NOTIFIED_KEY = 'st-notified'

export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function getPermission() {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

export async function requestPermission() {
  if (!isNotificationSupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const result = await Notification.requestPermission()
    return result
  } catch {
    return 'denied'
  }
}

function loadNotifiedMap() {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveNotifiedMap(map) {
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(map))
  } catch {}
}

function billingKey(sub) {
  return formatDateOnly(getNextBillingDate(sub))
}

export function checkUpcomingBills(subs, settings) {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return 0
  if (!settings || settings.notifications === false) return 0
  const reminderWindow = Math.max(1, parseInt(settings.reminderDays) || 3)
  const currency = settings.currency || 'USD'
  const notified = loadNotifiedMap()
  let sent = 0
  const cutoffMs = Date.now() - 30 * 86400000

  Object.keys(notified).forEach(k => {
    const ts = notified[k]
    if (typeof ts === 'number' && ts < cutoffMs) delete notified[k]
  })

  subs.forEach(s => {
    if (s.paused || isCanceled(s)) return

    // One-time reminders warn before their end date instead of a billing day.
    if (isReminder(s)) {
      const end = parseLocalDate(s.endDate)
      if (!end) return
      const days = daysBetween(new Date(), end)
      if (days < 0 || days > reminderWindow) return
      const key = `${s.id}:end:${formatDateOnly(end)}`
      if (notified[key]) return
      try {
        const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
        new Notification(`${s.name} ends soon`, {
          body: `Ends ${when} · one-time purchase — rebuy or let it go`,
          tag: key,
          icon: '/icon.svg',
          silent: false,
        })
        notified[key] = Date.now()
        sent++
      } catch (e) {
        console.warn('Notification failed', e)
      }
      return
    }

    const isTrial = s.isTrial && parseLocalDate(s.trialEnd)
    const days = isTrial ? daysBetween(new Date(), s.trialEnd) : getDaysUntilBilling(s)
    if (days < 0 || days > reminderWindow) return
    const eventDate = isTrial ? formatDateOnly(s.trialEnd) : billingKey(s)
    const key = `${s.id}:${isTrial ? 'trial' : 'bill'}:${eventDate}`
    if (notified[key]) return
    try {
      const amt = formatMoney(getEffectiveAmount(s), s.currency || currency)
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
      const body = isTrial ? `Trial ends ${when} · review before ${amt} is charged` : `Due ${when} · ${amt}`
      new Notification(isTrial ? `${s.name} trial ending` : `${s.name} renewal`, {
        body,
        tag: key,
        icon: '/icon.svg',
        silent: false,
      })
      notified[key] = Date.now()
      sent++
    } catch (e) {
      console.warn('Notification failed', e)
    }
  })

  saveNotifiedMap(notified)
  return sent
}
