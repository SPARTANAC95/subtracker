import { useMemo, useRef, useState } from 'react'
import {
  Archive, BellRing, Calendar, CalendarClock, Check, CheckCircle2, Clock3, CreditCard, ExternalLink,
  Link as LinkIcon, Pause, Pencil, Play, RotateCcw, Trash2,
  Users, X,
} from 'lucide-react'
import { getCategoryById } from '../utils/categories'
import { formatMoney } from '../utils/currencies'
import { getEffectiveMonthlyCost, getDaysUntilBilling, getNextBillingDate, getReminderDaysLeft, rollForwardBillingDate } from '../utils/stats'
import { getSubscriptionStatus, isReminder } from '../utils/subscriptions'
import { CYCLE_LABELS, STATUS_STYLES, UNVERIFIED_REMINDER, cycleLabel, paymentLabel, plural, relativeDay, reminderEndPhrase, reminderState } from '../utils/labels'
import { daysBetween, formatDisplayDate, parseLocalDate } from '../utils/dates'
import ServiceMark from './ServiceMark'
import StatusBadge from './StatusBadge'
import { leaving, useIsPresent } from './Presence'
import useModal from '../hooks/useModal'

const PAYMENTS_PREVIEW = 6
const LONG_DATE = { month: 'short', day: 'numeric', year: 'numeric' }

export default function SubscriptionDetail({ sub, currency, toBase, onClose, onEdit, onDelete, onTogglePause, onMarkPaid, onReactivate, onVerify }) {
  const drawerRef = useRef(null)
  const closeRef = useRef(null)
  const [showAllPayments, setShowAllPayments] = useState(false)
  // Rendered inside <Presence>: once closing, the fading backdrop must stop
  // intercepting clicks meant for the page underneath.
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
    <div
      className="drawer-backdrop z-[80]"
      {...leaving(isPresent)}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose?.() }}
    >
      <aside
        ref={drawerRef}
        role="dialog" aria-modal="true" aria-labelledby="subscription-detail-title"
        className="drawer"
      >
        <div className="drawer-head">
          <ServiceMark sub={sub} size={44} fontSize={15} />
          <div className="min-w-0 flex-1">
            <h2 id="subscription-detail-title">{sub.name}</h2>
            <p>{category.label}{reminder ? ' · one-time purchase' : ''}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="btn btn-icon" aria-label="Close subscription details">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="drawer-body">
          {reminder ? (
            <ReminderBody
              sub={sub}
              subCurrency={subCurrency}
              currency={currency}
              isForeign={isForeign}
              toBase={toBase}
              onEdit={onEdit}
              onDelete={onDelete}
              onVerify={onVerify}
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
              onTogglePause={onTogglePause}
              onMarkPaid={onMarkPaid}
              onReactivate={onReactivate}
              onVerify={onVerify}
            />
          )}

          <section aria-labelledby="plan-details-heading">
            <h3 id="plan-details-heading" className="drawer-section-title">Details</h3>
            {sub.startDate && <MetaRow icon={Calendar} label={reminder ? 'Purchased' : 'Started'} value={formatDisplayDate(sub.startDate, LONG_DATE)} />}
            {sub.payment && <MetaRow icon={CreditCard} label="Payment" value={paymentLabel(sub.payment)} />}
            {!reminder && sub.lastPaid && <MetaRow icon={Check} label="Last paid" value={formatDisplayDate(sub.lastPaid, LONG_DATE)} />}
            {!reminder && sub.isShared && <MetaRow icon={Users} label="Shared" value={`${sub.sharedN || 1} ${(sub.sharedN || 1) === 1 ? 'person' : 'people'} · ${sub.sharedPct || 100}% yours`} />}
            {sub.url && (
              <div className="meta-row">
                <LinkIcon aria-hidden="true" />
                <span>Service link</span>
                <a href={sub.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-end gap-1.5 hover:underline">
                  Open website <ExternalLink aria-hidden="true" className="!text-accent" />
                </a>
              </div>
            )}
            {!hasMeta && (
              <p className="fine-print">No extra details recorded — add a start date, payment method or link in Edit.</p>
            )}
          </section>

          {sub.notes && (
            <section aria-labelledby="subscription-notes-heading">
              <h3 id="subscription-notes-heading" className="drawer-section-title">Notes</h3>
              <p className="whitespace-pre-wrap text-[12px] leading-[1.75] text-soft">{sub.notes}</p>
            </section>
          )}

          {sub.tags?.length > 0 && (
            <section aria-labelledby="subscription-tags-heading">
              <h3 id="subscription-tags-heading" className="drawer-section-title">Tags</h3>
              <div className="flex flex-wrap gap-1.5">{sub.tags.map(tag => <span key={tag} className="chip">{tag}</span>)}</div>
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}

function RecurringBody({ sub, status, subCurrency, currency, isForeign, toBase, payments, showAllPayments, onToggleAllPayments, onEdit, onDelete, onTogglePause, onMarkPaid, onReactivate, onVerify }) {
  const dateUnverified = sub.scheduleVerified === false && (status === 'active' || status === 'paused')
  const priceUnverified = sub.amountVerified === false
  const statusStyle = STATUS_STYLES[status]
  const monthly = getEffectiveMonthlyCost(sub)
  const nextDate = status === 'trial' && sub.trialEnd
    ? parseLocalDate(sub.trialEnd)
    : status === 'canceled'
      ? parseLocalDate(sub.canceledAt)
      : getNextBillingDate(sub)
  const days = status === 'active' ? getDaysUntilBilling(sub) : null
  const trialDays = status === 'trial' && nextDate ? daysBetween(new Date(), nextDate) : null
  const totalPaid = payments.reduce((sum, payment) => sum + (toBase
    ? toBase(payment.amount, payment.currency || subCurrency) / toBase(1, subCurrency)
    : parseFloat(payment.amount) || 0), 0)

  const nextTitle = status === 'canceled' ? '—' : dateUnverified ? 'Unverified' : formatDisplayDate(nextDate, LONG_DATE)
  const nextDescription = status === 'canceled'
    ? sub.canceledAt ? `Canceled ${formatDisplayDate(sub.canceledAt, LONG_DATE)}` : 'Canceled record'
    : status === 'paused'
      ? 'Schedule paused'
      : status === 'trial'
        ? (trialDays != null && trialDays < 0 ? 'Ended — keep it or cancel it' : 'Decide before it converts')
        : dateUnverified ? 'No confirmed renewal date'
        : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : relativeDay(days)
  const nextIsLate = (days != null && days < 0) || (trialDays != null && trialDays < 0)
  const resumeDate = status === 'canceled' ? rollForwardBillingDate(sub) : null
  const visiblePayments = showAllPayments ? payments : payments.slice(0, PAYMENTS_PREVIEW)

  return (
    <>
      <div>
        <StatusBadge tone={statusStyle.tone}>{statusStyle.label}</StatusBadge>
        <p className="price">
          <strong>{formatMoney(sub.amount, subCurrency)}</strong>
          <span>/ {cycleLabel(sub.cycle).toLowerCase()}</span>
        </p>
        <div className="price-notes">
          {sub.isShared
            ? <p>Your share: <span className="num">{formatMoney(monthly, subCurrency)}</span>/mo ({sub.sharedPct || 100}%)</p>
            : sub.cycle !== 'monthly' && <p><span className="num">{formatMoney(monthly, subCurrency)}</span> monthly equivalent</p>}
          {isForeign && toBase && (
            <p>≈ <span className="num">{formatMoney(toBase(monthly, sub), currency)}</span>/mo in {currency} at your Settings rate</p>
          )}
        </div>
      </div>

      {(dateUnverified || priceUnverified) && (
        <div className="verify-note">
          {dateUnverified && (
            <p>
              <span>The renewal date{sub.billingDate ? ` (${formatDisplayDate(sub.billingDate, LONG_DATE)})` : ''} came from an import and is not confirmed, so it is left out of forecasts and alerts.</span>
              <button type="button" onClick={() => onVerify?.(sub.id, 'schedule')} className="btn btn-sm"><Check aria-hidden="true" /> Date is right</button>
            </p>
          )}
          {priceUnverified && (
            <p>
              <span>The price is an unverified estimate. It still counts toward your monthly total.</span>
              <button type="button" onClick={() => onVerify?.(sub.id, 'amount')} className="btn btn-sm"><Check aria-hidden="true" /> Price is right</button>
            </p>
          )}
        </div>
      )}

      <div className="fact-grid">
        <Fact label={status === 'trial' ? 'Trial ends' : 'Next renewal'} value={nextTitle} description={nextDescription} danger={nextIsLate} />
        <Fact label="Billing cycle" value={cycleLabel(sub.cycle)} description={sub.renewal === 'manual' ? 'Manual renewal' : 'Auto-renew'} />
        <Fact label="Cost per year" value={formatMoney(monthly * 12, subCurrency)} description="at the current price" />
        <Fact
          label="Recorded paid"
          value={formatMoney(totalPaid, subCurrency)}
          description={payments.length ? `across ${payments.length} ${plural(payments.length, 'payment')}` : 'no payments yet'}
        />
      </div>

      <div>
        <div className="action-row">
          {status === 'active' && (
            <button type="button" onClick={() => onMarkPaid?.(sub.id)} className="btn btn-primary">
              <CheckCircle2 aria-hidden="true" /> Mark paid
            </button>
          )}
          {status === 'canceled' && (
            <button type="button" onClick={() => onReactivate?.(sub.id)} className="btn btn-primary" title={resumeDate ? `Resumes the schedule on ${formatDisplayDate(resumeDate, LONG_DATE)}` : undefined}>
              <RotateCcw aria-hidden="true" /> Reactivate
            </button>
          )}
          <button type="button" onClick={() => onEdit?.(sub)} className="btn">
            <Pencil aria-hidden="true" /> Edit
          </button>
          {status !== 'canceled' && (
            <button type="button" onClick={() => onTogglePause?.(sub.id)} className="btn">
              {status === 'paused' ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              {status === 'paused' ? 'Resume' : 'Pause'}
            </button>
          )}
        </div>
        {status === 'canceled' && resumeDate && (
          <p className="fine-print mt-2.5">Reactivating keeps the payment history and resumes the schedule on {formatDisplayDate(resumeDate, LONG_DATE)}.</p>
        )}
        <button type="button" onClick={() => onDelete?.(sub.id)} className="btn btn-danger-quiet mt-2 w-full">
          {status === 'canceled' ? <Trash2 aria-hidden="true" /> : <Archive aria-hidden="true" />}
          {status === 'canceled' ? 'Delete canceled record' : 'Archive as canceled'}
        </button>
      </div>

      <section aria-labelledby="payment-history-heading">
        <h3 id="payment-history-heading" className="drawer-section-title">
          Payment history <small>{payments.length} recorded</small>
        </h3>
        {payments.length ? (
          <div className="payment-table">
            <div><span>Due for</span><span>Paid on</span><span>Amount</span></div>
            {visiblePayments.map((payment, index) => (
              <PaymentRow key={`${payment.paidAt || payment.date || payment.dueFor}-${index}`} payment={payment} fallbackAmount={sub.amount} currency={subCurrency} />
            ))}
          </div>
        ) : (
          <p className="fine-print">No payments recorded yet.</p>
        )}
        {payments.length > PAYMENTS_PREVIEW && (
          <button type="button" onClick={onToggleAllPayments} className="text-link accent mt-2">
            {showAllPayments ? `Show the latest ${PAYMENTS_PREVIEW}` : `Show all ${payments.length} payments`}
          </button>
        )}
        <p className="hint mt-3">
          <Clock3 aria-hidden="true" />
          <span>{scheduleAnchorText(sub)}</span>
        </p>
      </section>
    </>
  )
}

function ReminderBody({ sub, subCurrency, currency, isForeign, toBase, onEdit, onDelete, onVerify }) {
  const days = getReminderDaysLeft(sub)
  const dateUnverified = sub.scheduleVerified === false
  const state = dateUnverified ? UNVERIFIED_REMINDER : reminderState(days)
  return (
    <>
      <div>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        <p className="price">
          <strong>{formatMoney(sub.amount, subCurrency)}</strong>
          <span>/ one-time</span>
        </p>
        {isForeign && toBase && (
          <div className="price-notes">
            <p>≈ <span className="num">{formatMoney(toBase(sub.amount, sub), currency)}</span> in {currency} at your Settings rate</p>
          </div>
        )}
      </div>

      <div className="fact-grid">
        <Fact
          label="Ends"
          value={dateUnverified ? 'Unverified' : sub.endDate ? formatDisplayDate(sub.endDate, LONG_DATE) : '—'}
          description={dateUnverified ? 'left out of alerts' : reminderEndPhrase(days)}
          danger={days != null && days < 0}
        />
        <Fact
          label="Purchased"
          value={sub.startDate ? formatDisplayDate(sub.startDate, LONG_DATE) : '—'}
          description={sub.startDate ? 'purchase date' : 'not recorded'}
        />
        <Fact label="Price paid" value={formatMoney(sub.amount, subCurrency)} description="one-time, not in monthly spend" />
        <Fact label="Time left" value={days == null ? '—' : days < 0 ? 'Ended' : `${days} ${plural(days, 'day')}`} description={dateUnverified ? 'end date unverified' : days == null ? 'set an end date' : days < 0 ? 'rebuy or let it go' : 'until it runs out'} />
      </div>

      {dateUnverified && (
        <div className="verify-note">
          <p>
            <span>The end date{sub.endDate ? ` (${formatDisplayDate(sub.endDate, LONG_DATE)})` : ''} came from an import and is not confirmed, so there are no alerts or calendar entry for it.</span>
            <button type="button" onClick={() => onVerify?.(sub.id, 'schedule')} className="btn btn-sm"><Check aria-hidden="true" /> Date is right</button>
          </p>
        </div>
      )}

      <div className="action-row">
        <button type="button" onClick={() => onEdit?.(sub)} className="btn btn-primary">
          <Pencil aria-hidden="true" /> Edit
        </button>
        <button type="button" onClick={() => onDelete?.(sub.id)} className="btn btn-danger">
          <Trash2 aria-hidden="true" /> Delete reminder
        </button>
      </div>

      <div>
        <p className="hint">
          <BellRing aria-hidden="true" />
          <span>One-time purchases never renew on their own. You get a notification and a calendar entry before the end date; when it ends, rebuy it or delete the reminder.</span>
        </p>
        {sub.endDate && !dateUnverified && (
          <p className="hint mt-2">
            <CalendarClock aria-hidden="true" />
            <span>Marked on the calendar for {formatDisplayDate(sub.endDate, LONG_DATE)}.</span>
          </p>
        )}
      </div>
    </>
  )
}

function Fact({ label, value, description, danger }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
      <span className={danger ? 'danger' : undefined}>{description}</span>
    </div>
  )
}

function PaymentRow({ payment, fallbackAmount, currency }) {
  const dueFor = payment.dueFor || payment.scheduledFor || payment.scheduledDate
  const paidAt = payment.paidAt || payment.date
  return (
    <div>
      <span>{dueFor ? formatDisplayDate(dueFor, LONG_DATE) : '—'}</span>
      <span>{paidAt ? formatDisplayDate(paidAt, LONG_DATE) : 'Pending'}</span>
      <b>{formatMoney(payment.amount ?? fallbackAmount, payment.currency || currency)}</b>
    </div>
  )
}

function MetaRow({ icon: Icon, label, value }) {
  return (
    <div className="meta-row">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function scheduleAnchorText(sub) {
  if (sub.scheduleVerified === false) {
    return sub.billingDate
      ? `The stored date, ${formatDisplayDate(sub.billingDate, LONG_DATE)}, is unverified and left out of forecasts and alerts.`
      : 'No verified renewal date is recorded.'
  }
  if (!sub.billingDate) return 'No billing anchor is set. Add one in Edit to keep future renewals predictable.'
  const anchor = parseLocalDate(sub.billingDate)
  if (!anchor) return 'The billing anchor needs review. Open Edit and choose a valid renewal date.'
  if (sub.cycle === 'weekly' || sub.cycle === 'biweekly') {
    return `Schedule anchor: ${formatDisplayDate(anchor, LONG_DATE)} (${anchor.toLocaleDateString(undefined, { weekday: 'long' })}). Future renewals are calculated from this cadence.`
  }
  return `Schedule anchor: ${formatDisplayDate(anchor, LONG_DATE)}. Future ${CYCLE_LABELS[sub.cycle]?.toLowerCase() || sub.cycle} renewals are calculated from this billing anchor.`
}
