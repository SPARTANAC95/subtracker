import { useMemo } from 'react'
import { BellRing, Pencil, Plus, Trash2 } from 'lucide-react'
import { formatMoney } from '../utils/currencies'
import { getReminderDaysLeft } from '../utils/stats'
import { getCategoryById } from '../utils/categories'
import { formatDisplayDate } from '../utils/dates'
import { REMINDER_ENDING_SOON_DAYS as ENDING_SOON_DAYS, plural, reminderEndPhrase as endPhrase, reminderState } from '../utils/labels'
import PageHeading from './PageHeading'
import ServiceMark from './ServiceMark'
import StatusBadge from './StatusBadge'

const LONG_DATE = { month: 'short', day: 'numeric', year: 'numeric' }
const SHORT_DATE = { month: 'short', day: 'numeric' }

export default function RemindersPanel({ reminders, currency, toBase, onAdd, onEdit, onDelete, onViewDetail }) {
  const rows = useMemo(() => {
    const items = reminders.map(sub => {
      const days = getReminderDaysLeft(sub)
      return { sub, days, state: reminderState(days) }
    })
    // Soonest-ending first — expired items float to the top the same way
    // overdue renewals do, since they are the ones asking for a decision.
    // Undated records sort last; comparing two of them must return 0, not
    // the NaN that `Infinity - Infinity` produces.
    return items.sort((a, b) => {
      if (a.days == null || b.days == null) return (a.days == null ? 1 : 0) - (b.days == null ? 1 : 0)
      return a.days - b.days
    })
  }, [reminders])

  const inBase = useMemo(() => toBase || (amount => amount), [toBase])
  const liveValue = useMemo(() => rows
    .filter(item => item.days != null && item.days >= 0)
    .reduce((sum, item) => sum + inBase(item.sub.amount, item.sub), 0), [rows, inBase])
  const endingSoon = rows.filter(item => item.state.id === 'soon').length
  const expired = rows.filter(item => item.state.id === 'expired').length

  if (reminders.length === 0) {
    return (
      <section className="empty">
        <h1 className="sr-only">Reminders</h1>
        <BellRing aria-hidden="true" />
        <h2>Never let a prepaid year slip by.</h2>
        <p>
          Reminders track things you bought once — an annual license, a domain, a prepaid plan — and count down to their end date. They stay out of your monthly spend.
        </p>
        <button type="button" onClick={onAdd} className="btn btn-primary">
          <Plus aria-hidden="true" /> Add your first reminder
        </button>
      </section>
    )
  }

  return (
    <section aria-labelledby="reminders-heading">
      <PageHeading title="Reminders" id="reminders-heading">
        {reminders.length} {plural(reminders.length, 'reminder')}
        <span aria-hidden="true"> · </span><span className="num">{formatMoney(liveValue, currency)}</span> still running
        {endingSoon > 0 && <><span aria-hidden="true"> · </span><span className="warn">{endingSoon} ending within {ENDING_SOON_DAYS} days</span></>}
        {expired > 0 && <><span aria-hidden="true"> · </span><span className="danger">{expired} expired</span></>}
      </PageHeading>

      {/* Desktop table */}
      <div className="hidden md:block">
        <table className="data-table">
          <caption className="sr-only">One-time purchases and their end dates</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Status</th>
              <th scope="col">Ends</th>
              <th scope="col" className="hidden xl:table-cell">Purchased</th>
              <th scope="col" className="text-right">Price paid</th>
              <th scope="col" className="w-20"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sub, days, state }) => (
              <tr key={sub.id}>
                <td className="max-w-0 w-[36%]">
                  <button type="button" onClick={() => onViewDetail?.(sub)} className="row-title max-w-full">
                    <ServiceMark sub={sub} />
                    <span>
                      <strong>{sub.name}</strong>
                      <small>{getCategoryById(sub.category).label}</small>
                    </span>
                  </button>
                </td>
                <td><StatusBadge tone={state.tone}>{state.label}</StatusBadge></td>
                <td>
                  <span className="num text-soft">{sub.endDate ? formatDisplayDate(sub.endDate, LONG_DATE) : '—'}</span>
                  <span className={`sub ${days != null && days < 0 ? 'danger' : ''}`}>{endPhrase(days)}</span>
                </td>
                <td className="num hidden text-muted xl:table-cell">
                  {sub.startDate ? formatDisplayDate(sub.startDate, LONG_DATE) : '—'}
                </td>
                <td className="num text-right font-[560]">{formatMoney(sub.amount, sub.currency || currency)}</td>
                <td className="text-right">
                  <RowActions sub={sub} onEdit={onEdit} onDelete={onDelete} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="simple-list md:hidden">
        {rows.map(({ sub, days, state }) => (
          <article key={sub.id} className="px-1.5 py-3">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => onViewDetail?.(sub)} className="row-title flex-1">
                <ServiceMark sub={sub} />
                <span>
                  <strong>{sub.name}</strong>
                  <small>{getCategoryById(sub.category).label}</small>
                </span>
              </button>
              <span className="num text-[12.5px] font-[560]">{formatMoney(sub.amount, sub.currency || currency)}</span>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
              <span className={`num min-w-0 flex-1 truncate text-[11px] ${days != null && days < 0 ? 'text-danger' : 'text-muted'}`}>
                {sub.endDate ? `${formatDisplayDate(sub.endDate, SHORT_DATE)} · ${endPhrase(days)}` : 'No end date'}
              </span>
              <RowActions sub={sub} onEdit={onEdit} onDelete={onDelete} />
            </div>
          </article>
        ))}
      </div>

      <p className="fine-print mt-6 max-w-[620px]">
        Reminders are one-time purchases — they never renew on their own and are not counted in monthly commitment. You get a notification and a calendar entry before each end date.
      </p>
    </section>
  )
}

function RowActions({ sub, onEdit, onDelete }) {
  return (
    <span className="inline-flex gap-1">
      <button type="button" onClick={() => onEdit?.(sub)} className="btn btn-icon" aria-label={`Edit ${sub.name}`}><Pencil aria-hidden="true" /></button>
      <button type="button" onClick={() => onDelete?.(sub.id)} className="btn btn-icon hover:!text-danger" aria-label={`Delete ${sub.name}`}><Trash2 aria-hidden="true" /></button>
    </span>
  )
}
