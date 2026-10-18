import { useMemo } from 'react'
import { AlertTriangle, ArrowRight, BellRing, CalendarDays, Check, ChevronRight, Clock3, Eye, Plus, Target } from 'lucide-react'
import { formatMoney, makeSubConverter } from '../utils/currencies'
import {
  getCategoryBreakdown,
  getEffectiveAmount,
  getEffectiveMonthlyCost,
  getEndingReminders,
  getNextBillingDate,
  getPaidThisMonth,
  getUpcomingCharges,
  isActiveSub,
  isReminder,
} from '../utils/stats'
import { addDays, daysBetween, formatDisplayDate, parseLocalDate, startOfDay } from '../utils/dates'
import { getCategoryById, rankColor } from '../utils/categories'
import { getSubscriptionStatus } from '../utils/subscriptions'
import { cycleLabel, plural, relativeDayPhrase } from '../utils/labels'
import ServiceMark from './ServiceMark'
import StatusBadge from './StatusBadge'

const SHORT_DATE = { month: 'short', day: 'numeric' }
const TIMELINE_DAYS = 31
const TRIAL_WINDOW_DAYS = 14

export default function Dashboard({
  subs,
  settings,
  onAddClick,
  onMarkPaid,
  onViewDetail,
  onOpenCalendar,
  onOpenSubscriptions,
  onOpenReminders,
  onOpenSettings,
  today,
}) {
  const currency = settings.currency || 'USD'

  const model = useMemo(() => buildDashboardModel(subs, settings, today), [subs, settings, today])

  if (subs.length === 0) {
    return (
      <section className="empty">
        <h1 className="sr-only">Overview</h1>
        <Target aria-hidden="true" />
        <h2>See every renewal before it happens.</h2>
        <p>Add your recurring bills to see what is committed, what is actually paid, and what needs your attention next.</p>
        <button type="button" onClick={onAddClick} className="btn btn-primary">
          <Plus aria-hidden="true" /> Add your first subscription
        </button>
        <p className="fine-print">Your data stays on this device.</p>
      </section>
    )
  }

  const attentionParts = [
    model.overdue.length ? `${model.overdue.length} ${plural(model.overdue.length, 'payment')} overdue` : null,
    model.trials.length ? `${model.trials.length} ${plural(model.trials.length, 'trial')} to review` : null,
    model.remindersEnding.length ? `${model.remindersEnding.length} ${plural(model.remindersEnding.length, 'reminder')} ending` : null,
  ].filter(Boolean)
  const attentionCount = model.overdue.length + model.trials.length + model.remindersEnding.length
  const hasAttention = attentionCount > 0

  function reviewFirst() {
    const first = model.overdue[0]?.sub || model.trials[0]?.sub
    if (first) onViewDetail?.(first)
    else if (model.remindersEnding.length) onOpenReminders?.()
  }

  const hasBudget = settings.budget > 0

  return (
    <>
      <section className="hero" aria-labelledby="overview-heading">
        <div className="min-w-0">
          <p className="hero-intro">
            <span className="status-dot accent" aria-hidden="true" />
            {model.active.length} active {plural(model.active.length, 'subscription')}, normalized per month
          </p>
          <h1 id="overview-heading">
            <span className="sr-only">Overview: </span>
            <span className="num">{formatMoney(model.monthly, currency)} a month.</span>
            <span className="hero-sub">{model.dueSevenCount
              ? `${model.dueSevenCount} ${plural(model.dueSevenCount, 'charge')} this week.`
              : 'Nothing due this week.'}</span>
          </h1>
          <p className={`hero-description ${model.overdue.length ? 'danger' : ''}`}>
            {hasAttention ? `${attentionParts.join(' · ')}.` : 'Everything is in order. No overdue payments or trials ending soon.'}
          </p>
          <div className="hero-actions">
            {hasAttention && (
              <button type="button" onClick={reviewFirst} className="btn btn-primary">
                <AlertTriangle aria-hidden="true" /> Review {attentionCount} {plural(attentionCount, 'item')}
              </button>
            )}
            <button type="button" onClick={onOpenCalendar} className={`btn ${hasAttention ? '' : 'btn-primary'}`}>
              <CalendarDays aria-hidden="true" /> Open calendar
            </button>
          </div>
        </div>

        <CashTimeline model={model} currency={currency} />
      </section>

      <section className="stat-grid section" aria-label="This month at a glance">
        <Stat value={formatMoney(model.monthly * 12, currency)} label="A year at this rate" detail={`${model.active.length} active ${plural(model.active.length, 'subscription')}`} />
        <Stat
          value={formatMoney(model.dueSeven, currency)}
          label="Due in 7 days"
          detail={`${model.dueSevenCount} scheduled ${plural(model.dueSevenCount, 'charge')}`}
        />
        <Stat value={formatMoney(model.paidThisMonth, currency)} label="Paid this month" detail="From recorded payments" />
        <Stat
          value={hasBudget ? formatMoney(model.budgetRemaining, currency) : 'Not set'}
          tone={hasBudget ? (model.budgetRemaining >= 0 ? 'ok' : 'danger') : 'unset'}
          label="Budget remaining"
          detail={hasBudget ? `of ${formatMoney(settings.budget, currency)} a month` : 'Set a monthly budget in Settings'}
          progress={hasBudget ? model.budgetUsed : null}
          over={hasBudget && model.budgetRemaining < 0}
          onAction={onOpenSettings}
          actionLabel={hasBudget ? 'Change budget in Settings' : 'Set a monthly budget in Settings'}
        />
      </section>

      <div className="two-col lead section">
        <section aria-labelledby="upcoming-heading">
          <div className="section-heading">
            <div>
              <h2 id="upcoming-heading">Upcoming renewals</h2>
              <p>The next 45 days, soonest first.</p>
            </div>
            <button type="button" onClick={onOpenSubscriptions} className="text-link">
              All {model.recurringCount} <ArrowRight aria-hidden="true" />
            </button>
          </div>
          {model.upcoming.length ? (
            <div className="simple-list">
              {model.upcoming.map(item => (
                <RenewalRow
                  key={`${item.sub.id}-${item.type}`}
                  item={item}
                  currency={currency}
                  onOpen={() => onViewDetail?.(item.sub)}
                  onPaid={item.type === 'trial' ? null : () => onMarkPaid?.(item.sub.id)}
                />
              ))}
            </div>
          ) : (
            <div className="empty compact panel">
              <h3>No renewals in the next 45 days</h3>
              <p>Your near-term schedule is clear.</p>
            </div>
          )}
        </section>

        <section aria-labelledby="attention-heading">
          <div className="section-heading">
            <div>
              <h2 id="attention-heading">Needs attention</h2>
              <p>{model.overdueTotal > 0 ? `${formatMoney(model.overdueTotal, currency)} overdue in total.` : 'Overdue payments, trials and reminders.'}</p>
            </div>
          </div>
          {model.attentionItems.length ? (
            <div className="simple-list">
              {model.attentionItems.map(item => (
                <AttentionItem
                  key={item.id}
                  item={item}
                  currency={currency}
                  onOpen={() => item.kind === 'reminder' ? onOpenReminders?.() : onViewDetail?.(item.sub)}
                  onPaid={item.kind === 'overdue' ? () => onMarkPaid?.(item.sub.id) : null}
                />
              ))}
              {attentionCount > model.attentionItems.length && (
                <p className="fine-print px-2 py-2.5">+ {attentionCount - model.attentionItems.length} more</p>
              )}
            </div>
          ) : (
            <div className="empty compact panel">
              <h3>All clear</h3>
              <p>No overdue payments and no trials about to convert.</p>
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="category-heading">
        <div className="section-heading">
          <div>
            <h2 id="category-heading">By category</h2>
            <p>Where the monthly commitment goes.</p>
          </div>
        </div>
        {model.categories.length ? (
          <div className="grid gap-x-7 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {model.categories.slice(0, 6).map((row, rank) => {
              const pct = model.monthly > 0 ? (row.amount / model.monthly) * 100 : 0
              return (
                <div key={row.category} className="rank-bar">
                  <div>
                    <span className="ellipsis">{getCategoryById(row.category).label}</span>
                    <span className="num">{formatMoney(row.amount, currency)} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="meter"><span style={{ width: `${pct}%`, background: rankColor(rank) }} /></div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="fine-print">No active subscriptions yet — paused plans, trials and reminders are not counted here.</p>
        )}
      </section>
    </>
  )
}

function buildDashboardModel(subs, settings, day) {
  const today = startOfDay(day || new Date())
  // Every cross-subscription figure lands in the base display currency;
  // per-record rows keep their own money.
  const toBase = makeSubConverter(settings)
  const active = subs.filter(isActiveSub)
  const monthly = active.reduce((sum, sub) => sum + toBase(getEffectiveMonthlyCost(sub), sub), 0)
  const remindersEnding = getEndingReminders(subs, 14)

  const renewals = active.map(sub => {
    const date = getNextBillingDate(sub)
    return { sub, days: daysBetween(today, date), date, type: 'renewal', amount: getEffectiveAmount(sub) }
  })
  const overdue = renewals.filter(item => item.days < 0).sort((a, b) => a.days - b.days)

  // Trials ending soon AND trials whose end date has already passed. An ended
  // trial used to drop off this screen the day after it converted — exactly
  // when the record most needs a decision (keep it as paid, or cancel).
  const trials = subs
    .filter(s => getSubscriptionStatus(s) === 'trial' && parseLocalDate(s.trialEnd))
    .map(sub => ({ sub, days: daysBetween(today, sub.trialEnd) }))
    .filter(item => item.days <= TRIAL_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days)

  const trialRenewals = trials.filter(item => item.days >= 0).map(item => ({
    sub: item.sub,
    days: item.days,
    date: parseLocalDate(item.sub.trialEnd),
    type: 'trial',
    amount: getEffectiveAmount(item.sub),
  }))
  const upcoming = [...renewals, ...trialRenewals]
    .sort((a, b) => a.date - b.date)
    .filter(item => item.days <= 45)
    .slice(0, 6)

  // Cash figures are computed per scheduled charge, not per subscription: a
  // weekly plan bills four to five times inside a 31-day window and the
  // subscription-level view counted it once.
  // Horizon is 30 days *ahead*, i.e. day offsets 0-30 — exactly the 31 bars
  // the timeline renders, so the headline total and the chart always agree.
  const cashEvents = getUpcomingCharges(subs, TIMELINE_DAYS - 1, toBase)
  const seven = cashEvents.filter(charge => charge.days <= 7)

  const budget = parseFloat(settings.budget) || 0
  const budgetRemaining = budget - monthly
  const budgetUsed = budget > 0 ? Math.min(100, Math.max(0, (monthly / budget) * 100)) : 0

  // Only things the user can act on right now: overdue payments first
  // (each with a Mark-paid button), then trials, then one-time reminders
  // about to run out.
  const attentionItems = [
    ...overdue.map(({ sub, days }) => ({
      id: `overdue-${sub.id}`,
      kind: 'overdue',
      icon: AlertTriangle,
      tone: 'danger',
      title: `${sub.name} is ${relativeDayPhrase(days)}`,
      detail: 'Check the charge, then mark it paid to reset the schedule.',
      amount: getEffectiveAmount(sub),
      sub,
    })),
    ...trials.map(({ sub, days }) => ({
      id: `trial-${sub.id}`,
      kind: 'trial',
      icon: Clock3,
      tone: days < 0 ? 'danger' : 'accent',
      title: days < 0
        ? `${sub.name} trial ended ${Math.abs(days)} ${plural(Math.abs(days), 'day')} ago`
        : `${sub.name} trial ends ${relativeDayPhrase(days)}`,
      detail: days < 0
        ? 'It has probably converted — edit it into a paid plan or cancel it.'
        : 'Decide before it converts to a paid plan.',
      amount: getEffectiveMonthlyCost(sub),
      sub,
    })),
    ...remindersEnding.map(({ sub, days }) => ({
      id: `reminder-${sub.id}`,
      kind: 'reminder',
      icon: BellRing,
      tone: 'warn',
      title: `${sub.name} ends ${relativeDayPhrase(days)}`,
      detail: 'One-time purchase running out — rebuy or let it go.',
      amount: sub.amount,
      sub,
    })),
  ].slice(0, 5)

  return {
    today,
    active,
    monthly,
    overdue,
    trials,
    remindersEnding,
    recurringCount: subs.filter(s => !isReminder(s)).length,
    paidThisMonth: getPaidThisMonth(subs, toBase),
    dueSeven: seven.reduce((sum, item) => sum + item.amount, 0),
    dueSevenCount: seven.length,
    budgetRemaining,
    budgetUsed,
    upcoming,
    attentionItems,
    overdueTotal: overdue.reduce((sum, { sub }) => sum + toBase(getEffectiveAmount(sub), sub), 0),
    cashEvents,
    cashTotal: cashEvents.reduce((sum, item) => sum + item.amount, 0),
    categories: getCategoryBreakdown(subs, toBase),
  }
}

function Stat({ value, label, detail, tone, progress, over, onAction, actionLabel }) {
  const body = (
    <>
      <strong className={tone || undefined}>{value}</strong>
      <span>{label}</span>
      <small>{detail}</small>
      {progress !== null && progress !== undefined ? (
        <div className={`meter ${over ? 'over' : ''}`}><span style={{ width: `${progress}%` }} /></div>
      ) : null}
    </>
  )
  if (onAction) return <button type="button" className="stat" onClick={onAction} title={actionLabel}>{body}</button>
  return <div className="stat">{body}</div>
}

function RenewalRow({ item, currency, onOpen, onPaid }) {
  const { sub, days, date, type } = item
  const status = type === 'trial'
    ? { label: 'Trial ends', tone: 'accent' }
    : days < 0
      ? { label: 'Overdue', tone: 'danger' }
      : days <= 1
        ? { label: 'Due', tone: 'warn' }
        : { label: 'Scheduled', tone: 'ok' }
  const when = relativeDayPhrase(days)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3.5 px-2 py-2.5 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_84px_72px]">
      <button type="button" onClick={onOpen} className="row-title">
        <ServiceMark sub={sub} />
        <span>
          <strong>{sub.name}</strong>
          <small>{getCategoryById(sub.category).label}</small>
        </span>
      </button>
      <div className="hidden min-w-0 sm:block">
        <p className="num text-[12.5px] text-soft">{formatDisplayDate(date, SHORT_DATE)}</p>
        <p className={`text-[10.5px] ${days < 0 ? 'text-danger' : 'text-dim'}`}>{when}</p>
      </div>
      <div className="min-w-0 text-right sm:text-left">
        {/* Row amounts stay in the subscription's own currency; every total
            above is already converted to the base currency. */}
        <p className="num text-[12.5px] font-[560]">{formatMoney(item.amount, sub.currency || currency)}</p>
        <p className="hidden text-[10.5px] text-dim sm:block">{cycleLabel(sub.cycle).toLowerCase()}</p>
        <p className={`text-[10.5px] sm:hidden ${days < 0 ? 'text-danger' : 'text-dim'}`}>{when}</p>
      </div>
      <div className="hidden sm:block"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
      <div className="flex justify-end">
        {onPaid ? (
          <button type="button" onClick={onPaid} className="btn btn-sm">
            <Check aria-hidden="true" /> Paid
          </button>
        ) : (
          <button type="button" onClick={onOpen} className="btn btn-sm">
            <Eye aria-hidden="true" /> Review
          </button>
        )}
      </div>
    </div>
  )
}

const TONE_STYLES = {
  danger: { color: '#eaa7a7', background: '#2b1b1b' },
  accent: { color: '#cbb9ec', background: '#211c2b' },
  warn: { color: '#d0b68f', background: '#2a2418' },
}

function AttentionItem({ item, currency, onOpen, onPaid }) {
  const Icon = item.icon
  return (
    <div className="flex items-center gap-3 px-2 py-3">
      <span className="mark h-9 w-9" style={TONE_STYLES[item.tone]} aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block text-[12.5px] font-medium text-[#e4e3ea]">{item.title}</span>
        <span className="mt-0.5 block text-[11px] leading-[1.6] text-dim">{item.detail}</span>
      </button>
      <span className="flex flex-none flex-col items-end gap-1.5">
        <span className="num text-[11.5px] text-muted">{formatMoney(item.amount, item.sub.currency || currency)}{item.kind === 'trial' ? '/mo' : ''}</span>
        {onPaid ? (
          <button type="button" onClick={onPaid} className="btn btn-sm">
            <Check aria-hidden="true" /> Mark paid
          </button>
        ) : (
          <button type="button" onClick={onOpen} className="text-link accent">Review <ChevronRight aria-hidden="true" /></button>
        )}
      </span>
    </div>
  )
}

// 31 bars, one per day from today: the cash that is scheduled to leave.
function CashTimeline({ model, currency }) {
  const { cashEvents: events, cashTotal, today } = model
  const days = useMemo(() => Array.from({ length: TIMELINE_DAYS }, (_, day) => {
    const dayEvents = events.filter(event => event.days === day)
    return {
      day,
      total: dayEvents.reduce((sum, event) => sum + event.amount, 0),
      names: [...new Set(dayEvents.map(event => event.sub.name))],
    }
  }), [events])
  // Scale against the largest per-day TOTAL, not the largest single event —
  // a day with several charges must not overflow the chart.
  const max = Math.max(1, ...days.map(day => day.total))
  const peak = Math.max(...days.map(day => day.total))

  return (
    <div className="hero-chart">
      <div className="bars h-[150px]" role="img" aria-label={`Scheduled charges over the next ${TIMELINE_DAYS} days: ${formatMoney(cashTotal, currency)} across ${events.length} ${plural(events.length, 'charge')}`}>
        {days.map(({ day, total, names }) => {
          const label = formatDisplayDate(addDays(today, day), SHORT_DATE)
          return (
            <i
              key={day}
              title={total ? `${label}: ${formatMoney(total, currency)} — ${names.join(', ')}` : `${label}: nothing scheduled`}
              className={total ? (total === peak ? 'peak' : '') : 'empty-day'}
              style={{ height: total ? Math.max(10, (total / max) * 150) : 3 }}
            />
          )
        })}
      </div>
      <div className="axis"><span>Today</span><span>{formatDisplayDate(addDays(today, 15), SHORT_DATE)}</span><span>{formatDisplayDate(addDays(today, TIMELINE_DAYS - 1), SHORT_DATE)}</span></div>
      <p className="hero-caption">
        <span>{events.length} {plural(events.length, 'charge')}</span>
        <span className="num">{formatMoney(cashTotal, currency)} scheduled</span>
        <span>Next {TIMELINE_DAYS} days</span>
      </p>
    </div>
  )
}
