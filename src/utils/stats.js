import { addDays, addMonthsClamped, daysBetween, formatDateOnly, parseLocalDate, startOfDay } from './dates.js'
import { isActiveSub, isCanceled, isReminder } from './subscriptions.js'

export { isActiveSub, isCanceled, isReminder }

// Aggregates that sum across subscriptions accept an optional converter
// `(amount, sub) => amount` (see makeSubConverter in currencies.js) so mixed
// currencies land in one display currency. Defaults to identity — per-record
// figures stay in the record's own money.
const IDENTITY = amount => amount

export function toMonthly(amount, cycle) {
  const n = parseFloat(amount) || 0
  switch (cycle) {
    case 'weekly': return n * 52 / 12
    case 'biweekly': return n * 26 / 12
    case 'quarterly': return n / 3
    case 'semiannual': return n / 6
    case 'yearly': return n / 12
    default: return n
  }
}

export function getEffectiveMonthlyCost(sub) {
  let monthly = toMonthly(sub.amount, sub.cycle)
  if (sub.isShared && sub.sharedPct) {
    monthly *= sub.sharedPct / 100
  }
  return monthly
}

export function getEffectiveAmount(sub) {
  const n = parseFloat(sub.amount) || 0
  if (sub.isShared && sub.sharedPct) return n * (sub.sharedPct / 100)
  return n
}

export function advanceCycle(date, cycle, anchorDay) {
  const d = parseLocalDate(date)
  if (!d) return startOfDay(new Date())

  switch (cycle) {
    case 'weekly': return addDays(d, 7)
    case 'biweekly': return addDays(d, 14)
    case 'quarterly': return addMonthsClamped(d, 3, anchorDay)
    case 'semiannual': return addMonthsClamped(d, 6, anchorDay)
    case 'yearly': return addMonthsClamped(d, 12, anchorDay)
    case 'monthly':
    default: return addMonthsClamped(d, 1, anchorDay)
  }
}

// The next unsettled occurrence depends only on the record itself (anchor,
// cycle and payment history) — never on today's date — so results can be
// cached against the record. Subscriptions are replaced immutably on every
// edit, which makes a WeakMap on the object identity self-invalidating.
const nextBillingCache = new WeakMap()

export function getNextBillingDate(sub) {
  if (!sub || typeof sub !== 'object') return startOfDay(new Date())
  const cached = nextBillingCache.get(sub)
  if (cached) return new Date(cached)

  const computed = computeNextBillingDate(sub)
  nextBillingCache.set(sub, computed)
  return new Date(computed)
}

function computeNextBillingDate(sub) {
  if (!sub.billingDate) return startOfDay(new Date())
  const anchor = startOfDay(sub.billingDate)
  if (!anchor) return startOfDay(new Date())
  const anchorDay = anchor.getDate()
  const settled = getSettledDueDates(sub, anchor, anchorDay)
  let next = new Date(anchor)
  let guard = 0
  while (settled.has(formatDateOnly(next)) && guard++ < 5000) {
    next = advanceCycle(next, sub.cycle, anchorDay)
  }
  return next
}

export function getDaysUntilBilling(sub) {
  return daysBetween(new Date(), getNextBillingDate(sub))
}

function getSettledDueDates(sub, anchor, anchorDay) {
  const settled = new Set()
  const history = Array.isArray(sub.paymentHistory) ? sub.paymentHistory : []

  history.forEach(payment => {
    const explicit = parseLocalDate(payment?.dueFor)
    if (explicit) {
      settled.add(formatDateOnly(explicit))
      return
    }
    const paidAt = parseLocalDate(payment?.paidAt || payment?.date)
    const inferred = paidAt ? inferNearestScheduledDate(anchor, sub.cycle, anchorDay, paidAt) : null
    if (inferred) settled.add(formatDateOnly(inferred))
  })

  if (!history.length && sub.lastPaid) {
    const paidAt = parseLocalDate(sub.lastPaid)
    const inferred = paidAt ? inferNearestScheduledDate(anchor, sub.cycle, anchorDay, paidAt) : null
    if (inferred) settled.add(formatDateOnly(inferred))
  }
  return settled
}

function inferNearestScheduledDate(anchor, cycle, anchorDay, paidAt) {
  // A payment more than one full cycle before the anchor settled an
  // occurrence that predates the schedule — mapping it onto the anchor would
  // silently mark the first (still unpaid) occurrence as settled. Payments
  // within one cycle before the anchor are early payments for the anchor.
  if (paidAt < anchor) {
    const cycleDays = daysBetween(anchor, advanceCycle(anchor, cycle, anchorDay))
    if (daysBetween(paidAt, anchor) > cycleDays) return null
    return new Date(anchor)
  }
  let previous = new Date(anchor)
  let next = new Date(anchor)
  let guard = 0
  while (next < paidAt && guard++ < 5000) {
    previous = next
    next = advanceCycle(next, cycle, anchorDay)
  }
  if (next.getTime() === paidAt.getTime()) return next
  return Math.abs(daysBetween(paidAt, next)) < Math.abs(daysBetween(previous, paidAt)) ? next : previous
}

// First scheduled occurrence on or after `from`, keeping the anchor's
// day-of-month cadence. Used when a dormant schedule (a canceled record being
// reactivated) rejoins the calendar: its old anchor may be months back, and
// resuming there would report every skipped month as overdue.
export function rollForwardBillingDate(sub, from = new Date()) {
  const start = startOfDay(from) || startOfDay(new Date())
  const anchor = startOfDay(sub?.billingDate)
  if (!anchor) return formatDateOnly(start)
  if (anchor >= start) return formatDateOnly(anchor)
  const anchorDay = anchor.getDate()
  let next = new Date(anchor)
  let guard = 0
  while (next < start && guard++ < 5000) next = advanceCycle(next, sub.cycle, anchorDay)
  return next < start ? formatDateOnly(start) : formatDateOnly(next)
}

// Brings a canceled record back to life as a plain active subscription. The
// payment history is untouched; the schedule resumes at the next occurrence
// from today rather than wherever it stopped.
export function reactivateSubscription(sub, from = new Date()) {
  return {
    ...sub,
    status: 'active',
    canceledAt: null,
    paused: false,
    isTrial: false,
    billingDate: rollForwardBillingDate(sub, from),
  }
}

// Every scheduled occurrence that is still unsettled and already in the
// past — what "overdue" actually consists of for a record that has been
// left alone for several cycles.
export function getMissedOccurrences(sub, from = new Date()) {
  const today = startOfDay(from) || startOfDay(new Date())
  const anchor = startOfDay(sub?.billingDate)
  if (!anchor || anchor >= today) return []
  const anchorDay = anchor.getDate()
  const settled = getSettledDueDates(sub, anchor, anchorDay)
  const missed = []
  let next = new Date(anchor)
  let guard = 0
  while (next < today && guard++ < 5000) {
    if (!settled.has(formatDateOnly(next))) missed.push(new Date(next))
    next = advanceCycle(next, sub.cycle, anchorDay)
  }
  return missed
}

export function recordSubscriptionPayment(sub, options = {}) {
  const paidAt = formatDateOnly(options.paidAt || new Date())
  const dueFor = formatDateOnly(options.dueFor || getNextBillingDate(sub))
  const amount = Number.isFinite(Number(options.amount)) ? Number(options.amount) : getEffectiveAmount(sub)
  const history = Array.isArray(sub.paymentHistory) ? sub.paymentHistory : []
  if (history.some(payment => payment.dueFor && formatDateOnly(payment.dueFor) === dueFor)) return sub
  return {
    ...sub,
    lastPaid: paidAt,
    paymentHistory: [...history, { date: paidAt, paidAt, dueFor, amount, ...(sub.currency ? { currency: sub.currency } : {}) }],
  }
}

export function undoSubscriptionPayment(sub, paidAt, dueFor) {
  const paymentHistory = (sub.paymentHistory || []).filter(p => !(p.paidAt === paidAt && p.dueFor === dueFor))
  const lastPaid = paymentHistory.map(p => p.paidAt || p.date).filter(Boolean).sort().at(-1) || null
  return { ...sub, paymentHistory, lastPaid }
}

export function getCategoryBreakdown(subs, convert = IDENTITY) {
  const active = subs.filter(isActiveSub)
  const data = {}
  active.forEach(s => {
    const monthly = convert(getEffectiveMonthlyCost(s), s)
    data[s.category] = (data[s.category] || 0) + monthly
  })
  return Object.entries(data)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
}

// ── Billing-event range helpers ──

export function getBillsInRange(sub, start, end) {
  if (!sub.billingDate) return []
  const anchor = startOfDay(sub.billingDate)
  const s = startOfDay(start)
  const e = startOfDay(end)
  if (!anchor || !s || !e) return []
  const anchorDay = anchor.getDate()
  const bills = []
  let d = new Date(anchor)
  let guard = 0
  while (d < s && guard++ < 5000) d = advanceCycle(d, sub.cycle, anchorDay)
  // Guard exhausted before reaching the range (an anchor decades in the
  // past, e.g. a typo'd year): emitting from wherever the loop stopped would
  // flood the range with phantom bills.
  if (d < s) return []
  guard = 0
  while (d <= e && guard++ < 5000) {
    bills.push(new Date(d))
    d = advanceCycle(d, sub.cycle, anchorDay)
  }
  return bills
}

export function getSpentInRange(subs, start, end, { includeTrials = false, convert = IDENTITY } = {}) {
  return subs.filter(s => isActiveSub(s) || (includeTrials && !isReminder(s) && !s.paused && !isCanceled(s))).reduce((sum, s) => {
    const bills = getBillsInRange(s, start, end)
    return sum + bills.length * convert(getEffectiveAmount(s), s)
  }, 0)
}

// Every scheduled charge from today through `days` ahead, flattened into one
// event per occurrence. A weekly plan produces ~4 events in a 31-day window;
// summarising by subscription instead of by occurrence used to under-report
// short-cycle plans by 3-4x.
export function getUpcomingCharges(subs, days, convert = IDENTITY) {
  const today = startOfDay(new Date())
  const end = addDays(today, days)
  const events = []

  subs.filter(isActiveSub).forEach(sub => {
    const amount = convert(getEffectiveAmount(sub), sub)
    // Occurrences already settled by an explicit payment must not re-appear
    // as upcoming cash — right after "restart from today" the new anchor IS
    // today, but that occurrence was just paid.
    const settled = new Set(
      (sub.paymentHistory || [])
        .map(payment => (payment.dueFor ? formatDateOnly(payment.dueFor) : null))
        .filter(Boolean)
    )
    getBillsInRange(sub, today, end).forEach(date => {
      if (settled.has(formatDateOnly(date))) return
      events.push({ sub, date, days: daysBetween(today, date), amount, type: 'renewal' })
    })
  })

  return events.sort((a, b) => a.days - b.days)
}

export function getMonthRange(offsetFromNow = 0, base = new Date()) {
  const start = new Date(base.getFullYear(), base.getMonth() + offsetFromNow, 1)
  const end = new Date(base.getFullYear(), base.getMonth() + offsetFromNow + 1, 0)
  return { start: startOfDay(start), end: startOfDay(end) }
}

export function getMonthSpent(subs, offsetFromNow = 0, convert = IDENTITY) {
  const { start, end } = getMonthRange(offsetFromNow)
  return getSpentInRange(subs, start, end, { convert })
}

export function getYearProjectedSpent(subs, year = new Date().getFullYear(), convert = IDENTITY) {
  const start = new Date(year, 0, 1)
  const end = new Date(year, 11, 31)
  return getSpentInRange(subs, start, end, { convert })
}

export function getPaidThisMonth(subs, convert = IDENTITY) {
  const { start, end } = getMonthRange(0)
  return getActualSpentInRange(subs, start, end, convert)
}

export function getActualSpentInRange(subs, start, end, convert = IDENTITY) {
  const s = startOfDay(start)
  const e = startOfDay(end)
  if (!s || !e) return 0
  return subs.reduce((sum, sub) => {
    const history = sub.paymentHistory || []
    return sum + history.reduce((acc, p) => {
      const d = startOfDay(p.paidAt || p.date)
      if (d && d >= s && d <= e) return acc + convert(parseFloat(p.amount) || 0, p.currency ? { ...sub, currency: p.currency } : sub)
      return acc
    }, 0)
  }, 0)
}

export function getMonthlyPaidHistory(subs, months = 6, convert = IDENTITY) {
  const now = new Date()
  const out = []
  for (let i = months - 1; i >= 0; i--) {
    const { start, end } = getMonthRange(-i, now)
    const label = start.toLocaleString('default', { month: 'short' })
    out.push({ month: label, paid: Math.round(getActualSpentInRange(subs, start, end, convert) * 100) / 100 })
  }
  return out
}

export function getPaymentTimeline(subs, months = 6) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  const events = []
  subs.forEach(sub => {
    (sub.paymentHistory || []).forEach(p => {
      const d = startOfDay(p.paidAt || p.date)
      if (d && d >= start) events.push({ date: p.paidAt || p.date, dueFor: p.dueFor || null, amount: parseFloat(p.amount) || 0, currency: p.currency || sub.currency || null, subName: sub.name, subId: sub.id, category: sub.category })
    })
  })
  events.sort((a, b) => (parseLocalDate(b.date) || 0) - (parseLocalDate(a.date) || 0))
  return events
}

export function getOverdueSubs(subs) {
  return subs.filter(s => isActiveSub(s) && getDaysUntilBilling(s) < 0)
}

// ── Reminder (one-time / prepaid) helpers ──

// Signed days until the reminder's end date; null when no end date is set.
export function getReminderDaysLeft(sub, from = new Date()) {
  const end = parseLocalDate(sub?.endDate)
  return end ? daysBetween(from, end) : null
}

// Non-archived reminders ending inside the window, soonest first. Records
// without an end date can never "end soon" and are excluded.
export function getEndingReminders(subs, daysAhead) {
  return subs
    .filter(s => isReminder(s) && !isCanceled(s))
    .map(sub => ({ sub, days: getReminderDaysLeft(sub), date: parseLocalDate(sub.endDate) }))
    .filter(item => item.days != null && item.days >= 0 && item.days <= daysAhead)
    .sort((a, b) => a.days - b.days)
}
