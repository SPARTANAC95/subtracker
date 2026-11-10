import { CATEGORIES } from './categories.js'
import { CURRENCY_CODES } from './currencies.js'
import { normalizeServiceUrl, parseAmount } from './input.js'
import { formatDateOnly, parseLocalDate } from './dates.js'

const VALID_CYCLES = new Set(['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly'])
const VALID_CATEGORIES = new Set(CATEGORIES.map(c => c.id))
const VALID_RENEWALS = new Set(['auto', 'manual'])
const VALID_KINDS = new Set(['recurring', 'reminder'])

// Deliberately lean: fields the app can act on. Self-reported chores
// (star ratings, "mark used today", cancel-difficulty) were removed in
// 2026-08 — old backups still import fine, the dead fields just drop away.
export const SUBSCRIPTION_DEFAULTS = {
  name: '',
  amount: 0,
  // null = priced in the base display currency; an explicit code pins the
  // subscription to its own money (e.g. a GBP sub while the app shows EUR).
  currency: null,
  // 'recurring' renews on a cycle; 'reminder' is a one-time/prepaid purchase
  // that simply ends on `endDate` (annual license, domain, gift card…).
  kind: 'recurring',
  endDate: null,
  cycle: 'monthly',
  category: 'other',
  billingDate: '',
  // False marks a date or price that came from an import/audit and was never
  // confirmed. An unverified schedule stays out of forecasts, alerts and the
  // calendar; an unverified price is counted but labelled as an estimate.
  // Editing the date or the amount in the form confirms it.
  scheduleVerified: true,
  amountVerified: true,
  startDate: null,
  notes: '',
  status: 'active',
  canceledAt: null,
  paused: false,
  lastPaid: null,
  tags: [],
  payment: '',
  renewal: 'auto',
  isTrial: false,
  trialEnd: null,
  isShared: false,
  sharedN: 1,
  sharedPct: 100,
  url: '',
  paymentHistory: [],
}

export function createSubscriptionId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// ── Lifecycle state ──
// One definition of "what state is this subscription in", shared by the domain
// math and every view. Kept tolerant of legacy records that only carried a
// `status` string or only the boolean flags.

export function getSubscriptionStatus(sub) {
  if (!sub) return 'active'
  const saved = String(sub.status || '').toLowerCase()
  if (sub.canceledAt || saved === 'canceled' || saved === 'cancelled' || saved === 'archived') return 'canceled'
  if (sub.paused || saved === 'paused') return 'paused'
  if (sub.isTrial || saved === 'trial') return 'trial'
  return 'active'
}

export function isCanceled(sub) {
  return getSubscriptionStatus(sub) === 'canceled'
}

// One-time/prepaid reminder records live in the same store but are not a
// recurring commitment — they must never leak into spend or renewal math.
export function isReminder(sub) {
  return sub?.kind === 'reminder'
}

// "Active" means a live recurring commitment: not paused, not a free trial,
// not canceled, not a one-time reminder. This is the set every spend total
// is computed over.
export function isActiveSub(sub) {
  return !isReminder(sub) && getSubscriptionStatus(sub) === 'active'
}

// Everything that still has a schedule attached — active plus trials. Useful
// for calendars and billing-pressure views where a trial end is still an event.
// A date carried over from an import that nobody has confirmed yet.
export function hasUnverifiedSchedule(sub) {
  return sub?.scheduleVerified === false
}

export function isScheduled(sub) {
  if (isReminder(sub)) return false
  const status = getSubscriptionStatus(sub)
  return status === 'active' || status === 'trial'
}

function text(value) {
  return String(value ?? '').trim()
}

function finiteNumber(value, fallback = 0) {
  const number = parseFloat(value)
  return Number.isFinite(number) ? number : fallback
}

function finiteInteger(value, fallback = 0) {
  const number = parseInt(value, 10)
  return Number.isFinite(number) ? number : fallback
}

function optionalDate(value) {
  return parseLocalDate(value) ? formatDateOnly(value) : null
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== ''
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map(text).filter(Boolean))]
}

function normalizePaymentHistory(history, fallbackDate, fallbackAmount, strict, fallbackCurrency) {
  if (hasValue(history) && !Array.isArray(history)) {
    if (strict) return null
    history = null
  }

  const source = Array.isArray(history)
    ? history
    : (optionalDate(fallbackDate) ? [{ date: fallbackDate, amount: fallbackAmount }] : [])
  const normalized = []

  for (const payment of source) {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
      if (strict) return null
      continue
    }

    const paidAtInput = payment.paidAt ?? payment.date
    const paidAt = optionalDate(paidAtInput)
    const dueFor = optionalDate(payment.dueFor)
    const parsedAmount = parseAmount(payment.amount)
    const currency = text(payment.currency || fallbackCurrency).toUpperCase()
    if (strict && currency && !CURRENCY_CODES.has(currency)) return null

    if (!paidAt || (hasValue(payment.dueFor) && !dueFor)) {
      if (strict) return null
      continue
    }
    if ((!Number.isFinite(parsedAmount) || parsedAmount < 0) && strict) return null

    const amount = Number.isFinite(parsedAmount) && parsedAmount >= 0
      ? parsedAmount
      : Math.max(0, fallbackAmount)

    // `date` remains as a compatibility alias for existing UI/export code.
    normalized.push({
      date: paidAt,
      paidAt,
      ...(dueFor ? { dueFor } : {}),
      amount,
      ...(CURRENCY_CODES.has(currency) ? { currency } : {}),
    })
  }

  return normalized.sort((a, b) => {
    const paidOrder = a.paidAt.localeCompare(b.paidAt)
    return paidOrder || String(a.dueFor || '').localeCompare(String(b.dueFor || ''))
  })
}

export function normalizeSubscription(input, options = {}) {
  const {
    genId = createSubscriptionId,
    requireName = true,
    requireAmount = false,
    mode = 'repair',
  } = options
  const strict = mode === 'strict'

  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  const name = text(input.name)
  if (requireName && !name) return null
  if (requireAmount && input.amount == null) return null

  const parsedAmount = parseAmount(input.amount)
  if ((requireAmount || strict) && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) return null
  if (strict && !optionalDate(input.billingDate)) return null
  if (strict && hasValue(input.startDate) && !optionalDate(input.startDate)) return null
  if (strict && hasValue(input.lastPaid) && !optionalDate(input.lastPaid)) return null
  if (strict && hasValue(input.trialEnd) && !optionalDate(input.trialEnd)) return null
  if (strict && hasValue(input.cycle) && !VALID_CYCLES.has(input.cycle)) return null
  if (strict && hasValue(input.category) && !VALID_CATEGORIES.has(input.category)) return null
  if (strict && hasValue(input.renewal) && !VALID_RENEWALS.has(input.renewal)) return null
  if (strict && hasValue(input.tags) && !Array.isArray(input.tags)) return null
  if (strict && hasValue(input.endDate) && !optionalDate(input.endDate)) return null
  if (strict && hasValue(input.kind) && !VALID_KINDS.has(input.kind)) return null

  const currencyCode = text(input.currency).toUpperCase()
  if (strict && currencyCode && !CURRENCY_CODES.has(currencyCode)) return null
  const kind = VALID_KINDS.has(input.kind) ? input.kind : 'recurring'
  const endDate = optionalDate(input.endDate)
  if (strict && kind === 'reminder' && !endDate) return null

  const amount = Math.max(0, Number.isFinite(parsedAmount) ? parsedAmount : finiteNumber(input.amount, 0))
  // A reminder's only meaningful date is its end date — anchor the (unused)
  // billing date there so any legacy code path sees a sane value.
  const billingDate = optionalDate(input.billingDate) || (kind === 'reminder' && endDate) || formatDateOnly(new Date())
  const sharedPct = Math.min(100, Math.max(1, finiteInteger(input.sharedPct, 100)))
  const isShared = input.isShared === true
  if (strict && isShared) {
    const rawSharedPct = parseInt(input.sharedPct, 10)
    if (!Number.isFinite(rawSharedPct) || rawSharedPct < 1 || rawSharedPct > 100) return null
  }
  const effectiveAmount = amount * (isShared ? sharedPct / 100 : 1)
  const inputLastPaid = optionalDate(input.lastPaid)
  const paymentHistory = normalizePaymentHistory(input.paymentHistory, inputLastPaid, effectiveAmount, strict, currencyCode)
  if (!paymentHistory) return null
  const historyLastPaid = paymentHistory.length ? paymentHistory[paymentHistory.length - 1].paidAt : null
  const lastPaid = [inputLastPaid, historyLastPaid].filter(Boolean).sort().at(-1) || null
  const canceledAt = optionalDate(input.canceledAt)
  const requestedStatus = text(input.status).toLowerCase()
  // Reminders have no pause/trial lifecycle — they are live until their end
  // date, or archived. Collapse any stray flags so status stays coherent.
  const status = canceledAt || ['canceled', 'cancelled', 'archived'].includes(requestedStatus)
    ? 'canceled'
    : kind === 'reminder'
      ? 'active'
      : input.paused === true || requestedStatus === 'paused'
        ? 'paused'
        : input.isTrial === true || requestedStatus === 'trial'
          ? 'trial'
          : 'active'
  // Pausing a trial must not erase the fact that it is one: the flag rides
  // along while paused so that resuming returns the record to "trial"
  // instead of quietly promoting it to a paid subscription on the next load.
  const isTrial = status === 'trial' || (status === 'paused' && input.isTrial === true)

  return {
    ...SUBSCRIPTION_DEFAULTS,
    id: text(input.id) || genId(),
    name,
    amount,
    currency: CURRENCY_CODES.has(currencyCode) ? currencyCode : null,
    kind,
    endDate,
    cycle: VALID_CYCLES.has(input.cycle) ? input.cycle : 'monthly',
    category: VALID_CATEGORIES.has(input.category) ? input.category : 'other',
    billingDate,
    scheduleVerified: input.scheduleVerified !== false,
    amountVerified: input.amountVerified !== false,
    startDate: optionalDate(input.startDate),
    notes: text(input.notes),
    status,
    canceledAt: status === 'canceled' ? (canceledAt || formatDateOnly(new Date())) : null,
    paused: status === 'paused',
    lastPaid,
    tags: normalizeTags(input.tags),
    payment: text(input.payment),
    renewal: VALID_RENEWALS.has(input.renewal) ? input.renewal : 'auto',
    isTrial,
    // A trial converts on its billing date, so that is the end date when
    // none was given — a trial without one could never warn anybody.
    trialEnd: optionalDate(input.trialEnd) || (isTrial ? billingDate : null),
    isShared,
    sharedN: Math.max(1, finiteInteger(input.sharedN, 1)),
    sharedPct,
    url: normalizeServiceUrl(input.url),
    paymentHistory,
  }
}

export function normalizeSubscriptionsWithReport(items, options = {}) {
  if (!Array.isArray(items)) {
    return { items: [], accepted: 0, rejected: [{ index: -1, reason: 'Expected an array' }], sourceCount: 0 }
  }
  const seen = new Set()
  const normalized = []
  const rejected = []

  items.forEach((source, index) => {
    let item = normalizeSubscription(source, options)
    if (!item) {
      rejected.push({ index, reason: 'Invalid subscription' })
      return
    }

    if (seen.has(item.id)) {
      let id = ''
      let attempts = 0
      do {
        id = options.genId ? options.genId() : createSubscriptionId()
        attempts++
      } while (seen.has(id) && attempts < 20)
      if (!id || seen.has(id)) id = `${item.id}-${index}-${Date.now().toString(36)}`
      item = { ...item, id }
    }

    seen.add(item.id)
    normalized.push(item)
  })

  return {
    items: normalized,
    accepted: normalized.length,
    rejected,
    sourceCount: items.length,
  }
}

export function normalizeSubscriptions(items, options = {}) {
  return normalizeSubscriptionsWithReport(items, options).items
}

export function repairSubscriptions(items, options = {}) {
  return normalizeSubscriptions(items, { ...options, mode: 'repair' })
}
