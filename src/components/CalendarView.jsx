import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { formatMoney } from '../utils/currencies'
import { getBillsInRange, getEffectiveAmount, getMissedOccurrences, isActiveSub } from '../utils/stats'
import { getSubscriptionStatus, isCanceled, isReminder } from '../utils/subscriptions'
import { formatDateOnly, parseLocalDate, startOfDay } from '../utils/dates'
import { plural } from '../utils/labels'
import { downloadCalendarIcs } from '../utils/calendarExport'
import useMediaQuery, { WIDE_LAYOUT } from '../hooks/useMediaQuery'
import PageHeading from './PageHeading'
import ServiceMark from './ServiceMark'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// What happened (or will happen) on a day, per subscription. Past renewals
// are either settled by a recorded payment or still overdue — showing both as
// "scheduled" hid the one thing a past date can tell you.
const EVENT_LABELS = {
  renewal: 'Scheduled renewal',
  paid: 'Paid',
  overdue: 'Overdue — not marked paid',
  trial: 'Trial ends',
  ends: 'Ends — one-time purchase',
}

// A renewal date's state: overdue if it is a missed occurrence, paid if a
// payment settled it (or it is past and not missed), otherwise still ahead.
function renewalKind(date, today, missed, settled) {
  const key = formatDateOnly(date)
  if (missed.has(key)) return 'overdue'
  if (settled.has(key) || date < today) return 'paid'
  return 'renewal'
}

function heat(intensity) {
  return `rgba(186, 163, 228, ${(0.08 + intensity * 0.3).toFixed(3)})`
}

export default function CalendarView({ subs, currency, toBase, onViewDetail }) {
  const inBase = useMemo(() => toBase || (amount => amount), [toBase])
  const [monthOffset, setMonthOffset] = useState(() => {
    try {
      const offset = Number(sessionStorage.getItem('st-calendar-offset'))
      return Number.isInteger(offset) && Math.abs(offset) <= 1200 ? offset : 0
    } catch { return 0 }
  })
  const [selectedDay, setSelectedDay] = useState(null)
  const wide = useMediaQuery(WIDE_LAYOUT)

  useEffect(() => {
    try { sessionStorage.setItem('st-calendar-offset', String(monthOffset)) } catch { /* convenience only */ }
  }, [monthOffset])

  const { days, monthLabel, monthName, maxAmount, monthTotal, eventDays } = useMemo(() => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const dim = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
    const monthEnd = new Date(target.getFullYear(), target.getMonth(), dim)
    const firstDay = target.getDay()
    const map = {}
    let monthTotal = 0
    const today = startOfDay(now)
    const slot = day => (map[day] ||= { amount: 0, events: [] })
    const add = (day, sub, kind) => { if (!slot(day).events.some(event => event.sub.id === sub.id)) map[day].events.push({ sub, kind }) }
    // Cycle-aware: only bills that actually land in this month, on their real
    // dates. Day sums and the month total are converted to the base currency.
    subs.filter(isActiveSub).forEach(s => {
      const amt = inBase(getEffectiveAmount(s), s)
      const missed = new Set(getMissedOccurrences(s, now).map(date => formatDateOnly(date)))
      const settled = new Set((s.paymentHistory || []).map(p => (p.dueFor ? formatDateOnly(p.dueFor) : null)).filter(Boolean))
      getBillsInRange(s, target, monthEnd).forEach(bill => {
        const d = bill.getDate()
        add(d, s, renewalKind(bill, today, missed, settled))
        map[d].amount += amt
        monthTotal += amt
      })
    })
    // Trial endings belong on the schedule even though they are not yet paid
    // renewals. They are often the most time-sensitive item in the app.
    subs.filter(s => getSubscriptionStatus(s) === 'trial').forEach(s => {
      const trialEnd = parseLocalDate(s.trialEnd)
      if (!trialEnd || trialEnd < target || trialEnd > monthEnd) return
      const d = trialEnd.getDate()
      const amt = inBase(getEffectiveAmount(s), s)
      add(d, s, 'trial')
      map[d].amount += amt
      monthTotal += amt
    })
    // One-time reminders: mark the day they run out. Nothing is charged that
    // day, so they never contribute to the money totals.
    subs.filter(s => isReminder(s) && !isCanceled(s) && s.scheduleVerified !== false).forEach(s => {
      const endDate = parseLocalDate(s.endDate)
      if (!endDate || endDate < target || endDate > monthEnd) return
      add(endDate.getDate(), s, 'ends')
    })
    const maxAmount = Math.max(...Object.values(map).map(d => d.amount), 1)
    const todayDate = now.getMonth() === target.getMonth() && now.getFullYear() === target.getFullYear() ? now.getDate() : -1
    const days = []
    for (let i = 0; i < firstDay; i++) days.push(null)
    for (let d = 1; d <= dim; d++) {
      const data = map[d] || null
      days.push({
        day: d,
        data,
        isToday: d === todayDate,
        overdue: Boolean(data?.events.some(event => event.kind === 'overdue')),
        settled: Boolean(data?.events.length && data.events.every(event => event.kind === 'paid')),
      })
    }
    return {
      days,
      monthLabel: target.toLocaleString('default', { month: 'long', year: 'numeric' }),
      monthName: target.toLocaleString('default', { month: 'short' }),
      maxAmount,
      monthTotal,
      eventDays: days.filter(day => day?.data),
    }
  }, [subs, monthOffset, inBase])

  const selected = selectedDay ? eventDays.find(day => day.day === selectedDay) : null
  const agendaDays = selected ? [selected] : eventDays

  function goTo(next) {
    setMonthOffset(next)
    setSelectedDay(null)
  }

  const agenda = agendaDays.length ? (
    <div className="flex flex-col gap-4">
      {agendaDays.map(day => (
        <div key={day.day}>
          <p className="mb-1 flex items-baseline justify-between gap-3 border-b border-line pb-1.5 text-[11px] text-muted">
            <span className={day.isToday ? 'text-fg' : undefined}>{monthName} {day.day}{day.isToday ? ' · today' : ''}</span>
            {day.data.amount > 0 && <span className="num">{formatMoney(day.data.amount, currency)}</span>}
          </p>
          <div className="simple-list">
            {day.data.events.map(({ sub: s, kind }) => (
              <div key={s.id} className="flex items-center gap-3 py-2">
                <button type="button" onClick={() => onViewDetail?.(s)} className="row-title flex-1">
                  <ServiceMark sub={s} size={32} />
                  <span>
                    <strong>{s.name}</strong>
                    <small className={kind === 'overdue' ? '!text-danger' : kind === 'paid' ? '!text-ok' : undefined}>{EVENT_LABELS[kind]}</small>
                  </span>
                </button>
                <span className="num flex-none text-[12px] text-soft">{isReminder(s) ? '—' : formatMoney(getEffectiveAmount(s), s.currency || currency)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="empty compact panel">
      <h3>Nothing scheduled this month</h3>
      <p>Renewals, trial endings and reminder end dates will appear here.</p>
    </div>
  )

  return (
    <>
      <PageHeading
        title="Calendar"
        actions={(
          <button type="button" onClick={() => downloadCalendarIcs(subs)} className="btn btn-sm" title="Export the next 12 months as an .ics calendar file">
            <Download aria-hidden="true" /> Export .ics
          </button>
        )}
      >
        Renewals, trial endings and reminder end dates, on the days they land.
      </PageHeading>

      <div className="two-col lead">
        <section aria-labelledby="calendar-month-heading">
          <div className="section-heading">
            <div>
              <h2 id="calendar-month-heading">{monthLabel}</h2>
              <p><span className="num">{formatMoney(monthTotal, currency)}</span> scheduled · {eventDays.length} {plural(eventDays.length, 'day')} with events</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => goTo(monthOffset - 1)} className="btn btn-icon" aria-label="Previous month"><ChevronLeft aria-hidden="true" /></button>
              <button type="button" onClick={() => goTo(0)} className="btn btn-sm" disabled={monthOffset === 0 && selectedDay == null}>Today</button>
              <button type="button" onClick={() => goTo(monthOffset + 1)} className="btn btn-icon" aria-label="Next month"><ChevronRight aria-hidden="true" /></button>
            </div>
          </div>

          {/* Phones get the month as an agenda; the grid needs more room. */}
          {!wide ? agenda : (
            <div>
              <div className="cal-weekdays" aria-hidden="true">
                {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
              </div>
              <div className="cal-grid">
                {days.map((day, i) => {
                  if (!day) return <span key={`blank-${i}`} />
                  const todayClass = day.isToday ? 'today' : ''
                  // Days without events are inert — keep them out of the tab order.
                  if (!day.data) {
                    return <div key={day.day} className={`cal-cell ${todayClass}`}><span>{day.day}</span></div>
                  }
                  const isSelected = selectedDay === day.day
                  const hasMoney = day.data.amount > 0
                  const state = day.overdue ? 'overdue' : day.settled ? 'settled' : ''
                  return (
                    <button
                      key={day.day}
                      type="button"
                      onClick={() => setSelectedDay(isSelected ? null : day.day)}
                      className={`cal-cell has-bills ${todayClass} ${state}`}
                      style={{ background: heat(Math.min(day.data.amount / maxAmount, 1)) }}
                      aria-pressed={isSelected}
                      aria-label={`${monthName} ${day.day}, ${hasMoney ? formatMoney(day.data.amount, currency) : 'a reminder ends'}${day.overdue ? ', overdue' : day.settled ? ', paid' : ''}`}
                    >
                      <span>{day.day}</span>
                      <small>{hasMoney ? formatMoney(day.data.amount, currency) : 'ends'}</small>
                    </button>
                  )
                })}
              </div>
              <p className="cal-scale" aria-hidden="true">
                <span>Less</span>
                {[0, 0.33, 0.66, 1].map(step => <i key={step} style={{ background: heat(step) }} />)}
                <span>More</span>
                <span className="cal-key paid">Paid</span>
                <span className="cal-key overdue">Overdue</span>
              </p>
            </div>
          )}
        </section>

        {wide && (
          <section aria-labelledby="calendar-agenda-heading">
            <div className="section-heading">
              <div>
                <h2 id="calendar-agenda-heading">{selected ? `${monthName} ${selected.day}` : 'This month'}</h2>
                <p>{selected ? 'Everything that lands on this day.' : 'Pick a highlighted day to focus on it.'}</p>
              </div>
              {selected && <button type="button" onClick={() => setSelectedDay(null)} className="text-link">Show all</button>}
            </div>
            {agenda}
          </section>
        )}
      </div>
    </>
  )
}
