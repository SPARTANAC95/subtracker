import test from 'node:test'
import assert from 'node:assert/strict'

import { daysBetween, formatDateOnly } from '../src/utils/dates.js'
import {
  getBillsInRange,
  getCategoryBreakdown,
  getDaysUntilBilling,
  getEndingReminders,
  getNextBillingDate,
  getReminderDaysLeft,
  getMissedOccurrences,
  getUpcomingCharges,
  getActualSpentInRange,
  getMonthOutlook,
  getOverdueSubs,
  getScheduledInRange,
  getYearOutlook,
  reactivateSubscription,
  recordSubscriptionPayment,
  undoSubscriptionPayment,
  rollForwardBillingDate,
} from '../src/utils/stats.js'
import {
  getSubscriptionStatus,
  isActiveSub,
  isReminder,
  isScheduled,
  normalizeSubscription,
} from '../src/utils/subscriptions.js'
import { parseBackupPayload, parseBackupText } from '../src/utils/persistence.js'
import { findPreset, getMarkColors, suggestCategory } from '../src/utils/presets.js'
import { buildCalendarIcs } from '../src/utils/calendarExport.js'
import { formatMoney, getRateToBase, makeSubConverter, pinSubscriptionCurrency, sanitizeRates } from '../src/utils/currencies.js'
import { csvCell, normalizeServiceUrl } from '../src/utils/input.js'
import { paymentLabel, relativeDay, reminderEndPhrase, reminderState } from '../src/utils/labels.js'
import { detectCurrency, normalizeSettings } from '../src/utils/settings.js'

function sub(overrides = {}) {
  return {
    id: 'test-sub',
    name: 'Test plan',
    amount: 10,
    cycle: 'monthly',
    category: 'software',
    billingDate: '2026-06-30',
    paymentHistory: [],
    paused: false,
    isTrial: false,
    ...overrides,
  }
}

test('service links permit ordinary websites and reject executable or opaque URLs', () => {
  assert.equal(normalizeServiceUrl(' netflix.com/account '), 'https://netflix.com/account')
  assert.equal(normalizeServiceUrl('https://example.com/a?x=1'), 'https://example.com/a?x=1')
  for (const value of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'https://user:pass@example.com', 'not a website']) {
    assert.equal(normalizeServiceUrl(value), '', value)
    assert.equal(normalizeSubscription(sub({ url: value })).url, '')
  }
})

test('CSV text escapes delimiters and neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"')
  for (const value of ['=1+1', '+SUM(1,2)', '@test', '-1+1', ' \t=1', '\tname']) assert.ok(csvCell(value).startsWith('"\''), value)
  assert.equal(csvCell('Normal name'), '"Normal name"')
})

test('strict imports reject partial amounts and reminders with no end date', () => {
  for (const amount of ['12garbage', '', true, [], {}, -1, 'Infinity']) assert.equal(normalizeSubscription(sub({ amount }), { mode: 'strict' }), null)
  assert.equal(normalizeSubscription(sub({ kind: 'reminder' }), { mode: 'strict' }), null)
  assert.ok(normalizeSubscription(sub({ amount: '0' }), { mode: 'strict' }))
})

test('changing subscription currency preserves the historical payment currency and totals', () => {
  const original = pinSubscriptionCurrency(sub({ paymentHistory: [{ date: '2026-06-30', amount: 10 }] }), 'USD')
  const changed = normalizeSubscription({ ...original, currency: 'EUR' })
  assert.equal(changed.paymentHistory[0].currency, 'USD')
  assert.equal(getActualSpentInRange([changed], '2026-06-01', '2026-07-31', makeSubConverter({ currency: 'USD', rates: { EUR: 2 } })), 10)
  const paid = recordSubscriptionPayment(changed, { paidAt: '2026-07-30', dueFor: '2026-07-30' })
  assert.equal(paid.paymentHistory[1].currency, 'EUR')
  assert.equal(getActualSpentInRange([paid], '2026-06-01', '2026-07-31', makeSubConverter({ currency: 'USD', rates: { EUR: 2 } })), 30)
})

test('locale detection does not read inherited object properties', () => {
  assert.equal(detectCurrency('constructor'), 'USD')
  assert.equal(detectCurrency('en-constructor'), 'USD')
})

test('undoing payments out of order never resurrects a settled due date', () => {
  const original = sub({ billingDate: '2026-06-30' })
  const first = recordSubscriptionPayment(original, { paidAt: '2026-06-29' })
  const second = recordSubscriptionPayment(first, { paidAt: '2026-06-30' })
  const undoFirst = undoSubscriptionPayment(second, '2026-06-29', '2026-06-30')
  assert.equal(undoFirst.lastPaid, '2026-06-30')
  assert.equal(formatDateOnly(getNextBillingDate(undoFirst)), '2026-06-30')
  const undoSecond = undoSubscriptionPayment(undoFirst, '2026-06-30', '2026-07-30')
  assert.equal(undoSecond.lastPaid, null)
  assert.equal(undoSecond.paymentHistory.length, 0)
  assert.equal(formatDateOnly(getNextBillingDate(undoSecond)), '2026-06-30')
})

test('IndexedDB request success is not treated as a committed write', async () => {
  const previous = globalThis.indexedDB
  globalThis.indexedDB = { open() {
    const request = {}
    queueMicrotask(() => {
      request.result = { transaction() {
        const transaction = { error: new Error('Quota failure at commit'), objectStore: () => ({ put: () => ({ result: 'saved' }) }) }
        queueMicrotask(() => transaction.onabort())
        return transaction
      } }
      request.onsuccess()
    })
    return request
  } }
  try {
    const { idbSetEntries } = await import('../src/utils/persistence.js?abort-test')
    await assert.rejects(idbSetEntries([['st-subs', []], ['st-subs:updatedAt', 1000]]), /Quota failure at commit/)
  } finally { globalThis.indexedDB = previous }
})

test('calendar-day math stays correct across Warsaw DST boundaries', () => {
  assert.equal(daysBetween('2026-10-25', '2026-10-26'), 1)
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2)
})

test('month-end billing stays clamped to the intended day', () => {
  const bills = getBillsInRange(
    sub({ billingDate: '2025-01-31' }),
    new Date(2025, 0, 1),
    new Date(2025, 2, 31),
  )
  assert.deepEqual(bills.map(formatDateOnly), ['2025-01-31', '2025-02-28', '2025-03-31'])
})

test('late payment does not shift a monthly billing anchor', () => {
  const item = sub({
    paymentHistory: [{ date: '2026-07-05', paidAt: '2026-07-05', dueFor: '2026-06-30', amount: 10 }],
    lastPaid: '2026-07-05',
  })
  assert.equal(formatDateOnly(getNextBillingDate(item)), '2026-07-30')
})

test('early or late weekly payments settle the scheduled occurrence', () => {
  const item = sub({ cycle: 'weekly', billingDate: '2026-07-03' })
  const paid = recordSubscriptionPayment(item, { paidAt: '2026-07-08' })
  assert.equal(paid.paymentHistory[0].dueFor, '2026-07-03')
  assert.equal(formatDateOnly(getNextBillingDate(paid)), '2026-07-10')

  const paidAgain = recordSubscriptionPayment(paid, { paidAt: '2026-07-10' })
  assert.equal(paidAgain.paymentHistory[1].dueFor, '2026-07-10')
  assert.equal(formatDateOnly(getNextBillingDate(paidAgain)), '2026-07-17')
})

test('an unpaid prior-month occurrence remains overdue', () => {
  const item = sub({ billingDate: '2026-06-30' })
  assert.ok(getDaysUntilBilling(item) < 0)
})

test('strict imports reject damaged records while repair mode is defensive', () => {
  assert.equal(normalizeSubscription({ name: 'Bad', amount: -2, billingDate: 'not-a-date' }, { mode: 'strict', requireAmount: true }), null)
  const repaired = normalizeSubscription({ name: 'Repair me', amount: -2, billingDate: 'not-a-date' })
  assert.equal(repaired.amount, 0)
  assert.match(repaired.billingDate, /^\d{4}-\d{2}-\d{2}$/)
})

test('preset matching does not guess from empty or one-letter names', () => {
  assert.equal(suggestCategory(''), null)
  assert.equal(suggestCategory('N'), null)
  assert.equal(suggestCategory('Notion'), 'software')
})

test('canceled records retain lifecycle metadata during normalization', () => {
  const canceled = normalizeSubscription({ ...sub(), status: 'canceled', canceledAt: '2026-07-09' })
  assert.equal(canceled.status, 'canceled')
  assert.equal(canceled.canceledAt, '2026-07-09')
  assert.equal(canceled.paused, false)
})

test('normal and legacy crash backups resolve to one restore shape', () => {
  const normal = parseBackupText(JSON.stringify({ app: 'subtracker-pro', version: 2, subs: [sub()], settings: { currency: 'PLN' }, dismissed: ['x'] }))
  assert.equal(normal.subs.length, 1)
  assert.equal(normal.settings.currency, 'PLN')

  const recovery = parseBackupPayload({
    version: 'recovery',
    data: {
      'st-subs': JSON.stringify([sub()]),
      'st-settings': JSON.stringify({ currency: 'EUR' }),
      'st-dismissed': JSON.stringify([]),
    },
  })
  assert.equal(recovery.subs[0].name, 'Test plan')
  assert.equal(recovery.settings.currency, 'EUR')
})

test('calendar export includes renewals and trial endings', () => {
  const ics = buildCalendarIcs([
    sub({ id: 'monthly', billingDate: '2026-07-15' }),
    sub({ id: 'trial', name: 'Trial plan', isTrial: true, status: 'trial', trialEnd: '2026-07-20' }),
  ], { start: '2026-07-10', end: '2026-08-31' })
  assert.match(ics, /BEGIN:VCALENDAR/)
  assert.match(ics, /Test plan renewal/)
  assert.match(ics, /Trial plan trial ends/)
})

test('every exported event carries the DTSTAMP that RFC 5545 requires', () => {
  const ics = buildCalendarIcs([sub({ billingDate: '2026-07-15' })], {
    start: '2026-07-10',
    end: '2026-07-31',
    now: new Date(Date.UTC(2026, 6, 9, 12, 30, 0)),
  })
  const events = ics.split('BEGIN:VEVENT').length - 1
  const stamps = ics.match(/DTSTAMP:\d{8}T\d{6}Z/g) || []
  assert.ok(events > 0)
  assert.equal(stamps.length, events)
  assert.equal(stamps[0], 'DTSTAMP:20260709T123000Z')
})

test('lifecycle state is one answer for flags and legacy status strings', () => {
  assert.equal(getSubscriptionStatus(sub()), 'active')
  assert.equal(getSubscriptionStatus(sub({ paused: true })), 'paused')
  assert.equal(getSubscriptionStatus(sub({ status: 'paused' })), 'paused')
  assert.equal(getSubscriptionStatus(sub({ isTrial: true })), 'trial')
  assert.equal(getSubscriptionStatus(sub({ canceledAt: '2026-01-01' })), 'canceled')
  assert.equal(getSubscriptionStatus(sub({ status: 'cancelled' })), 'canceled')

  // Resuming has to clear both encodings; clearing only the boolean used to
  // leave the record reading as paused forever.
  assert.equal(isActiveSub({ ...sub({ status: 'paused', paused: true }), paused: false }), false)
  assert.equal(isActiveSub({ ...sub({ status: 'paused', paused: true }), paused: false, status: 'active' }), true)
})

test('canceled subscriptions are excluded from spend breakdowns', () => {
  const breakdown = getCategoryBreakdown([
    sub({ id: 'live', amount: 10 }),
    sub({ id: 'archived', amount: 999, status: 'canceled', canceledAt: '2026-01-01' }),
    sub({ id: 'sleeping', amount: 500, paused: true }),
  ])
  assert.deepEqual(breakdown, [{ category: 'software', amount: 10 }])
})

test('short-cycle plans contribute every occurrence to a forward window', () => {
  const today = formatDateOnly(new Date())
  const weekly = sub({ id: 'weekly', cycle: 'weekly', amount: 10, billingDate: today })
  const monthly = sub({ id: 'monthly', cycle: 'monthly', amount: 10, billingDate: today })

  const charges = getUpcomingCharges([weekly, monthly], 31)
  const weeklyCharges = charges.filter(c => c.sub.id === 'weekly')
  const monthlyCharges = charges.filter(c => c.sub.id === 'monthly')

  // Day 0, 7, 14, 21 and 28 all fall inside a 31-day window.
  assert.equal(weeklyCharges.length, 5)
  assert.equal(monthlyCharges.length, 2)
  assert.ok(charges.every((charge, i) => i === 0 || charges[i - 1].days <= charge.days))
})

test('a cached next-billing date cannot be mutated by its callers', () => {
  const item = sub({ billingDate: '2026-06-30' })
  const first = getNextBillingDate(item)
  first.setFullYear(1999)
  assert.equal(formatDateOnly(getNextBillingDate(item)), '2026-06-30')
})

test('overdue day counts read as overdue, never as "In -5 days"', () => {
  assert.equal(relativeDay(-5), '5 days overdue')
  assert.equal(relativeDay(-1), '1 day overdue')
  assert.equal(relativeDay(0), 'Today')
  assert.equal(relativeDay(1), 'Tomorrow')
  assert.equal(relativeDay(9), 'In 9 days')
})

test('per-subscription currencies convert into the base display currency', () => {
  // A stored override is authoritative: 1 GBP = 1.17 EUR.
  const settings = { currency: 'EUR', rates: { GBP: 1.17 } }
  const toBase = makeSubConverter(settings)
  assert.equal(toBase(10, sub({ currency: 'GBP' })), 117 / 10)
  // Base-currency and legacy (null-currency) records pass through untouched.
  assert.equal(toBase(10, sub({ currency: 'EUR' })), 10)
  assert.equal(toBase(10, sub({ currency: null })), 10)
  // Without an override the built-in USD-anchored table supplies the rate.
  const noOverrides = makeSubConverter({ currency: 'USD', rates: {} })
  const gbpInUsd = noOverrides(10, sub({ currency: 'GBP' }))
  assert.ok(Math.abs(gbpInUsd - 10 / 0.79) < 1e-9)
  // A plain code also works in place of a record.
  assert.equal(makeSubConverter(settings)(10, 'GBP'), 11.7)
})

test('rate overrides are sanitized and never poison the math', () => {
  assert.deepEqual(sanitizeRates({ GBP: '1.2', BAD: 3, EUR: -4, JPY: 'x' }), { GBP: 1.2 })
  assert.deepEqual(sanitizeRates(null), {})
  assert.deepEqual(sanitizeRates([1, 2]), {})
  assert.equal(getRateToBase('GBP', 'EUR', { GBP: 0 }), getRateToBase('GBP', 'EUR', {}))
})

test('one-time reminders stay out of every recurring spend total', () => {
  const reminder = sub({ id: 'rem', kind: 'reminder', amount: 120, endDate: '2027-01-15' })
  assert.equal(isReminder(reminder), true)
  assert.equal(isActiveSub(reminder), false)
  assert.equal(isScheduled(reminder), false)
  const breakdown = getCategoryBreakdown([sub({ id: 'live', amount: 10 }), reminder])
  assert.deepEqual(breakdown, [{ category: 'software', amount: 10 }])
  const charges = getUpcomingCharges([reminder], 365)
  assert.equal(charges.length, 0)
})

test('reminder end-date math flags what is ending inside the window', () => {
  const today = formatDateOnly(new Date())
  const soon = normalizeSubscription({ name: 'License', amount: 50, kind: 'reminder', endDate: today })
  const later = normalizeSubscription({ name: 'Domain', amount: 12, kind: 'reminder', endDate: '2099-01-01' })
  assert.equal(getReminderDaysLeft(soon), 0)
  const ending = getEndingReminders([soon, later], 14)
  assert.equal(ending.length, 1)
  assert.equal(ending[0].sub.name, 'License')
})

test('normalization keeps currency, kind and end date and rejects junk codes', () => {
  const kept = normalizeSubscription({ ...sub(), currency: 'gbp', kind: 'reminder', endDate: '2027-03-01' })
  assert.equal(kept.currency, 'GBP')
  assert.equal(kept.kind, 'reminder')
  assert.equal(kept.endDate, '2027-03-01')
  // Reminders collapse stray pause/trial flags into a live record.
  const collapsed = normalizeSubscription({ ...sub(), kind: 'reminder', isTrial: true, paused: true, endDate: '2027-03-01' })
  assert.equal(getSubscriptionStatus(collapsed), 'active')
  // A reminder with no billing anchor borrows its end date.
  const anchored = normalizeSubscription({ name: 'Prepaid', amount: 5, kind: 'reminder', endDate: '2027-03-01' })
  assert.equal(anchored.billingDate, '2027-03-01')
  // Unknown currency codes are dropped in repair mode and fatal in strict mode.
  assert.equal(normalizeSubscription({ ...sub(), currency: 'ZZZ' }).currency, null)
  assert.equal(normalizeSubscription({ ...sub(), currency: 'ZZZ' }, { mode: 'strict', requireAmount: true }), null)
})

test('calendar export carries reminder end dates alongside renewals', () => {
  const ics = buildCalendarIcs([
    sub({ id: 'monthly', billingDate: '2026-07-15' }),
    sub({ id: 'rem', name: 'Yearly license', kind: 'reminder', endDate: '2026-07-22' }),
  ], { start: '2026-07-10', end: '2026-08-31' })
  assert.match(ics, /Yearly license ends/)
  assert.doesNotMatch(ics, /Yearly license renewal/)
})

test('money is grouped, sign-correct and respects zero-decimal currencies', () => {
  // Group and decimal separators follow the host locale, so match structure
  // rather than en-US punctuation.
  assert.match(formatMoney(12345.6, 'USD'), /^\$12[.,\s ]345[.,]60$/)
  assert.match(formatMoney(-42.5, 'USD'), /^-\$42[.,]50$/)
  assert.match(formatMoney(1200, 'JPY'), /^¥1[.,\s ]200$/)
  assert.match(formatMoney('not a number', 'USD'), /^\$0[.,]00$/)
  assert.match(formatMoney(undefined, 'USD'), /^\$0[.,]00$/)
})

test('a trial without an explicit end date converts on its billing date', () => {
  const trial = normalizeSubscription({ name: 'Trial', amount: 9, billingDate: '2026-10-01', isTrial: true })
  assert.equal(getSubscriptionStatus(trial), 'trial')
  assert.equal(trial.trialEnd, '2026-10-01')
  const explicit = normalizeSubscription({ name: 'Trial', amount: 9, billingDate: '2026-10-01', isTrial: true, trialEnd: '2026-09-20' })
  assert.equal(explicit.trialEnd, '2026-09-20')
  const plain = normalizeSubscription({ name: 'Plain', amount: 9, billingDate: '2026-10-01' })
  assert.equal(plain.trialEnd, null)
})

test('reactivating a canceled record resumes the schedule from today, history intact', () => {
  const canceled = sub({
    billingDate: '2026-01-15',
    status: 'canceled',
    canceledAt: '2026-03-01',
    paymentHistory: [{ date: '2026-01-15', paidAt: '2026-01-15', dueFor: '2026-01-15', amount: 10 }],
  })
  const revived = reactivateSubscription(canceled, '2026-09-03')
  assert.equal(getSubscriptionStatus(revived), 'active')
  assert.equal(revived.canceledAt, null)
  assert.equal(revived.paused, false)
  // Same day-of-month cadence, first occurrence on/after the reactivation day.
  assert.equal(revived.billingDate, '2026-09-15')
  assert.equal(revived.paymentHistory.length, 1)
  assert.equal(rollForwardBillingDate(revived, '2026-09-03'), '2026-09-15')

  // An anchor still in the future is left alone.
  assert.equal(rollForwardBillingDate(sub({ billingDate: '2027-01-01' }), '2026-09-03'), '2027-01-01')
  // Reactivating on the anchor day keeps that day.
  assert.equal(rollForwardBillingDate(sub({ billingDate: '2026-08-03' }), '2026-09-03'), '2026-09-03')
  // Month-end anchors stay clamped when rolling through short months.
  assert.equal(rollForwardBillingDate(sub({ billingDate: '2026-01-31' }), '2026-02-10'), '2026-02-28')
})

test('missed occurrences list every unsettled past due date', () => {
  const item = sub({ billingDate: '2026-06-20', paymentHistory: [] })
  const missed = getMissedOccurrences(item, '2026-09-03').map(formatDateOnly)
  assert.deepEqual(missed, ['2026-06-20', '2026-07-20', '2026-08-20'])
  // Settling the oldest leaves the later ones outstanding — what the
  // "keep original schedule" toast reports.
  const paid = recordSubscriptionPayment(item, { paidAt: '2026-09-03', dueFor: '2026-06-20' })
  assert.deepEqual(getMissedOccurrences(paid, '2026-09-03').map(formatDateOnly), ['2026-07-20', '2026-08-20'])
  // Nothing missed when the anchor is today or later.
  assert.deepEqual(getMissedOccurrences(sub({ billingDate: '2026-09-03' }), '2026-09-03'), [])
})

test('settings are clamped and keep their exchange rates through the normalizer', () => {
  const clean = normalizeSettings({ currency: 'eur', budget: '250.5', reminderDays: 99, notifications: 'yes', rates: { GBP: '1.17', BAD: 2 }, setupDate: 'x' })
  assert.equal(clean.currency, 'EUR')
  assert.equal(clean.budget, 250.5)
  assert.equal(clean.reminderDays, 30)
  assert.equal(clean.notifications, false)
  assert.deepEqual(clean.rates, { GBP: 1.17 })
  assert.equal(clean.setupDate, 'x')
  assert.equal(normalizeSettings({ currency: 'ZZZ', budget: -5, reminderDays: 0 }).currency, 'USD')
  assert.equal(normalizeSettings({ budget: -5 }).budget, 0)
  assert.equal(normalizeSettings({ reminderDays: 0 }).reminderDays, 1)
  assert.equal(normalizeSettings(null), null)
  assert.equal(normalizeSettings([1]), null)
})

test('the setup wizard guesses a supported currency from the locale', () => {
  assert.equal(detectCurrency('pl-PL'), 'PLN')
  assert.equal(detectCurrency('pl'), 'PLN')
  assert.equal(detectCurrency('en-GB'), 'GBP')
  assert.equal(detectCurrency('de-DE'), 'EUR')
  assert.equal(detectCurrency('pt-BR'), 'BRL')
  assert.equal(detectCurrency('en-US'), 'USD')
  assert.equal(detectCurrency('xx-YY'), 'USD')
  assert.equal(detectCurrency(''), 'USD')
})

test('payment methods and reminder states render the labels the form offers', () => {
  assert.equal(paymentLabel('paypal'), 'PayPal')
  assert.equal(paymentLabel('apple'), 'Apple Pay')
  assert.equal(paymentLabel(''), '')
  assert.equal(paymentLabel('custom'), 'Custom')
  assert.equal(reminderState(null).id, 'undated')
  assert.equal(reminderState(-1).id, 'expired')
  assert.equal(reminderState(30).id, 'soon')
  assert.equal(reminderState(31).id, 'ok')
  assert.equal(reminderEndPhrase(-3), 'Ended 3 days ago')
  assert.equal(reminderEndPhrase(0), 'Ends today')
  assert.equal(reminderEndPhrase(5), 'Ends in 5 days')
})

test('a paused trial is still a trial when it resumes', () => {
  // Pause used to strip the trial flag on the next load, so resuming the
  // record promoted it to a paid subscription nobody had agreed to yet.
  const paused = normalizeSubscription({ name: 'Trial', amount: 9, billingDate: '2026-10-01', isTrial: true, trialEnd: '2026-10-01', paused: true, status: 'paused' })
  assert.equal(paused.status, 'paused')
  assert.equal(paused.isTrial, true)
  assert.equal(paused.trialEnd, '2026-10-01')
  assert.equal(getSubscriptionStatus(paused), 'paused')
  assert.equal(isActiveSub(paused), false)
  const resumed = normalizeSubscription({ ...paused, paused: false, status: paused.isTrial ? 'trial' : 'active' })
  assert.equal(resumed.status, 'trial')
  // An ordinary paused subscription gains no trial flag.
  assert.equal(normalizeSubscription({ name: 'Plain', amount: 9, billingDate: '2026-10-01', paused: true }).isTrial, false)
})

test('preset matching does not guess from loose fragments', () => {
  // "Ne" used to resolve to Netflix and "On" to Amazon Prime, leaving a
  // half-typed "New York Times" filed under Streaming.
  assert.equal(suggestCategory('Ne'), null)
  assert.equal(suggestCategory('New York Times'), null)
  assert.equal(suggestCategory('On'), null)
  assert.equal(suggestCategory('Plus'), null)
  assert.equal(findPreset('Netflix Premium')?.name, 'Netflix')
  assert.equal(findPreset('Family Spotify plan')?.name, 'Spotify')
  assert.equal(findPreset('disney')?.name, 'Disney+')
  assert.equal(findPreset('Disney+ bundle')?.name, 'Disney+')
})

test('service marks stay readable for dark brand colors', () => {
  const fallback = getMarkColors({ name: 'Unknown service' })
  assert.equal(fallback.color, '#baa3e4')
  // PlayStation navy (#003087) is lifted well clear of the near-black surface.
  const [r, g, b] = getMarkColors({ name: 'PlayStation Plus' }).color.match(/\d+/g).map(Number)
  assert.ok(r + g + b > 380, `mark color too dark: ${r},${g},${b}`)
})

test('calendar export escapes Windows line endings in names', () => {
  const ics = buildCalendarIcs([sub({ name: 'Line\r\nBreak', billingDate: '2026-07-15' })], {
    start: '2026-07-01', end: '2026-07-31', now: new Date('2026-07-01T00:00:00Z'),
  })
  assert.ok(ics.includes('SUMMARY:Line\\nBreak renewal\r\n'), 'line break in a name was not folded into an escaped \\n')
  assert.ok(!/SUMMARY:[^\r\n]*\r(?!\n)/.test(ics), 'a bare carriage return leaked into a SUMMARY line')
})

test('an unverified schedule stays out of forecasts, alerts and the calendar', () => {
  // Records written before the flags existed are verified by default.
  assert.equal(normalizeSubscription(sub()).scheduleVerified, true)
  assert.equal(normalizeSubscription(sub()).amountVerified, true)

  const imported = normalizeSubscription(sub({ billingDate: '2026-07-15', scheduleVerified: false, amountVerified: false }))
  assert.equal(imported.scheduleVerified, false)
  assert.equal(imported.amountVerified, false)
  // Still a live commitment — only its dates are in doubt.
  assert.equal(isActiveSub(imported), true)
  assert.equal(getNextBillingDate(imported), null)
  assert.equal(getDaysUntilBilling(imported), null)
  assert.deepEqual(getBillsInRange(imported, '2026-07-01', '2026-12-31'), [])
  assert.deepEqual(getMissedOccurrences(imported, '2027-01-01'), [])
  assert.deepEqual(getOverdueSubs([imported]), [])
  assert.equal(getUpcomingCharges([imported], 365).length, 0)
  assert.equal(getScheduledInRange([imported], '2026-07-01', '2026-12-31'), 0)

  const reminder = normalizeSubscription(sub({ id: 'license', kind: 'reminder', endDate: '2026-07-20', scheduleVerified: false }))
  assert.equal(getReminderDaysLeft(reminder, '2026-07-01'), null)
  assert.deepEqual(getEndingReminders([reminder], 365), [])
  const ics = buildCalendarIcs([imported, reminder], { start: '2026-07-01', end: '2026-07-31', now: new Date('2026-07-01T00:00:00Z') })
  assert.ok(!ics.includes('BEGIN:VEVENT'), 'an unverified date reached the calendar export')
})

test('a payment on an unverified schedule is logged without a due date and can be undone', () => {
  const imported = normalizeSubscription(sub({ scheduleVerified: false }))
  const paid = recordSubscriptionPayment(imported, { paidAt: '2026-07-02' })
  assert.equal(paid.paymentHistory.length, 1)
  assert.equal('dueFor' in paid.paymentHistory[0], false)
  assert.equal(paid.lastPaid, '2026-07-02')
  // With no due date to collide on, a second payment is not a duplicate.
  assert.equal(recordSubscriptionPayment(paid, { paidAt: '2026-07-03' }).paymentHistory.length, 2)
  const undone = undoSubscriptionPayment(paid, '2026-07-02', null)
  assert.equal(undone.paymentHistory.length, 0)
  assert.equal(undone.lastPaid, null)
})

test('the spend outlook reads the past from payments and the future from the schedule', () => {
  const now = new Date(2026, 6, 15) // 15 July 2026
  // The schedule starts on its anchor (20 July). Two older payments exist,
  // but nothing was ever "scheduled" for those months.
  const plan = normalizeSubscription(sub({
    billingDate: '2026-07-20',
    paymentHistory: [{ date: '2026-04-20', amount: 9 }, { date: '2026-05-20', amount: 9 }],
  }))
  assert.deepEqual(getMonthOutlook([plan], -3, undefined, now), { paid: 9, scheduled: 0, total: 9 })
  assert.deepEqual(getMonthOutlook([plan], -2, undefined, now), { paid: 9, scheduled: 0, total: 9 })
  assert.deepEqual(getMonthOutlook([plan], -1, undefined, now), { paid: 0, scheduled: 0, total: 0 })
  assert.deepEqual(getMonthOutlook([plan], 0, undefined, now), { paid: 0, scheduled: 10, total: 10 })
  assert.deepEqual(getMonthOutlook([plan], 1, undefined, now), { paid: 0, scheduled: 10, total: 10 })
  // Paid so far (18) plus July through December still to come (6 × 10).
  assert.deepEqual(getYearOutlook([plan], undefined, now), { paid: 18, scheduled: 60, total: 78 })

  // Paying July's charge early moves it from "scheduled" to "paid" — it is
  // never counted on both sides.
  const paidEarly = recordSubscriptionPayment(plan, { paidAt: '2026-07-14' })
  assert.deepEqual(getMonthOutlook([paidEarly], 0, undefined, now), { paid: 10, scheduled: 0, total: 10 })
  assert.deepEqual(getYearOutlook([paidEarly], undefined, now), { paid: 28, scheduled: 50, total: 78 })

  // An older payment saved without a due date settles the occurrence it was
  // made for, exactly as it does for the next-renewal date.
  const legacy = normalizeSubscription(sub({ billingDate: '2026-07-20', paymentHistory: [{ date: '2026-07-13', amount: 10 }] }))
  assert.equal(formatDateOnly(getNextBillingDate(legacy)), '2026-08-20')
  assert.equal(getScheduledInRange([legacy], '2026-07-15', '2026-07-31'), 0)

  // Paused plans keep their payment history but schedule nothing.
  const paused = normalizeSubscription({ ...plan, paused: true })
  assert.deepEqual(getMonthOutlook([paused], 1, undefined, now), { paid: 0, scheduled: 0, total: 0 })
  assert.equal(getYearOutlook([paused], undefined, now).paid, 18)
})
