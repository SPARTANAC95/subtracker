export const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', decimals: 0 },
  { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone' },
  { code: 'DKK', symbol: 'kr', name: 'Danish Krone' },
  { code: 'PLN', symbol: 'zł', name: 'Polish Złoty' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
  // "MX$" rather than a bare "$": mixed-currency rows would otherwise show
  // pesos and dollars with the same glyph.
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso' },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira' },
]

export function getCurrency(code) {
  return CURRENCIES.find(c => c.code === code) || CURRENCIES[0]
}

export const CURRENCY_CODES = new Set(CURRENCIES.map(c => c.code))

// ── Cross-currency conversion ──
// Subscriptions can each carry their own currency; every cross-subscription
// total is shown in the base (display) currency. Rates are static offline
// approximations (units per 1 USD) — the user can override each one in
// Settings, stored in `settings.rates` as "1 <code> = <value> <base>".

export const DEFAULT_USD_RATES = {
  USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.36, AUD: 1.52, INR: 84, JPY: 150,
  CHF: 0.88, SEK: 10.5, NOK: 10.8, DKK: 6.9, PLN: 4.05, BRL: 5.4, MXN: 18.5, TRY: 38,
}

// 1 unit of `code` expressed in `base` units, from the built-in table.
export function getDefaultRate(code, base) {
  const from = DEFAULT_USD_RATES[code]
  const to = DEFAULT_USD_RATES[base]
  if (!from || !to) return 1
  return to / from
}

export function getRateToBase(code, base, rates) {
  if (!code || code === base) return 1
  const override = rates ? parseFloat(rates[code]) : NaN
  if (Number.isFinite(override) && override > 0) return override
  return getDefaultRate(code, base)
}

// Pin legacy records before a display-currency change, and retain the money
// each payment was actually recorded in when a subscription changes currency.
export function pinSubscriptionCurrency(sub, base) {
  const currency = CURRENCY_CODES.has(sub.currency) ? sub.currency : CURRENCY_CODES.has(base) ? base : 'USD'
  return { ...sub, currency, paymentHistory: (sub.paymentHistory || []).map(p => ({ ...p, currency: p.currency || currency })) }
}

// Converter over subscription records: `(amount, sub) => amount in base`.
// Payment history amounts are recorded in the subscription's currency, so a
// record-level converter is correct for both prices and payments. Also
// accepts a plain currency code in place of the record.
export function makeSubConverter(settings) {
  const base = settings?.currency || 'USD'
  const rates = settings?.rates || {}
  return (amount, sub) => {
    const n = parseFloat(amount)
    const safe = Number.isFinite(n) ? n : 0
    const code = (sub && typeof sub === 'object' ? sub.currency : sub) || base
    return safe * getRateToBase(code, base, rates)
  }
}

// Settings sanitizer: keep only known currency codes with positive finite
// rates, so a hand-edited or damaged settings file cannot poison the math.
export function sanitizeRates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const clean = {}
  for (const [code, rate] of Object.entries(value)) {
    const parsed = parseFloat(rate)
    if (CURRENCY_CODES.has(code) && Number.isFinite(parsed) && parsed > 0) clean[code] = parsed
  }
  return clean
}

// Grouped digits matter once totals reach four figures — a yearly projection
// reading "$12345.60" is genuinely hard to scan. Formatters are cached because
// constructing an Intl.NumberFormat is comparatively expensive and money is
// rendered on nearly every row.
const formatterCache = new Map()

function getFormatter(currency) {
  const decimals = currency.decimals ?? 2
  const cacheKey = `${currency.code}:${decimals}`
  if (formatterCache.has(cacheKey)) return formatterCache.get(cacheKey)

  let formatter = null
  try {
    formatter = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  } catch {
    formatter = null
  }
  formatterCache.set(cacheKey, formatter)
  return formatter
}

export function formatMoney(amount, currencyCode = 'USD') {
  const currency = getCurrency(currencyCode)
  const decimals = currency.decimals ?? 2
  const num = parseFloat(amount)
  const safe = Number.isFinite(num) ? num : 0
  const sign = safe < 0 ? '-' : ''
  const magnitude = Math.abs(safe)
  const formatter = getFormatter(currency)
  const digits = formatter ? formatter.format(magnitude) : magnitude.toFixed(decimals)
  return `${sign}${currency.symbol}${digits}`
}
