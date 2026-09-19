import { useMemo, useRef, useState } from 'react'
import { motion, useIsPresent } from 'framer-motion'
import {
  Archive, BellRing, Calendar, CalendarClock, Check, CheckCircle2, Clock3, CreditCard, ExternalLink,
  FileText, Link as LinkIcon, Pause, Pencil, Play, RotateCcw, Tag, Trash2,
  Users, X,
} from 'lucide-react'
import { getCategoryById } from '../utils/categories'
import { formatMoney } from '../utils/currencies'
import { getEffectiveMonthlyCost, getDaysUntilBilling, getNextBillingDate, getReminderDaysLeft, rollForwardBillingDate } from '../utils/stats'
import { getSubscriptionStatus, isReminder } from '../utils/subscriptions'
import { CYCLE_LABELS, STATUS_STYLES, cycleLabel, paymentLabel, plural, relativeDay, reminderEndPhrase, reminderState } from '../utils/labels'
import { formatDisplayDate, parseLocalDate } from '../utils/dates'
import ServiceMark from './ServiceMark'
import useModal from '../hooks/useModal'

const BOX_BORDER = 'rgba(242,240,234,0.07)'
const PAYMENTS_PREVIEW = 6

export default function SubscriptionDetail({ sub, currency, toBase, onClose, onEdit, onDelete, onTogglePause, onMarkPaid, onReactivate }) {
  const drawerRef = useRef(null)
  const closeRef = useRef(null)
  const [showAllPayments, setShowAllPayments] = useState(false)
  // Rendered inside AnimatePresence: once closing, the fading backdrop must
  // stop intercepting clicks meant for the page underneath.
  const isPresent = useIsPresent()

  // Computed before any early return — hooks must run in the same order on
  // every render, and this list used to sit below an `if (!sub) return null`.
  const payments = useMemo(() => [...(sub?.paymentHistory || [])].sort((a, b) => {
    const bDate = parseLocalDate(b.paidAt || b.date || b.dueFor)?.getTime() || 0
    const aDate = parseLocalDate(a.paidAt || a.date || a.dueFor)?.getTime() || 0
    return bDate - aDate
  }), [sub?.paymentHistory])

  useModal(drawerRef, { active: isPresent, onClose, initialFocusRef: closeRef })

  if (!sub) return null

  const category = getCategoryById(sub.category)
  const reminder = isReminder(sub)
  const status = getSubscriptionStatus(sub)
  // All figures in this drawer are about ONE record, so they stay in its own
  // currency; the ≈ line bridges to the app's display currency.
  const subCurrency = sub.currency || currency
  const isForeign = subCurrency !== currency
  const hasMeta = Boolean(sub.startDate || sub.payment || sub.url || (!reminder && (sub.lastPaid || sub.isShared)))

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-black/55"
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose?.() }}
    >
      <motion.aside
        ref={drawerRef}
        initial={{ x: '110%' }} animate={{ x: 0 }} exit={{ x: '110%' }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        role="dialog" aria-modal="true" aria-labelledby="subscription-detail-title"
        className="app-panel flex w-[calc(100%-24px)] max-w-[452px] flex-col"
      >
        <div className="flex items-start gap-[13px] border-b px-[22px] pb-4 pt-5" style={{ borderColor: BOX_BORDER }}>
          <ServiceMark sub={sub} size={46} radius={14} fontSize={15} />
          <div className="min-w-0 flex-1">
            <h2 id="subscription-detail-title" className="truncate text-lg font-semibold text-(--app-text)">{sub.name}</h2>
            <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-[rgba(242,240,234,0.42)]">{category.label}{reminder ? ' · one-time' : ''}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="btn btn-secondary btn-icon" aria-label="Close subscription details">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-[22px] pb-[22px] pt-[18px]">
          {reminder ? (
            <ReminderBody
              sub={sub}
              subCurrency={subCurrency}
              currency={currency}
              isForeign={isForeign}
              toBase={toBase}
              onEdit={onEdit}
              onDelete={onDelete}
              onClose={onClose}
            />
          ) : (
            <RecurringBody
              sub={sub}
              status={status}
              subCurrency={subCurrency}
              currency={currency}
              isForeign={isForeign}
              toBase={toBase}
              payments={payments}
              showAllPayments={showAllPayments}
              onToggleAllPayments={() => setShowAllPayments(value => !value)}
              onEdit={onEdit}
              onDelete={onDelete}
              onClose={onClose}
              onTogglePause={onTogglePause}
              onMarkPaid={onMarkPaid}
              onReactivate={onReactivate}
            />
          )}

          {sub.notes && (
            <section className="mt-4 rounded-[14px] border px-4 py-[13px]" style={{ borderColor: BOX_BORDER }} aria-labelledby="subscription-notes-heading">
              <h3 id="subscription-notes-heading" className="micro-label flex items-center gap-1.5 text-[9.5px] text-[rgba(242,240,234,0.42)]"><FileText className="h-3 w-3" /> Notes</h3>
              <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-6 text-[rgba(242,240,234,0.7)]">{sub.notes}</p>
            </section>
          )}

          <section aria-labelledby="plan-details-heading" className="mt-4 rounded-2xl border px-4 py-1" style={{ borderColor: BOX_BORDER }}>
            <h3 id="plan-details-heading" className="sr-only">Plan details</h3>
            {sub.startDate && <MetaRow icon={Calendar} label={reminder ? 'Purchased' : 'Started'} value={formatDisplayDate(sub.startDate)} />}
            {sub.payment && <MetaRow icon={CreditCard} label="Payment" value={paymentLabel(sub.payment)} />}
            {!reminder && sub.lastPaid && <MetaRow icon={Check} label="Last paid" value={formatDisplayDate(sub.lastPaid)} />}
            {!reminder && sub.isShared && <MetaRow icon={Users} label="Shared" value={`${sub.sharedN || 1} ${(sub.sharedN || 1) === 1 ? 'person' : 'people'} · ${sub.sharedPct || 100}% yours`} />}
            {sub.url && (
              <div className="flex min-h-12 items-center gap-3 border-b py-2 last:border-0" style={{ borderColor: 'rgba(242,240,234,0.05)' }}>
                <LinkIcon className="h-4 w-4 flex-shrink-0 text-[rgba(242,240,234,0.42)]" />
                <span className="w-20 flex-shrink-0 text-xs text-[rgba(242,240,234,0.42)]">Service link</span>
                <a href={sub.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center justify-end gap-1 truncate text-[13px] text-[#e1ad66] hover:text-[#facb8d] hover:underline">
                  <span className="truncate">Open website</span><ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                </a>
              </div>
            )}
            {!hasMeta && (
              <p className="py-3 text-xs text-[rgba(242,240,234,0.42)]">No extra details recorded — add a start date, payment method or link in Edit.</p>
            )}
          </section>

          {sub.tags?.length > 0 && (
            <section className="mt-4" aria-labelledby="subscription-tags-heading">
              <h3 id="subscription-tags-heading" className="micro-label flex items-center gap-1.5 text-[9.5px]"><Tag className="h-3 w-3" /> Tags</h3>
              <div className="mt-2 flex flex-wrap gap-2">{sub.tags.map(tag => <span key={tag} className="rounded-full border border-[rgba(225,173,102,0.28)] bg-[rgba(225,173,102,0.08)] px-2.5 py-1 text-xs font-medium text-[#facb8d]">{tag}</span>)}</div>
            </section>
          )}
        </div>
      </motion.aside>
    </motion.div>
  )
}

function RecurringBody({ sub, status, subCurrency, currency, isForeign, toBase, payments, showAllPayments, onToggleAllPayments, onEdit, onDelete, onClose, onTogglePause, onMarkPaid, onReactivate }) {
  const statusStyle = STATUS_STYLES[status]
  const monthly = getEffectiveMonthlyCost(sub)
  const nextDate = status === 'trial' && sub.trialEnd
    ? parseLocalDate(sub.trialEnd)
    : status === 'canceled'
      ? parseLocalDate(sub.canceledAt)
      : getNextBillingDate(sub)
  const days = status === 'active' ? getDaysUntilBilling(sub) : null
  const totalPaid = payments.reduce((sum, payment) => sum + (toBase
    ? toBase(payment.amount, payment.currency || subCurrency) / toBase(1, subCurrency)
    : parseFloat(payment.amount) || 0), 0)

  const nextTitle = status === 'canceled'
    ? '—'
    : formatDisplayDate(nextDate, { month: 'short', day: 'numeric', year: 'numeric' })
  const nextDescription = status === 'canceled'
    ? sub.canceledAt ? `Canceled ${formatDisplayDate(sub.canceledAt)}` : 'Canceled record'
    : status === 'paused'
      ? 'Schedule paused'
      : status === 'trial'
        ? 'Decide before it converts'
        : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : relativeDay(days)
  const resumeDate = status === 'canceled' ? rollForwardBillingDate(sub) : null
  const visiblePayments = showAllPayments ? payments : payments.slice(0, PAYMENTS_PREVIEW)

  return (
    <>
      <span className="status-pill px-3 py-1 text-[10.5px]" style={{ background: statusStyle.bg, color: statusStyle.color }}>
        <i aria-hidden="true" />{statusStyle.label}
      </span>

      <div className="mt-3.5 flex items-baseline gap-2">
        <span className="font-figure text-[34px] font-medium tracking-[-0.02em] text-(--app-text)">{formatMoney(sub.amount, subCurrency)}</span>
        <span className="text-[13px] text-[rgba(242,240,234,0.45)]">/ {cycleLabel(sub.cycle).toLowerCase()}</span>
      </div>
      {sub.cycle !== 'monthly' && <p className="mt-1 text-xs text-[rgba(242,240,234,0.45)]">{formatMoney(monthly, subCurrency)} monthly equivalent</p>}
      {sub.isShared && <p className="mt-1 text-xs text-[rgba(242,240,234,0.45)]">Your share: {formatMoney(monthly, subCurrency)}/mo ({sub.sharedPct || 100}%)</p>}
      {isForeign && toBase && (
        <p className="mt-1 text-xs text-[rgba(242,240,234,0.45)]">
          ≈ {formatMoney(toBase(monthly, sub), currency)}/mo in {currency} at your Settings rate
        </p>
      )}

      <div className="mt-[18px] grid grid-cols-2 rounded-2xl border" style={{ borderColor: BOX_BORDER }}>
        <DetailCell label={status === 'trial' ? 'Trial ends' : 'Next renewal'} value={nextTitle} description={nextDescription} descriptionColor={days != null && days < 0 ? '#d99f8b' : undefined} className="border-b" />
        <DetailCell label="Billing cycle" value={cycleLabel(sub.cycle)} description={sub.renewal === 'manual' ? 'Manual renewal' : 'Auto-renew'} className="border-b border-l" />
        <DetailCell label="Cost per year" value={formatMoney(monthly * 12, subCurrency)} description="at the current price" />
        <DetailCell
          label="Recorded paid"
          value={formatMoney(totalPaid, subCurrency)}
          description={payments.length ? `across ${payments.length} ${plural(payments.length, 'payment')}` : 'no payments yet'}
          className="border-l"
        />
      </div>

      <div className="mt-3.5 flex flex-wrap gap-[9px]">
        {status === 'active' && (
          <button type="button" onClick={() => onMarkPaid?.(sub.id)} className="btn btn-primary min-h-[38px] flex-1">
            <CheckCircle2 className="h-4 w-4" /> Mark paid
          </button>
        )}
        {status === 'canceled' && (
          <button type="button" onClick={() => onReactivate?.(sub.id)} className="btn btn-primary min-h-[38px] flex-1" title={resumeDate ? `Resumes the schedule on ${formatDisplayDate(resumeDate)}` : undefined}>
            <RotateCcw className="h-4 w-4" /> Reactivate
          </button>
        )}
        <button type="button" onClick={() => { onEdit?.(sub); onClose?.() }} className="btn btn-secondary min-h-[38px] flex-1">
          <Pencil className="h-4 w-4" /> Edit
        </button>
        {status !== 'canceled' && (
          <button type="button" onClick={() => onTogglePause?.(sub.id)} className="btn btn-secondary min-h-[38px] flex-1">
            {status === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {status === 'paused' ? 'Resume' : 'Pause'}
          </button>
        )}
      </div>
      {status === 'canceled' && resumeDate && (
        <p className="mt-2 text-[11px] leading-5 text-[rgba(242,240,234,0.42)]">Reactivating keeps the payment history and resumes the schedule on {formatDisplayDate(resumeDate)}.</p>
      )}
      <button
        type="button"
        onClick={() => onDelete?.(sub.id)}
        className="btn btn-danger mt-[9px] min-h-[38px] w-full"
      >
        {status === 'canceled' ? <Trash2 className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        {status === 'canceled' ? 'Delete canceled record' : 'Archive as canceled'}
      </button>

      <section aria-labelledby="payment-history-heading" className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: BOX_BORDER }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'rgba(242,240,234,0.06)' }}>
          <h3 id="payment-history-heading" className="text-[13px] font-semibold text-(--app-text)">Payment history</h3>
          <span className="font-figure text-[11px] text-[rgba(242,240,234,0.42)]">{payments.length} recorded</span>
        </div>
        {payments.length ? (
          <div>
            <div className="grid grid-cols-[1fr_1fr_0.7fr] gap-2 border-b px-4 py-2 text-[9.5px] uppercase tracking-[0.09em] text-[rgba(242,240,234,0.38)]" style={{ borderColor: 'rgba(242,240,234,0.05)' }}>
              <span>Due for</span><span>Paid on</span><span className="text-right">Amount</span>
            </div>
            {visiblePayments.map((payment, index) => (
              <PaymentRow key={`${payment.paidAt || payment.date || payment.dueFor}-${index}`} payment={payment} fallbackAmount={sub.amount} currency={subCurrency} />
            ))}
            {payments.length > PAYMENTS_PREVIEW && (
              <button type="button" onClick={onToggleAllPayments} className="w-full border-t px-4 py-2.5 text-center text-[11px] text-[#e1ad66] transition-colors hover:text-[#facb8d]" style={{ borderColor: 'rgba(242,240,234,0.05)' }}>
                {showAllPayments ? `Show the latest ${PAYMENTS_PREVIEW}` : `Show all ${payments.length} payments`}
              </button>
            )}
          </div>
        ) : (
          <p className="px-4 py-[22px] text-center text-xs text-[rgba(242,240,234,0.42)]">No payments recorded yet.</p>
        )}
        <div className="border-t bg-[rgba(242,240,234,0.02)] px-4 py-3" style={{ borderColor: 'rgba(242,240,234,0.06)' }}>
          <p className="flex items-start gap-2 text-[11px] leading-5 text-[rgba(242,240,234,0.42)]">
            <Clock3 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{scheduleAnchorText(sub)}</span>
          </p>
        </div>
      </section>
    </>
  )
}

function ReminderBody({ sub, subCurrency, currency, isForeign, toBase, onEdit, onDelete, onClose }) {
  const days = getReminderDaysLeft(sub)
  const state = reminderState(days)
  return (
    <>
      <span className="status-pill px-3 py-1 text-[10.5px]" style={{ background: state.bg, color: state.color }}>
        <i aria-hidden="true" />{state.label}
      </span>

      <div className="mt-3.5 flex items-baseline gap-2">
        <span className="font-figure text-[34px] font-medium tracking-[-0.02em] text-(--app-text)">{formatMoney(sub.amount, subCurrency)}</span>
        <span className="text-[13px] text-[rgba(242,240,234,0.45)]">/ one-time</span>
      </div>
      {isForeign && toBase && (
        <p className="mt-1 text-xs text-[rgba(242,240,234,0.45)]">≈ {formatMoney(toBase(sub.amount, sub), currency)} in {currency} at your Settings rate</p>
      )}

      <div className="mt-[18px] grid grid-cols-2 rounded-2xl border" style={{ borderColor: BOX_BORDER }}>
        <DetailCell
          label="Ends"
          value={sub.endDate ? formatDisplayDate(sub.endDate, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
          description={reminderEndPhrase(days)}
          descriptionColor={days != null && days < 0 ? '#d99f8b' : undefined}
          className="border-b"
        />
        <DetailCell
          label="Purchased"
          value={sub.startDate ? formatDisplayDate(sub.startDate, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
          description={sub.startDate ? 'purchase date' : 'not recorded'}
          className="border-b border-l"
        />
        <DetailCell label="Price paid" value={formatMoney(sub.amount, subCurrency)} description="one-time, not in monthly spend" />
        <DetailCell label="Time left" value={days == null ? '—' : days < 0 ? 'Ended' : `${days} ${plural(days, 'day')}`} description={days == null ? 'set an end date' : days < 0 ? 'rebuy or let it go' : 'until it runs out'} className="border-l" />
      </div>

      <div className="mt-3.5 flex flex-wrap gap-[9px]">
        <button type="button" onClick={() => { onEdit?.(sub); onClose?.() }} className="btn btn-primary min-h-[38px] flex-1">
          <Pencil className="h-4 w-4" /> Edit
        </button>
        <button type="button" onClick={() => onDelete?.(sub.id)} className="btn btn-danger min-h-[38px] flex-1">
          <Trash2 className="h-4 w-4" /> Delete reminder
        </button>
      </div>

      <div className="mt-4 rounded-2xl border bg-[rgba(242,240,234,0.02)] px-4 py-3" style={{ borderColor: BOX_BORDER }}>
        <p className="flex items-start gap-2 text-[11px] leading-5 text-[rgba(242,240,234,0.42)]">
          <BellRing className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>One-time purchases never renew on their own. You get a notification and a calendar entry before the end date; when it ends, rebuy it or delete the reminder.</span>
        </p>
        {sub.endDate && (
          <p className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-[rgba(242,240,234,0.42)]">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>Marked on the calendar for {formatDisplayDate(sub.endDate)}.</span>
          </p>
        )}
      </div>
    </>
  )
}

function DetailCell({ label, value, description, descriptionColor, className = '' }) {
  return (
    <div className={`px-4 py-[13px] ${className}`} style={{ borderColor: 'rgba(242,240,234,0.06)' }}>
      <p className="text-[9.5px] uppercase tracking-[0.1em] text-[rgba(242,240,234,0.42)]">{label}</p>
      <p className="font-figure mt-[5px] text-sm font-semibold text-(--app-text)">{value}</p>
      <p className="mt-0.5 text-[10.5px]" style={{ color: descriptionColor || 'rgba(242,240,234,0.42)' }}>{description}</p>
    </div>
  )
}

function PaymentRow({ payment, fallbackAmount, currency }) {
  const dueFor = payment.dueFor || payment.scheduledFor || payment.scheduledDate
  const paidAt = payment.paidAt || payment.date
  return (
    <div className="grid min-h-10 grid-cols-[1fr_1fr_0.7fr] items-center gap-2 border-b px-4 py-[9px] text-xs last:border-0" style={{ borderColor: 'rgba(242,240,234,0.04)' }}>
      <span className="font-figure text-[rgba(242,240,234,0.6)]">{dueFor ? formatDisplayDate(dueFor, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
      <span className="font-figure text-[rgba(242,240,234,0.82)]">{paidAt ? formatDisplayDate(paidAt, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Pending'}</span>
      <span className="font-figure text-right font-semibold text-(--app-text)">{formatMoney(payment.amount ?? fallbackAmount, payment.currency || currency)}</span>
    </div>
  )
}

function MetaRow({ icon: Icon, label, value }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b py-2 last:border-0" style={{ borderColor: 'rgba(242,240,234,0.05)' }}>
      <Icon className="h-4 w-4 flex-shrink-0 text-[rgba(242,240,234,0.42)]" />
      <span className="w-20 flex-shrink-0 text-xs text-[rgba(242,240,234,0.42)]">{label}</span>
      <span className="min-w-0 flex-1 text-right text-[13px] text-[rgba(242,240,234,0.75)]">{value}</span>
    </div>
  )
}

function scheduleAnchorText(sub) {
  if (!sub.billingDate) return 'No billing anchor is set. Add one in Edit to keep future renewals predictable.'
  const anchor = parseLocalDate(sub.billingDate)
  if (!anchor) return 'The billing anchor needs review. Open Edit and choose a valid renewal date.'
  if (sub.cycle === 'weekly' || sub.cycle === 'biweekly') {
    return `Schedule anchor: ${formatDisplayDate(anchor)} (${anchor.toLocaleDateString(undefined, { weekday: 'long' })}). Future renewals are calculated from this cadence.`
  }
  return `Schedule anchor: ${formatDisplayDate(anchor)}. Future ${CYCLE_LABELS[sub.cycle]?.toLowerCase() || sub.cycle} renewals are calculated from this billing anchor.`
}
