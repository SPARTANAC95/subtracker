import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMoney } from '../utils/currencies'
import { getBillsInRange, getEffectiveAmount, isActiveSub } from '../utils/stats'
import { getSubscriptionStatus, isCanceled, isReminder } from '../utils/subscriptions'
import { parseLocalDate } from '../utils/dates'
import { downloadCalendarIcs } from '../utils/calendarExport'
import ServiceMark from './ServiceMark'

const HAIRLINE = 'rgba(242,240,234,0.06)'

function eventLabel(sub) {
  if (isReminder(sub)) return 'Ends — one-time purchase'
  return sub.isTrial ? 'Trial ends' : 'Scheduled renewal'
}

export default function CalendarView({ subs, currency, toBase }) {
  const inBase = useMemo(() => toBase || (amount => amount), [toBase])
  const [monthOffset, setMonthOffset] = useState(() => {
    try {
      const offset = Number(sessionStorage.getItem('st-calendar-offset'))
      return Number.isInteger(offset) && Math.abs(offset) <= 1200 ? offset : 0
    } catch { return 0 }
  })
  const [selectedDay, setSelectedDay] = useState(null)

  useEffect(() => {
    try { sessionStorage.setItem('st-calendar-offset', String(monthOffset)) } catch { /* convenience only */ }
  }, [monthOffset])

  const { days, monthLabel, maxAmount, monthTotal, billingCount } = useMemo(() => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const dim = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
    const monthEnd = new Date(target.getFullYear(), target.getMonth(), dim)
    const firstDay = target.getDay()
    const monthLabel = target.toLocaleString('default', { month: 'long', year: 'numeric' })
    const map = {}
    let monthTotal = 0
    // Cycle-aware: only bills that actually land in this month, on their real
    // dates. Day sums and the month total are converted to the base currency.
    subs.filter(isActiveSub).forEach(s => {
      const amt = inBase(getEffectiveAmount(s), s)
      getBillsInRange(s, target, monthEnd).forEach(bill => {
        const d = bill.getDate()
        if (!map[d]) map[d] = { amount: 0, subs: [] }
        map[d].amount += amt
        if (!map[d].subs.some(x => x.id === s.id)) map[d].subs.push(s)
        monthTotal += amt
      })
    })
    // Trial endings belong on the schedule even though they are not yet paid
    // renewals. They are often the most time-sensitive item in the app.
    subs.filter(s => getSubscriptionStatus(s) === 'trial').forEach(s => {
      const trialEnd = parseLocalDate(s.trialEnd)
      if (!trialEnd || trialEnd < target || trialEnd > monthEnd) return
      const d = trialEnd.getDate()
      if (!map[d]) map[d] = { amount: 0, subs: [] }
      map[d].amount += inBase(getEffectiveAmount(s), s)
      map[d].subs.push(s)
      monthTotal += inBase(getEffectiveAmount(s), s)
    })
    // One-time reminders: mark the day they run out. Nothing is charged that
    // day, so they never contribute to the money totals.
    subs.filter(s => isReminder(s) && !isCanceled(s)).forEach(s => {
      const endDate = parseLocalDate(s.endDate)
      if (!endDate || endDate < target || endDate > monthEnd) return
      const d = endDate.getDate()
      if (!map[d]) map[d] = { amount: 0, subs: [] }
      if (!map[d].subs.some(x => x.id === s.id)) map[d].subs.push(s)
    })
    const maxAmount = Math.max(...Object.values(map).map(d => d.amount), 1)
    const today = now.getMonth() === target.getMonth() && now.getFullYear() === target.getFullYear() ? now.getDate() : -1
    const days = []
    for (let i = 0; i < firstDay; i++) days.push(null)
    for (let d = 1; d <= dim; d++) days.push({ day: d, data: map[d] || null, isToday: d === today })
    return { days, monthLabel, maxAmount, monthTotal, billingCount: Object.keys(map).length }
  }, [subs, monthOffset, inBase])

  const sel = selectedDay ? days.find(d => d?.day === selectedDay) : null

  return (
    <div className="grid-cal">
      <section className="glass overflow-hidden">
        <div className="flex min-h-14 items-center justify-between gap-3 border-b px-5" style={{ borderColor: HAIRLINE }}>
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-semibold text-(--app-text)">{monthLabel}</h2>
            <span className="font-figure hidden text-xs text-[rgba(242,240,234,0.45)] sm:inline">{formatMoney(monthTotal, currency)} · {billingCount} billing {billingCount === 1 ? 'day' : 'days'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setMonthOffset(o => o - 1); setSelectedDay(null) }} className="btn btn-secondary btn-icon" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => { setMonthOffset(0); setSelectedDay(null) }} className="btn btn-secondary btn-sm min-h-8">Today</button>
            <button onClick={() => { setMonthOffset(o => o + 1); setSelectedDay(null) }} className="btn btn-secondary btn-icon" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Mobile agenda list */}
        <div className="p-3 md:hidden">
          <div className="space-y-2">
            {days.filter(day => day?.data).length ? days.filter(day => day?.data).map(day => (
              <div key={day.day} className="rounded-2xl border p-3" style={{ borderColor: 'rgba(242,240,234,0.07)', background: 'rgba(242,240,234,0.02)' }}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-(--app-text)">{monthLabel.split(' ')[0]} {day.day}</p>
                  <p className="font-figure text-sm text-[rgba(242,240,234,0.82)]">{formatMoney(day.data.amount, currency)}</p>
                </div>
                <div className="space-y-1.5">
                  {day.data.subs.map(s => (
                    <div key={s.id} className="flex min-h-11 items-center gap-2.5 rounded-xl bg-black/10 px-2.5">
                      <ServiceMark sub={s} size={32} radius={10} fontSize={10} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-(--app-text)">{s.name}</span><span className="block text-[10.5px] text-[rgba(242,240,234,0.42)]">{eventLabel(s)}</span></span>
                      <span className="font-figure text-sm text-[rgba(242,240,234,0.82)]">{isReminder(s) ? '—' : formatMoney(getEffectiveAmount(s), s.currency || currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )) : <div className="py-12 text-center"><p className="font-figure text-[15px] text-(--app-text)">Nothing scheduled this month</p><p className="mt-1.5 text-[11.5px] text-[rgba(242,240,234,0.4)]">Renewals, trial endings and reminder end dates will appear here.</p></div>}
          </div>
          <div className="mt-3 flex justify-center">
            <button onClick={() => downloadCalendarIcs(subs)} className="btn btn-ghost text-xs">Export .ics</button>
          </div>
        </div>

        {/* Desktop grid */}
        <div className="hidden px-[18px] pb-[18px] pt-4 md:block">
          <div className="mb-1.5 grid grid-cols-7 gap-[5px]">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="font-figure py-1 text-center text-[9.5px] tracking-[0.12em] text-[rgba(242,240,234,0.35)]">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-[5px]">
            {days.map((day, i) => {
              if (!day) return <div key={`e-${i}`} />
              const has = !!day.data
              const int = has ? Math.min(day.data.amount / maxAmount, 1) : 0
              const isSel = selectedDay === day.day
              const cellStyle = {
                background: has ? `rgba(225,173,102,${0.07 + int * 0.32})` : 'rgba(242,240,234,0.025)',
                borderColor: isSel ? '#e1ad66' : day.isToday ? 'rgba(225,173,102,0.5)' : 'transparent',
              }
              const cellClass = 'flex aspect-[1.15] flex-col items-center justify-center gap-[3px] rounded-xl border transition-colors'
              // Bill-less days are inert — keep them out of the tab order.
              if (!has) {
                return (
                  <div key={day.day} className={cellClass} style={cellStyle}>
                    <span className="font-figure text-xs" style={{ color: day.isToday ? '#f6e2c4' : 'rgba(242,240,234,0.38)' }}>{day.day}</span>
                  </div>
                )
              }
              return (
                <button
                  key={day.day}
                  onClick={() => setSelectedDay(isSel ? null : day.day)}
                  className={`${cellClass} cursor-pointer`}
                  style={cellStyle}
                  aria-pressed={isSel}
                  aria-label={`${monthLabel.split(' ')[0]} ${day.day}, ${day.data.amount > 0 ? formatMoney(day.data.amount, currency) : 'a reminder ends'}`}
                >
                  <span className="font-figure text-xs" style={{ color: day.isToday ? '#f6e2c4' : 'rgba(242,240,234,0.9)' }}>{day.day}</span>
                  <span className="font-figure text-[9.5px] text-[#facb8d]">{day.data.amount > 0 ? formatMoney(day.data.amount, currency) : 'ends'}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-3.5 flex items-center justify-center gap-[5px] border-t pt-3" style={{ borderColor: 'rgba(242,240,234,0.05)' }}>
            <span className="text-[9.5px] text-[rgba(242,240,234,0.35)]">Less</span>
            {[0.08, 0.18, 0.3, 0.44].map((op, i) => <span key={i} className="h-3 w-3 rounded" style={{ background: `rgba(225,173,102,${op})` }} />)}
            <span className="text-[9.5px] text-[rgba(242,240,234,0.35)]">More</span>
          </div>
        </div>
      </section>

      <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass hidden overflow-hidden md:block">
        <div className="flex min-h-14 items-center justify-between gap-3 border-b px-5" style={{ borderColor: HAIRLINE }}>
          <h2 className="text-base font-semibold text-(--app-text)">
            {sel?.data ? `${monthLabel.split(' ')[0]} ${selectedDay} — ${formatMoney(sel.data.amount, currency)}` : 'This month'}
          </h2>
          <button onClick={() => downloadCalendarIcs(subs)} className="btn btn-ghost text-xs" title="Export 12 months as an .ics calendar">Export .ics</button>
        </div>
        {sel?.data ? (
          sel.data.subs.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 px-5 py-[13px]" style={i ? { borderTop: '1px solid rgba(242,240,234,0.05)' } : undefined}>
              <ServiceMark sub={s} size={34} radius={10} fontSize={11} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-(--app-text)">{s.name}</span>
                <span className="block text-[10.5px] text-[rgba(242,240,234,0.42)]">{eventLabel(s)}</span>
              </span>
              <span className="font-figure flex-none text-[12.5px] font-semibold text-(--app-text)">{isReminder(s) ? '—' : formatMoney(getEffectiveAmount(s), s.currency || currency)}</span>
            </div>
          ))
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="font-figure text-[15px] text-(--app-text)">{billingCount ? 'Pick a highlighted day' : 'Nothing scheduled this month'}</p>
            <p className="mt-1.5 text-[11.5px] leading-6 text-[rgba(242,240,234,0.4)]">{billingCount ? 'Click a day with an amount to see which subscriptions bill on it.' : 'Renewals, trial endings and reminder end dates will appear here.'}</p>
          </div>
        )}
      </motion.section>
    </div>
  )
}
