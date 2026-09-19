import { CURRENCY_CODES, sanitizeRates } from './currencies.js'

// One place that decides what a valid settings record looks like. Every path
// that writes settings (hydration, setup wizard, backup restore, server
// apply) funnels through here so a hand-edited or older file can never leave
// the app with an out-of-range budget, reminder window or rate table.

export const DEFAULT_SETTINGS = Object.freeze({
  currency: 'USD',
  budget: 0,
  notifications: false,
  reminderDays: 3,
  rates: {},
})

export const MIN_REMINDER_DAYS = 1
export const MAX_REMINDER_DAYS = 30

export function clampReminderDays(value) {
  const parsed = parseInt(value, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.reminderDays
  return Math.min(MAX_REMINDER_DAYS, Math.max(MIN_REMINDER_DAYS, parsed))
}

export function normalizeSettings(value) {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const currency = typeof value.currency === 'string' && CURRENCY_CODES.has(value.currency.toUpperCase())
    ? value.currency.toUpperCase()
    : DEFAULT_SETTINGS.currency
  const budget = parseFloat(value.budget)
  return {
    ...value,
    currency,
    budget: Number.isFinite(budget) && budget > 0 ? budget : 0,
    notifications: value.notifications === true,
    reminderDays: clampReminderDays(value.reminderDays),
    rates: sanitizeRates(value.rates),
  }
}

// Region first (en-GB → GBP, pt-BR → BRL), then language alone as a weaker
// hint (pl → PLN). Only currencies the app actually supports are returned.
const REGION_CURRENCY = {
  us: 'USD', gb: 'GBP', uk: 'GBP', ca: 'CAD', au: 'AUD', in: 'INR', jp: 'JPY', ch: 'CHF',
  se: 'SEK', no: 'NOK', dk: 'DKK', pl: 'PLN', br: 'BRL', mx: 'MXN', tr: 'TRY',
  ie: 'EUR', de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', nl: 'EUR', pt: 'EUR', at: 'EUR',
  be: 'EUR', fi: 'EUR', gr: 'EUR', sk: 'EUR', si: 'EUR', lt: 'EUR', lv: 'EUR', ee: 'EUR',
  hr: 'EUR', lu: 'EUR', mt: 'EUR', cy: 'EUR',
}
const LANGUAGE_CURRENCY = {
  pl: 'PLN', de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', nl: 'EUR', fi: 'EUR', el: 'EUR',
  ja: 'JPY', hi: 'INR', tr: 'TRY', sv: 'SEK', nb: 'NOK', nn: 'NOK', no: 'NOK', da: 'DKK',
}

export function detectCurrency(locale) {
  const [language, region] = String(locale || '').toLowerCase().split(/[-_]/)
  if (region && Object.hasOwn(REGION_CURRENCY, region)) return REGION_CURRENCY[region]
  if (language && Object.hasOwn(LANGUAGE_CURRENCY, language)) return LANGUAGE_CURRENCY[language]
  return DEFAULT_SETTINGS.currency
}
