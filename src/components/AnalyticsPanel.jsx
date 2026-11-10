import { useMemo } from 'react'
import { formatMoney, formatMoneyRounded, makeSubConverter } from '../utils/currencies'
import {
  getBillsInRange, getEffectiveMonthlyCost, getEffectiveAmount, getMonthOutlook, getMonthRange,
  getPaymentTimeline, getYearOutlook, isActiveSub,
} from '../utils/stats'
import { daysBetween, formatDisplayDate } from '../utils/dates'
import { rankColor } from '../utils/categories'
import { isReminder } from '../utils/subscriptions'
import { cycleLabel } from '../utils/labels'
import PageHeading from './PageHeading'
import ServiceMark from './ServiceMark'

const round2 = value => Math.round(value * 100) / 100

const TOP_COUNT = 6
const BAR_HEIGHT = 132

// The Insights tab: long-term projection, monthly spend + forecast, the
// biggest plans, ledger, billing pressure and recent payments. All figures
// come from the same stats utils the rest of the app uses.
export default function AnalyticsPanel({ subs, settings, onViewDetail }) {
  const currency = settings.currency || 'USD'
  // All insight figures aggregate across records, so everything here is
  // converted into the base display currency.
  const toBase = useMemo(() => makeSubConverter(settings), [settings])

  // Five months of recorded payments, this month (paid so far + what is
  // still scheduled) and a three-month forecast from the schedule.
  const monthsData = useMemo(() => {
    const out = []
    for (let i = -5; i <= 3; i++) {
      const { start } = getMonthRange(i)
      const outlook = getMonthOutlook(subs, i, toBase)
      out.push({
        key: `${start.getFullYear()}-${start.getMonth()}`,
        month: start.toLocaleString('default', { month: 'short' }),
        paid: round2(outlook.paid),
        scheduled: round2(outlook.scheduled),
        amount: round2(outlook.total),
        forecast: i > 0,
        current: i === 0,
      })
    }
    return out
  }, [subs, toBase])

  // The plans that make up most of the monthly figure.
  const top = useMemo(() => {
    const active = subs.filter(isActiveSub).map(sub => ({ sub, monthly: toBase(getEffectiveMonthlyCost(sub), sub) }))
    const total = active.reduce((sum, item) => sum + item.monthly, 0)
    const rows = active.sort((a, b) => b.monthly - a.monthly).slice(0, TOP_COUNT)
    const shown = rows.reduce((sum, item) => sum + item.monthly, 0)
    return { rows, total, share: total > 0 ? (shown / total) * 100 : 0, count: active.length }
  }, [subs, toBase])

  // Recent payment events (last 90 days, top 8). Payment dates are stored as
  // plain calendar days, so they must be compared as local days — `new Date()`
  // on a "YYYY-MM-DD" string parses as UTC midnight and drops a day west of
  // Greenwich.
  const recentPayments = useMemo(() => {
    const events = getPaymentTimeline(subs, 4)
    return events.filter(e => daysBetween(e.date, new Date()) <= 90).slice(0, 8)
  }, [subs])

  // Billing pressure: the charges that actually land on each day of the
  // current month. Walking the real schedule (instead of reading the anchor's
  // day-of-month) makes weekly plans show every occurrence, and sizing the
  // grid to the month keeps a 30-day month from showing a phantom 31st.
  const dayPressure = useMemo(() => {
    const { start, end } = getMonthRange(0)
    const map = new Array(end.getDate()).fill(0)
    subs.filter(isActiveSub).forEach(s => {
      const amount = toBase(getEffectiveAmount(s), s)
      getBillsInRange(s, start, end).forEach(bill => { map[bill.getDate() - 1] += amount })
    })
    const peak = Math.max(...map)
    // `max` is the shading denominator and must never be 0; `peak`/`peakDay`
    // describe the real data, so an empty month reports no heaviest day
    // instead of resolving indexOf(1) to -1 and rendering "day 0".
    return { map, max: Math.max(peak, 1), peak, peakDay: peak > 0 ? map.indexOf(peak) + 1 : null, today: new Date().getDate() }
  }, [subs, toBase])

  // Forecast totals. The year figure is what has been paid so far plus what
  // is still scheduled before the 31st of December.
  const forecastTotals = useMemo(() => {
    const year = getYearOutlook(subs, toBase)
    const monthly = subs.filter(isActiveSub).reduce((a, s) => a + toBase(getEffectiveMonthlyCost(s), s), 0)
    return { ytd: year.paid, yearLeft: year.scheduled, yearProj: year.total, fiveYearProj: monthly * 12 * 5, tenYearProj: monthly * 12 * 10 }
  }, [subs, toBase])

  // The library at a glance.
  const ledger = useMemo(() => {
    const recurring = subs.filter(s => !isReminder(s))
    const active = subs.filter(isActiveSub)
    const monthlyOf = s => toBase(getEffectiveMonthlyCost(s), s)
    const monthly = active.reduce((a, s) => a + monthlyOf(s), 0)
    const estimated = active.filter(s => s.amountVerified === false).reduce((a, s) => a + monthlyOf(s), 0)
    const byCost = [...active].sort((a, b) => monthlyOf(b) - monthlyOf(a))
    const most = byCost[0]
    const cheapest = byCost[byCost.length - 1]
    return [
      { label: 'Active', value: String(active.length), sub: `of ${recurring.length} ${recurring.length === 1 ? 'subscription' : 'subscriptions'}` },
      { label: 'Monthly', value: formatMoney(monthly, currency), sub: estimated > 0 ? `${formatMoney(estimated, currency)} from unverified prices` : undefined },
      { label: 'Yearly', value: formatMoney(monthly * 12, currency) },
      { label: 'Average', value: formatMoney(active.length ? monthly / active.length : 0, currency), sub: 'per subscription' },
      most ? { label: 'Most expensive', value: most.name, sub: `${formatMoney(monthlyOf(most), currency)}/mo` } : null,
      cheapest && cheapest !== most ? { label: 'Cheapest', value: cheapest.name, sub: `${formatMoney(monthlyOf(cheapest), currency)}/mo` } : null,
      { label: 'Auto-renew', value: String(active.filter(s => s.renewal !== 'manual').length), sub: 'of active' },
    ].filter(Boolean)
  }, [subs, currency, toBase])

  const maxMonthBar = Math.max(1, ...monthsData.map(b => b.amount))
  const barHeight = amount => Math.round((amount / maxMonthBar) * BAR_HEIGHT)
  const monthTitle = b => b.current
    ? `${b.month}: ${formatMoney(b.paid, currency)} paid, ${formatMoney(b.scheduled, currency)} still scheduled`
    : `${b.month}: ${formatMoney(b.amount, currency)} ${b.forecast ? 'scheduled' : 'paid'}`

  return (
    <>
      <PageHeading title="Insights">Scheduled billing, recorded payments, and what this library costs over time.</PageHeading>

      <section className="stat-grid section" aria-label="Long-term projection">
        <div className="stat"><strong>{formatMoney(forecastTotals.ytd, currency)}</strong><span>Recorded this year</span><small>From payment history</small></div>
        <div className="stat"><strong>{formatMoney(forecastTotals.yearProj, currency)}</strong><span>This year, projected</span><small>Paid so far + {formatMoney(forecastTotals.yearLeft, currency)} still scheduled</small></div>
        <div className="stat"><strong>{formatMoney(forecastTotals.fiveYearProj, currency)}</strong><span>Five years</span><small>At the current rate</small></div>
        <div className="stat"><strong>{formatMoney(forecastTotals.tenYearProj, currency)}</strong><span>Ten years</span><small>At the current rate</small></div>
      </section>

      {/* Monthly spend + forecast */}
      <section className="section" aria-labelledby="monthly-spend-heading">
        <div className="section-heading">
          <div>
            <h2 id="monthly-spend-heading">Monthly spend — six months &amp; forecast</h2>
            <p>Recorded payments for the months behind you, the schedule for the ones ahead.</p>
          </div>
        </div>
        <div className="month-bars" role="img" aria-label={`Spend per month: ${monthsData.map(monthTitle).join('; ')}`}>
          {monthsData.map(b => (
            <div key={b.key} title={monthTitle(b)}>
              <span className="value">{formatMoneyRounded(b.amount, currency)}</span>
              {b.current ? (
                // This month is part history, part forecast: what is already
                // paid sits under what is still to come.
                <span className="stack">
                  {b.scheduled > 0 && <span className="bar ghost" style={{ height: Math.max(4, barHeight(b.scheduled)) }} />}
                  <span className="bar peak" style={{ height: Math.max(b.scheduled > 0 ? 2 : 4, barHeight(b.paid)) }} />
                </span>
              ) : (
                <span className={`bar ${b.forecast ? 'ghost' : ''}`} style={{ height: Math.max(4, barHeight(b.amount)) }} />
              )}
              <small className={b.current ? 'current' : undefined}>{b.month}</small>
            </div>
          ))}
        </div>
        <p className="legend mt-3.5">
          <span><i aria-hidden="true" />paid</span>
          <span><i className="peak" aria-hidden="true" />paid this month</span>
          <span><i className="ghost" aria-hidden="true" />still scheduled</span>
        </p>
      </section>

      <div className="two-col section">
        {/* Biggest plans */}
        <section aria-labelledby="top-heading">
          <div className="section-heading">
            <div>
              <h2 id="top-heading">Where the money goes</h2>
              <p>
                {top.rows.length
                  ? top.count > top.rows.length
                    ? `The ${top.rows.length} largest plans are ${top.share.toFixed(0)}% of your monthly commitment.`
                    : 'Every active plan, largest first.'
                  : 'Active plans, largest first.'}
              </p>
            </div>
          </div>
          {top.rows.length ? (
            <div className="flex flex-col gap-3.5">
              {top.rows.map(({ sub, monthly }, rank) => {
                const pct = top.total > 0 ? (monthly / top.total) * 100 : 0
                return (
                  <button key={sub.id} type="button" className="top-row" onClick={() => onViewDetail?.(sub)}>
                    <ServiceMark sub={sub} size={30} />
                    <span className="rank-bar">
                      <span>
                        <span className="ellipsis">{sub.name}<small>{cycleLabel(sub.cycle).toLowerCase()}</small></span>
                        <span className="num">{formatMoney(monthly, currency)}/mo · {pct.toFixed(0)}%</span>
                      </span>
                      <span className="meter"><span style={{ width: `${pct}%`, background: rankColor(rank) }} /></span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="empty compact panel">
              <h3>No active subscriptions</h3>
              <p>Paused plans, trials and reminders are not counted here.</p>
            </div>
          )}
        </section>

        {/* Ledger */}
        <section aria-labelledby="ledger-heading">
          <div className="section-heading">
            <div>
              <h2 id="ledger-heading">Ledger</h2>
              <p>The library at a glance.</p>
            </div>
          </div>
          <div>
            {ledger.map(row => (
              <div key={row.label} className="kv-row">
                <span>{row.label}</span>
                <span className="min-w-0 truncate text-right">
                  <b className="num">{row.value}</b>
                  {row.sub && <small>{row.sub}</small>}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="two-col">
        {/* Billing pressure */}
        <section aria-labelledby="pressure-heading">
          <div className="section-heading">
            <div>
              <h2 id="pressure-heading">Billing pressure by day of month</h2>
              <p>{dayPressure.peakDay ? `This month's heaviest day: the ${ordinal(dayPressure.peakDay)} — ${formatMoney(dayPressure.peak, currency)} scheduled.` : 'Nothing is scheduled this month.'}</p>
            </div>
          </div>
          <div className="day-grid" role="img" aria-label={dayPressure.peakDay ? `Billing pressure by day of month; heaviest is day ${dayPressure.peakDay} at ${formatMoney(dayPressure.peak, currency)}` : 'Billing pressure by day of month; nothing scheduled'}>
            {dayPressure.map.map((amt, i) => (
              <span
                key={i}
                title={amt ? `Day ${i + 1}: ${formatMoney(amt, currency)}` : `Day ${i + 1}`}
                style={{
                  ...(amt > 0 ? { background: `rgba(186, 163, 228, ${(0.1 + (amt / dayPressure.max) * 0.42).toFixed(3)})`, color: '#f0eafa' } : null),
                  ...(i + 1 === dayPressure.today ? { boxShadow: 'inset 0 0 0 1px #ffffff3d' } : null),
                }}
              >
                {i + 1}
              </span>
            ))}
          </div>
        </section>

        {/* Recent payments */}
        <section aria-labelledby="recent-heading">
          <div className="section-heading">
            <div>
              <h2 id="recent-heading">Recent payments</h2>
              <p>Last 90 days, most recent first.</p>
            </div>
          </div>
          {recentPayments.length ? (
            <div>
              {recentPayments.map((p, i) => (
                <div key={`${p.subId}-${p.date}-${i}`} className="kv-row">
                  <span className="min-w-0 truncate !text-fg">
                    {p.subName}
                    <small className="num">{formatDisplayDate(p.date, { month: 'short', day: 'numeric' })}</small>
                  </span>
                  <b className="num flex-none">{formatMoney(p.amount, p.currency || currency)}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty compact panel">
              <h3>No recent payments</h3>
              <p>Nothing was recorded in the last 90 days.</p>
            </div>
          )}
        </section>
      </div>
    </>
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
