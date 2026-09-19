import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { formatMoney, makeSubConverter } from '../utils/currencies'
import {
  getBillsInRange, getEffectiveMonthlyCost, getEffectiveAmount, getMonthSpent, getMonthRange,
  getActualSpentInRange, getYearProjectedSpent,
  getMonthlyPaidHistory, getPaymentTimeline, isActiveSub,
} from '../utils/stats'
import { daysBetween, formatDisplayDate } from '../utils/dates'

// The Insights tab, consolidated to the prototype layout: monthly spend +
// forecast, long-term projection, paid against scheduled, ledger, billing
// pressure, recent payments. All figures come from the same stats utils the
// previous three panels used.
export default function AnalyticsPanel({ subs, settings }) {
  const currency = settings.currency || 'USD'
  // All insight figures aggregate across records, so everything here is
  // converted into the base display currency.
  const toBase = useMemo(() => makeSubConverter(settings), [settings])

  // Six months of scheduled commitments plus a three-month forecast.
  const monthsData = useMemo(() => {
    const out = []
    for (let i = -5; i <= 0; i++) {
      const { start } = getMonthRange(i)
      const label = start.toLocaleString('default', { month: 'short' })
      out.push({ month: label, amount: Math.round(getMonthSpent(subs, i, toBase) * 100) / 100, forecast: false })
    }
    for (let i = 1; i <= 3; i++) {
      const { start } = getMonthRange(i)
      const label = start.toLocaleString('default', { month: 'short' })
      out.push({ month: label, amount: Math.round(getMonthSpent(subs, i, toBase) * 100) / 100, forecast: true })
    }
    return out
  }, [subs, toBase])

  // 6-month projected (billing-cycle math) vs actual paid (paymentHistory)
  const paidVsProjected = useMemo(() => {
    const paid = getMonthlyPaidHistory(subs, 6, toBase)
    return paid.map((p, i) => {
      const offset = -(5 - i)
      return {
        month: p.month,
        projected: Math.round(getMonthSpent(subs, offset, toBase) * 100) / 100,
        paid: p.paid,
      }
    })
  }, [subs, toBase])

  // Recent payment events (last 90 days, top 8). Payment dates are stored as
  // plain calendar days, so they must be compared as local days — `new Date()`
  // on a "YYYY-MM-DD" string parses as UTC midnight and drops a day west of
  // Greenwich.
  const recentPayments = useMemo(() => {
    const events = getPaymentTimeline(subs, 3)
    return events.filter(e => daysBetween(e.date, new Date()) <= 90).slice(0, 8)
  }, [subs])

  const totalPaidThisStretch = useMemo(
    () => paidVsProjected.reduce((a, m) => a + m.paid, 0),
    [paidVsProjected]
  )
  const totalProjectedStretch = useMemo(
    () => paidVsProjected.reduce((a, m) => a + m.projected, 0),
    [paidVsProjected]
  )

  // Billing day pressure (1-31): the charges that actually land on each day
  // of the current month. Walking the real schedule (instead of reading the
  // anchor's day-of-month) makes weekly plans show every occurrence and
  // keeps the 31st clamped the way the calendar does.
  const dayPressure = useMemo(() => {
    const map = new Array(31).fill(0)
    const { start, end } = getMonthRange(0)
    subs.filter(isActiveSub).forEach(s => {
      const amount = toBase(getEffectiveAmount(s), s)
      getBillsInRange(s, start, end).forEach(bill => { map[bill.getDate() - 1] += amount })
    })
    const peak = Math.max(...map)
    // `max` is the shading denominator and must never be 0; `peak`/`peakDay`
    // describe the real data, so an empty month reports no heaviest day
    // instead of resolving indexOf(1) to -1 and rendering "day 0".
    return { map, max: Math.max(peak, 1), peak, peakDay: peak > 0 ? map.indexOf(peak) + 1 : null }
  }, [subs, toBase])

  // Forecast totals
  const forecastTotals = useMemo(() => {
    const now = new Date()
    const ytd = getActualSpentInRange(subs, new Date(now.getFullYear(), 0, 1), now, toBase)
    const yearProj = getYearProjectedSpent(subs, now.getFullYear(), toBase)
    const monthly = subs.filter(isActiveSub).reduce((a, s) => a + toBase(getEffectiveMonthlyCost(s), s), 0)
    const fiveYearProj = monthly * 12 * 5
    const tenYearProj = monthly * 12 * 10
    return { ytd, yearProj, monthly, fiveYearProj, tenYearProj }
  }, [subs, toBase])

  // The library at a glance (previously the Stats panel).
  const ledger = useMemo(() => {
    const active = subs.filter(isActiveSub)
    const monthlyOf = s => toBase(getEffectiveMonthlyCost(s), s)
    const monthly = active.reduce((a, s) => a + monthlyOf(s), 0)
    const byCost = [...active].sort((a, b) => monthlyOf(b) - monthlyOf(a))
    const most = byCost[0]
    const cheapest = byCost[byCost.length - 1]
    return {
      rows: [
        { label: 'Active', value: String(active.length) },
        { label: 'Total records', value: String(subs.length) },
        { label: 'Monthly', value: formatMoney(monthly, currency) },
        { label: 'Yearly', value: formatMoney(monthly * 12, currency) },
        { label: 'Average', value: formatMoney(active.length ? monthly / active.length : 0, currency), sub: 'per subscription' },
        most ? { label: 'Most expensive', value: most.name, sub: `${formatMoney(monthlyOf(most), currency)}/mo` } : null,
        cheapest && cheapest !== most ? { label: 'Cheapest', value: cheapest.name, sub: `${formatMoney(monthlyOf(cheapest), currency)}/mo` } : null,
        { label: 'Auto-renew', value: String(active.filter(s => s.renewal !== 'manual').length), sub: 'of active' },
      ].filter(Boolean),
    }
  }, [subs, currency, toBase])

  const maxMonthBar = Math.max(1, ...monthsData.map(b => b.amount))
  const maxPvp = Math.max(1, ...paidVsProjected.map(m => Math.max(m.paid, m.projected)))

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid-half">
      {/* Monthly spend + forecast */}
      <section className="glass px-[21px] py-[19px] col-span-full">
        <div className="flex flex-wrap items-baseline justify-between gap-3.5">
          <div>
            <h2 className="text-base font-semibold text-(--app-text)">Monthly spend — six months &amp; forecast</h2>
            <p className="mt-1 text-[11.5px] text-[rgba(242,240,234,0.42)]">Scheduled billing per calendar month</p>
          </div>
          <p className="text-[11px] text-[rgba(242,240,234,0.45)]">
            <span className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] bg-[rgba(225,173,102,0.55)]" />scheduled
            <span className="ml-4 mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] border border-[rgba(225,173,102,0.7)]" />forecast
          </p>
        </div>
        <div className="mt-[18px] flex h-[170px] items-end gap-[clamp(8px,1.5vw,18px)]">
          {monthsData.map((b, i) => (
            <div key={`${b.month}-${i}`} className="flex h-full flex-1 flex-col items-center justify-end gap-[7px]">
              <span className="font-figure text-[10.5px] text-[rgba(242,240,234,0.5)]">{formatMoney(b.amount, currency)}</span>
              <div
                className="w-full max-w-[52px] rounded-t-lg rounded-b-[3px]"
                style={{
                  height: Math.max(4, (b.amount / maxMonthBar) * 118),
                  ...(b.forecast
                    ? { border: '1px solid rgba(225,173,102,0.55)', background: 'rgba(225,173,102,0.06)' }
                    : { background: 'linear-gradient(180deg, rgba(225,173,102,0.65), rgba(225,173,102,0.35))' }),
                }}
                title={`${b.month}: ${formatMoney(b.amount, currency)}${b.forecast ? ' (forecast)' : ''}`}
              />
              <span className="text-[10px] uppercase tracking-[0.09em]" style={{ color: b.forecast ? 'rgba(225,173,102,0.7)' : 'rgba(242,240,234,0.45)' }}>{b.month}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Long-term projection */}
      <section className="glass px-[21px] py-[19px]">
        <h2 className="text-base font-semibold text-(--app-text)">Long-term projection</h2>
        <p className="mt-1 text-[11.5px] text-[rgba(242,240,234,0.42)]">What this library costs over time</p>
        <div className="mt-5 grid grid-cols-2 gap-x-[18px] gap-y-5">
          <Projection label="Recorded YTD" value={formatMoney(forecastTotals.ytd, currency)} sub="payment history" />
          <Projection label="This year" value={formatMoney(forecastTotals.yearProj, currency)} sub="projected" />
          <Projection label="Five years" value={formatMoney(forecastTotals.fiveYearProj, currency)} sub="at current rate" />
          <Projection label="Ten years" value={formatMoney(forecastTotals.tenYearProj, currency)} sub="at current rate" />
        </div>
      </section>

      {/* Paid against scheduled */}
      <section className="glass px-[21px] py-[19px]">
        <h2 className="text-base font-semibold text-(--app-text)">Paid against scheduled</h2>
        <p className="mt-1 text-[11.5px] text-[rgba(242,240,234,0.42)]">
          {formatMoney(totalPaidThisStretch, currency)} paid · {formatMoney(totalProjectedStretch, currency)} scheduled over six months
        </p>
        {totalPaidThisStretch === 0 && totalProjectedStretch === 0 ? (
          <p className="py-8 text-center text-[11.5px] text-[rgba(242,240,234,0.42)]">No payments logged yet — use Mark paid to start tracking.</p>
        ) : (
          <>
            <div className="mt-[18px] flex h-[140px] items-end gap-3.5" role="img" aria-label={`Paid against scheduled per month: ${paidVsProjected.map(m => `${m.month} ${formatMoney(m.paid, currency)} paid of ${formatMoney(m.projected, currency)} scheduled`).join(', ')}`}>
              {paidVsProjected.map(m => (
                <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-[7px]">
                  <div className="flex w-full flex-1 items-end justify-center gap-1">
                    <div title={`Paid ${formatMoney(m.paid, currency)}`} className="w-[15px] rounded-t-[5px] rounded-b-sm bg-[rgba(225,173,102,0.6)]" style={{ height: Math.max(3, (m.paid / maxPvp) * 100) }} />
                    <div title={`Scheduled ${formatMoney(m.projected, currency)}`} className="box-border w-[15px] rounded-t-[5px] border border-b-0 border-[rgba(225,173,102,0.55)]" style={{ height: Math.max(3, (m.projected / maxPvp) * 100) }} />
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.09em] text-[rgba(242,240,234,0.45)]">{m.month}</span>
                </div>
              ))}
            </div>
            <p className="mt-[13px] text-[11px] text-[rgba(242,240,234,0.45)]">
              <span className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] bg-[rgba(225,173,102,0.6)]" />recorded paid
              <span className="ml-4 mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] border border-[rgba(225,173,102,0.55)]" />scheduled
            </p>
          </>
        )}
      </section>

      {/* Ledger */}
      <section className="glass px-[21px] py-[19px]">
        <h2 className="text-base font-semibold text-(--app-text)">Ledger</h2>
        <p className="mt-1 text-[11.5px] text-[rgba(242,240,234,0.42)]">The library at a glance</p>
        <div className="mt-3">
          {ledger.rows.map(row => (
            <div key={row.label} className="flex items-baseline justify-between gap-3.5 border-b border-dotted border-[rgba(242,240,234,0.09)] py-2 last:border-0">
              <span className="micro-label">{row.label}</span>
              <span className="text-right">
                <span className="font-figure text-[13px] font-semibold text-(--app-text)">{row.value}</span>
                {row.sub && <span className="ml-[7px] text-[10.5px] text-[rgba(242,240,234,0.4)]">{row.sub}</span>}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Billing pressure */}
      <section className="glass px-[21px] py-[19px] col-span-full">
        <h2 className="text-base font-semibold text-(--app-text)">Billing pressure by day of month</h2>
        <p className="mt-1 text-[11.5px] text-[rgba(242,240,234,0.42)]">
          {dayPressure.peakDay ? `This month's heaviest day: the ${ordinal(dayPressure.peakDay)} — ${formatMoney(dayPressure.peak, currency)} scheduled` : 'Nothing is scheduled this month.'}
        </p>
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(40px,1fr))] gap-1" role="img" aria-label={dayPressure.peakDay ? `Billing pressure by day of month; heaviest is day ${dayPressure.peakDay} at ${formatMoney(dayPressure.peak, currency)}` : 'Billing pressure by day of month; no active billing anchors'}>
          {dayPressure.map.map((amt, i) => (
            <div
              key={i}
              title={amt ? `Day ${i + 1}: ${formatMoney(amt, currency)}` : `Day ${i + 1}`}
              className="font-figure grid aspect-square place-items-center rounded-md text-[9px]"
              style={{
                background: amt > 0 ? `rgba(225,173,102,${0.08 + (amt / dayPressure.max) * 0.4})` : 'rgba(242,240,234,0.03)',
                color: amt > 0 ? '#f6e2c4' : 'rgba(242,240,234,0.3)',
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </section>

      {/* Recent payments */}
      <section className="glass px-[21px] py-[19px]">
        <h2 className="text-base font-semibold text-(--app-text)">Recent payments</h2>
        <p className="mt-1 text-[11.5px] text-[rgba(242,240,234,0.42)]">Last 90 days, most recent first</p>
        <div className="mt-2.5">
          {recentPayments.length ? recentPayments.map((p, i) => (
            <div key={`${p.subId}-${p.date}-${i}`} className="flex items-baseline justify-between gap-3.5 border-b border-dotted border-[rgba(242,240,234,0.09)] py-2 last:border-0">
              <span className="min-w-0 truncate">
                <span className="text-[13px] font-semibold text-(--app-text)">{p.subName}</span>
                <span className="ml-[9px] text-[11px] text-[rgba(242,240,234,0.4)]">{formatDisplayDate(p.date, { month: 'short', day: 'numeric' })}</span>
              </span>
              <span className="font-figure flex-none text-[13px] text-(--app-text)">{formatMoney(p.amount, p.currency || currency)}</span>
            </div>
          )) : (
            <p className="mt-3 text-xs text-[rgba(242,240,234,0.42)]">No payments recorded in the last 90 days.</p>
          )}
        </div>
      </section>
    </motion.div>
  )
}

function Projection({ label, value, sub }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.11em] text-[rgba(242,240,234,0.48)]">{label}</p>
      <p className="font-figure mt-2 text-[25px] font-medium leading-none tracking-[-0.02em] text-(--app-text)">{value}</p>
      <p className="mt-1.5 text-[10.5px] text-[rgba(242,240,234,0.4)]">{sub}</p>
    </div>
  )
}

function ordinal(n) {
  const rem10 = n % 10
  const rem100 = n % 100
  if (rem10 === 1 && rem100 !== 11) return `${n}st`
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`
  return `${n}th`
}
