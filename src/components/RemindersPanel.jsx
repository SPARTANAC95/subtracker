import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { BellRing, CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react'
import { formatMoney } from '../utils/currencies'
import { getReminderDaysLeft } from '../utils/stats'
import { getCategoryById } from '../utils/categories'
import { formatDisplayDate } from '../utils/dates'
import { REMINDER_ENDING_SOON_DAYS as ENDING_SOON_DAYS, plural, reminderEndPhrase as endPhrase, reminderState } from '../utils/labels'
import ServiceMark from './ServiceMark'

const HAIRLINE = 'rgba(242,240,234,0.06)'

export default function RemindersPanel({ reminders, currency, toBase, onAdd, onEdit, onDelete, onViewDetail }) {
  const rows = useMemo(() => {
    const items = reminders.map(sub => ({ sub, days: getReminderDaysLeft(sub), state: null }))
    items.forEach(item => { item.state = reminderState(item.days) })
    // Soonest-ending first — expired items float to the top the same way
    // overdue renewals do, since they are the ones asking for a decision.
    return items.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity))
  }, [reminders])

  const liveValue = useMemo(() => rows
    .filter(item => item.days != null && item.days >= 0)
    .reduce((sum, item) => sum + toBase(item.sub.amount, item.sub), 0), [rows, toBase])
  const endingSoon = rows.filter(item => item.state.id === 'soon').length
  const expired = rows.filter(item => item.state.id === 'expired').length

  if (reminders.length === 0) {
    return (
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass px-6 py-16 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(225,173,102,0.32)] bg-[rgba(225,173,102,0.12)]">
          <BellRing className="h-6 w-6 text-[#e1ad66]" />
        </div>
        <h2 className="font-figure text-2xl font-medium tracking-tight text-(--app-text)">Never let a prepaid year slip by.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[rgba(242,240,234,0.45)]">
          Reminders track things you bought once — an annual license, a domain, a prepaid plan — and count down to their end date. They stay out of your monthly spend.
        </p>
        <button onClick={onAdd} className="btn btn-primary mt-6 min-h-11">
          <Plus className="h-4 w-4" /> Add your first reminder
        </button>
      </motion.section>
    )
  }

  return (
    <section aria-labelledby="reminders-heading" className="flex flex-col gap-[15px]">
      <h1 id="reminders-heading" className="sr-only">Reminders</h1>

      <div className="flex flex-wrap items-center justify-between gap-3.5">
        <p className="text-[13px] text-[rgba(242,240,234,0.48)]">
          {reminders.length} {plural(reminders.length, 'reminder')}
          <span aria-hidden="true"> · </span>{formatMoney(liveValue, currency)} still running
          {endingSoon > 0 && <><span aria-hidden="true"> · </span><span className="text-[#d9c28b]">{endingSoon} ending within {ENDING_SOON_DAYS} days</span></>}
          {expired > 0 && <><span aria-hidden="true"> · </span><span className="text-[#d99f8b]">{expired} expired</span></>}
        </p>
        <button onClick={onAdd} className="btn btn-secondary btn-sm">
          <Plus className="h-3.5 w-3.5" /> Add reminder
        </button>
      </div>

      {/* Desktop table */}
      <div className="glass hidden md:block">
        <table className="w-full border-collapse text-left text-[13px]">
          <caption className="sr-only">One-time purchases and their end dates</caption>
          <thead>
            <tr className="font-figure border-b border-[rgba(242,240,234,0.08)] text-[10.5px] font-medium uppercase tracking-[0.08em] text-[rgba(242,240,234,0.42)]">
              <th scope="col" className="py-3 pl-[18px] pr-2 font-medium">Item</th>
              <th scope="col" className="px-2 py-3 font-medium">Status</th>
              <th scope="col" className="px-2 py-3 font-medium">Ends</th>
              <th scope="col" className="hidden px-2 py-3 font-medium lg:table-cell">Purchased</th>
              <th scope="col" className="px-2 py-3 font-medium">Price paid</th>
              <th scope="col" className="w-24 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sub, days, state }) => (
              <tr key={sub.id} className="border-b border-[rgba(242,240,234,0.05)] transition-colors last:border-0 hover:bg-[rgba(242,240,234,0.028)]">
                <td className="py-3.5 pl-[18px] pr-2 align-middle">
                  <button type="button" onClick={() => onViewDetail?.(sub)} className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-offset-4">
                    <ServiceMark sub={sub} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-semibold text-(--app-text)">{sub.name}</span>
                      <span className="cat-label truncate">{getCategoryById(sub.category).label}</span>
                    </span>
                  </button>
                </td>
                <td className="px-2 py-3.5 align-middle">
                  <span className="status-pill" style={{ background: state.bg, color: state.color }}><i aria-hidden="true" />{state.label}</span>
                </td>
                <td className="px-2 py-3.5 align-middle">
                  <span className="block text-[rgba(242,240,234,0.82)]">{sub.endDate ? formatDisplayDate(sub.endDate, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
                  <span className="block text-[11px]" style={{ color: days != null && days < 0 ? '#d99f8b' : 'rgba(242,240,234,0.42)' }}>{endPhrase(days)}</span>
                </td>
                <td className="hidden px-2 py-3.5 text-[rgba(242,240,234,0.6)] lg:table-cell">
                  {sub.startDate ? formatDisplayDate(sub.startDate, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </td>
                <td className="px-2 py-3.5 align-middle">
                  <span className="font-figure font-semibold text-(--app-text)">{formatMoney(sub.amount, sub.currency || currency)}</span>
                </td>
                <td className="px-3 py-3.5 text-right align-middle">
                  <div className="inline-flex gap-1.5">
                    <button type="button" onClick={() => onEdit?.(sub)} className="btn btn-secondary btn-icon" aria-label={`Edit ${sub.name}`}><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => onDelete?.(sub.id)} className="btn btn-secondary btn-icon" aria-label={`Delete ${sub.name}`}><Trash2 className="h-4 w-4 text-[#d99f8b]" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="glass md:hidden">
        {rows.map(({ sub, days, state }, index) => (
          <article key={sub.id} className="p-3.5" style={index ? { borderTop: `1px solid ${HAIRLINE}` } : undefined}>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => onViewDetail?.(sub)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <ServiceMark sub={sub} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-(--app-text)">{sub.name}</span>
                  <span className="cat-label truncate">{getCategoryById(sub.category).label}</span>
                </span>
              </button>
              <span className="font-figure text-sm font-semibold text-(--app-text)">{formatMoney(sub.amount, sub.currency || currency)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 pl-1">
              <span className="status-pill" style={{ background: state.bg, color: state.color }}><i aria-hidden="true" />{state.label}</span>
              <span className="flex items-center gap-1.5 text-[11.5px]" style={{ color: days != null && days < 0 ? '#d99f8b' : 'rgba(242,240,234,0.55)' }}>
                <CalendarClock className="h-3.5 w-3.5" />
                {sub.endDate ? `${formatDisplayDate(sub.endDate, { month: 'short', day: 'numeric' })} · ${endPhrase(days)}` : 'No end date'}
              </span>
              <div className="inline-flex gap-1.5">
                <button type="button" onClick={() => onEdit?.(sub)} className="btn btn-secondary btn-icon" aria-label={`Edit ${sub.name}`}><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => onDelete?.(sub.id)} className="btn btn-secondary btn-icon" aria-label={`Delete ${sub.name}`}><Trash2 className="h-4 w-4 text-[#d99f8b]" /></button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <p className="px-1 text-[11px] leading-5 text-[rgba(242,240,234,0.38)]">
        Reminders are one-time purchases — they never renew on their own and are not counted in monthly commitment. You get a notification and a calendar entry before each end date.
      </p>
    </section>
  )
}
