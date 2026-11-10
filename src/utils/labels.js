// Presentation vocabulary shared by the list, the detail drawer and the
// dashboard. These used to be copy-pasted per component and had already
// drifted apart.

export const CYCLE_LABELS = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Semi-annual',
  yearly: 'Yearly',
}

// Lifecycle states and the badge tone each one renders with (`.status.<tone>`
// in index.css): ok = sage, accent = lavender, warn = amber, muted = grey.
export const STATUS_STYLES = {
  active: { label: 'Active', tone: 'ok' },
  trial: { label: 'Trial', tone: 'accent' },
  paused: { label: 'Paused', tone: 'warn' },
  canceled: { label: 'Canceled', tone: 'muted' },
}

export function cycleLabel(cycle) {
  return CYCLE_LABELS[cycle] || cycle || 'Monthly'
}

export function plural(count, word) {
  return count === 1 ? word : `${word}s`
}

// A signed day offset rendered as human copy. Negative days are overdue —
// the previous per-component versions rendered them as "In -5 days".
export function relativeDay(days) {
  if (days == null || Number.isNaN(days)) return 'Not scheduled'
  if (days < 0) return `${Math.abs(days)} ${plural(Math.abs(days), 'day')} overdue`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

// Lowercase variant for mid-sentence use ("Netflix trial ends in 3 days").
export function relativeDayPhrase(days) {
  if (days == null || Number.isNaN(days)) return 'not scheduled'
  if (days < 0) return `${Math.abs(days)} ${plural(Math.abs(days), 'day')} overdue`
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

// Payment methods the form offers. Kept here so the detail drawer and exports
// render the same label the user picked ("PayPal", not "Paypal").
export const PAYMENT_METHODS = [
  { id: '', label: 'Not set' },
  { id: 'visa', label: 'Visa' },
  { id: 'mastercard', label: 'Mastercard' },
  { id: 'amex', label: 'Amex' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'apple', label: 'Apple Pay' },
  { id: 'google', label: 'Google Pay' },
  { id: 'bank', label: 'Bank Transfer' },
]

export function paymentLabel(id) {
  const value = String(id ?? '').trim()
  if (!value) return ''
  const known = PAYMENT_METHODS.find(method => method.id === value.toLowerCase())
  if (known) return known.label
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// One-time reminder lifecycle, keyed off the signed days until its end date.
// Same tones as STATUS_STYLES: ok = fine, warn = act soon, danger = past due.
export const REMINDER_ENDING_SOON_DAYS = 30

// A reminder whose end date came from an import and was never confirmed.
export const UNVERIFIED_REMINDER = { id: 'unverified', label: 'Unverified date', tone: 'muted' }

export function reminderState(days) {
  if (days == null || Number.isNaN(days)) return { id: 'undated', label: 'No end date', tone: 'muted' }
  if (days < 0) return { id: 'expired', label: 'Expired', tone: 'danger' }
  if (days <= REMINDER_ENDING_SOON_DAYS) return { id: 'soon', label: 'Ends soon', tone: 'warn' }
  return { id: 'ok', label: 'Active', tone: 'ok' }
}

// The palette chord is Cmd on a Mac and Ctrl everywhere else; labels should
// say which one this machine actually uses.
export const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'

export function reminderEndPhrase(days) {
  if (days == null || Number.isNaN(days)) return 'No end date set'
  if (days < 0) return `Ended ${Math.abs(days)} ${plural(Math.abs(days), 'day')} ago`
  if (days === 0) return 'Ends today'
  if (days === 1) return 'Ends tomorrow'
  return `Ends in ${days} days`
}
