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

// Semantic palette of the black & gold theme: sage / gold / sand / terracotta.
// Rendered as `.status-pill` with these inline colors.
export const STATUS_STYLES = {
  active: { label: 'Active', color: '#9ec8a0', bg: 'rgba(158,200,160,0.1)' },
  trial: { label: 'Trial', color: '#e1ad66', bg: 'rgba(225,173,102,0.12)' },
  paused: { label: 'Paused', color: '#d9c28b', bg: 'rgba(217,194,139,0.1)' },
  canceled: { label: 'Canceled', color: 'rgba(242,240,234,0.45)', bg: 'rgba(242,240,234,0.07)' },
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
// Same semantic palette as STATUS_STYLES: sage = fine, sand = act soon,
// terracotta = past due.
export const REMINDER_ENDING_SOON_DAYS = 30

export function reminderState(days) {
  if (days == null || Number.isNaN(days)) return { id: 'undated', label: 'No end date', color: 'rgba(242,240,234,0.45)', bg: 'rgba(242,240,234,0.07)' }
  if (days < 0) return { id: 'expired', label: 'Expired', color: '#d99f8b', bg: 'rgba(217,159,139,0.12)' }
  if (days <= REMINDER_ENDING_SOON_DAYS) return { id: 'soon', label: 'Ends soon', color: '#d9c28b', bg: 'rgba(217,194,139,0.12)' }
  return { id: 'ok', label: 'Active', color: '#9ec8a0', bg: 'rgba(158,200,160,0.1)' }
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
