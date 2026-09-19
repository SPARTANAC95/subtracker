import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, BellRing, Check, ChevronRight, Clock3, Plus, ShieldCheck, Target, Wallet, CalendarDays, CircleCheck } from 'lucide-react'
import { formatMoney, makeSubConverter } from '../utils/currencies'
import {
  getCategoryBreakdown,
  getDaysUntilBilling,
  getEffectiveAmount,
  getEffectiveMonthlyCost,
  getEndingReminders,
  getNextBillingDate,
  getOverdueSubs,
  getPaidThisMonth,
  getUpcomingCharges,
  isActiveSub,
  isReminder,
} from '../utils/stats'
import { daysBetween, formatDisplayDate, parseLocalDate, startOfDay } from '../utils/dates'
import { getCategoryById, goldRampColor } from '../utils/categories'
import { getSubscriptionStatus } from '../utils/subscriptions'
import { cycleLabel, plural, relativeDayPhrase } from '../utils/labels'
import ServiceMark from './ServiceMark'

const ENTER = { opacity: 1, y: 0 }
const INITIAL = { opacity: 0, y: 8 }

const HAIRLINE = 'rgba(242,240,234,0.06)'

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
      <motion.section initial={INITIAL} animate={ENTER} className="glass px-6 py-16 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(225,173,102,0.32)] bg-[rgba(225,173,102,0.12)]">
          <Target className="h-6 w-6 text-[#e1ad66]" />
        </div>
        <h2 className="font-figure text-2xl font-medium tracking-tight text-(--app-text)">See every renewal before it happens.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[rgba(242,240,234,0.45)]">
          Add your recurring bills to see what is committed, what is actually paid, and what needs your attention next.
        </p>
        <button onClick={onAddClick} className="btn btn-primary mt-6 min-h-11">
          <Plus className="h-4 w-4" /> Add your first subscription
        </button>
        <p className="mt-4 text-xs text-[rgba(242,240,234,0.35)]">Your data stays on this device.</p>
      </motion.section>
    )
  }

  const attentionText = [
    model.overdue.length ? `${model.overdue.length} ${plural(model.overdue.length, 'payment')} overdue` : null,
    model.trialsSoon.length ? `${model.trialsSoon.length} ${plural(model.trialsSoon.length, 'trial')} ending` : null,
    model.remindersEnding.length ? `${model.remindersEnding.length} ${plural(model.remindersEnding.length, 'reminder')} ending` : null,
  ].filter(Boolean)
  const hasAttention = attentionText.length > 0
  const attentionColor = hasAttention ? '#d99f8b' : '#9ec8a0'

  return (
    <div className="flex flex-col gap-3.5 pb-3">
      <motion.button
        type="button"
        initial={INITIAL}
        animate={ENTER}
        onClick={() => {
          const first = model.overdue[0] || model.trialsSoon[0]?.sub
          if (first) onViewDetail?.(first)
          else if (model.remindersEnding.length) onOpenReminders?.()
        }}
        className="flex min-h-14 w-full items-center gap-3.5 rounded-[18px] px-5 py-3 text-left transition-colors hover:border-[rgba(242,240,234,0.14)]"
        style={{
          border: `1px solid ${hasAttention ? 'rgba(217,159,139,0.3)' : 'rgba(242,240,234,0.07)'}`,
          background: hasAttention ? 'rgba(217,159,139,0.05)' : 'linear-gradient(180deg, rgba(242,240,234,0.04), rgba(242,240,234,0.015))',
        }}
      >
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px]" style={{ background: `${hasAttention ? 'rgba(217,159,139,0.12)' : 'rgba(158,200,160,0.12)'}`, color: attentionColor }}>
          {hasAttention ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        </span>
        <span className="font-figure text-[15px] font-semibold" style={{ color: attentionColor }}>
          {hasAttention ? 'Needs attention' : 'Everything is in order'}
        </span>
        <span className="hidden h-[18px] w-px bg-[rgba(242,240,234,0.1)] sm:block" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-[rgba(242,240,234,0.52)]">
          {hasAttention ? attentionText.join('  ·  ') : 'No overdue payments or trials ending soon.'}
        </span>
        <ChevronRight className="h-4 w-4 flex-none text-[rgba(242,240,234,0.32)]" />
      </motion.button>

      <motion.section initial={INITIAL} animate={ENTER} transition={{ delay: 0.03 }} className="grid-metrics">
        <Metric
          label="Monthly commitment"
          icon={Wallet}
          value={formatMoney(model.monthly, currency)}
          detail={`${model.active.length} active · normalized per month`}
        />
        <Metric
          label="Due in 7 days"
          icon={CalendarDays}
          value={formatMoney(model.dueSeven, currency)}
          detail={`${model.dueSevenCount} scheduled ${plural(model.dueSevenCount, 'charge')}`}
        />
        <Metric
          label="Recorded paid"
          icon={CircleCheck}
          value={formatMoney(model.paidThisMonth, currency)}
          detail="Payment history this month"
        />
        <Metric
          label="Budget remaining"
          icon={Target}
          onAction={onOpenSettings}
          value={settings.budget > 0 ? formatMoney(model.budgetRemaining, currency) : 'Not set'}
          detail={settings.budget > 0 ? `of ${formatMoney(settings.budget, currency)}` : 'Set a monthly budget in Settings'}
          valueColor={settings.budget > 0 ? (model.budgetRemaining >= 0 ? '#9ec8a0' : '#d99f8b') : 'rgba(242,240,234,0.4)'}
          progress={settings.budget > 0 ? model.budgetUsed : null}
        />
      </motion.section>

      <div className="grid-main">
        <section className="glass flex flex-col overflow-hidden">
          <SectionHeader title="Upcoming renewals" action="View calendar →" onAction={onOpenCalendar} />
          <div className="renewal-table">
            <div className="font-figure hidden grid-cols-[minmax(190px,1.6fr)_1fr_.7fr_.75fr_112px] gap-3 border-b px-5 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[rgba(242,240,234,0.42)] md:grid" style={{ borderColor: 'rgba(242,240,234,0.08)' }}>
              <span>Subscription</span><span>Due date</span><span>Amount</span><span>Status</span><span className="text-right">Action</span>
            </div>
            {model.upcoming.length ? model.upcoming.map(item => (
              <RenewalRow
                key={`${item.sub.id}-${item.type}`}
                item={item}
                currency={currency}
                onOpen={() => onViewDetail?.(item.sub)}
                onPaid={item.type === 'trial' ? null : () => onMarkPaid?.(item.sub.id)}
              />
            )) : (
              <div className="px-5 py-11 text-center">
                <p className="font-figure text-base text-(--app-text)">No renewals in the next 45 days</p>
                <p className="mt-1.5 text-xs text-[rgba(242,240,234,0.4)]">Your near-term schedule is clear.</p>
              </div>
            )}
          </div>
          <button onClick={onOpenSubscriptions} className="mt-auto flex min-h-[46px] w-full items-center justify-center gap-2 border-t text-[13px] text-[rgba(242,240,234,0.52)] transition-colors hover:bg-[rgba(242,240,234,0.035)] hover:text-(--app-text)" style={{ borderColor: HAIRLINE }}>
            View all subscriptions ({model.recurringCount}) →
          </button>
        </section>

        <section className="glass flex flex-col overflow-hidden">
          <SectionHeader title="Needs attention" action="View all →" onAction={onOpenSubscriptions} />
          <div>
            {model.attentionItems.length ? model.attentionItems.map((item, index) => (
              <AttentionItem
                key={item.id}
                item={item}
                currency={currency}
                separated={index > 0}
                onOpen={() => item.kind === 'reminder' ? onOpenReminders?.() : onViewDetail?.(item.sub)}
                onPaid={item.kind === 'overdue' ? () => onMarkPaid?.(item.sub.id) : null}
              />
            )) : (
              <div className="grid flex-1 place-items-center px-5 py-10 text-center">
                <div>
                  <p className="font-figure text-base text-(--app-text)">All clear</p>
                  <p className="mt-1.5 text-xs leading-5 text-[rgba(242,240,234,0.4)]">No overdue payments and no trials about to convert.</p>
                </div>
              </div>
            )}
          </div>
          {model.overdueTotal > 0 ? (
            <div className="mt-auto flex items-center justify-between gap-3.5 border-t px-5 py-3.5" style={{ borderColor: HAIRLINE }}>
              <div>
                <p className="text-[13px] font-semibold text-(--app-text)">Total overdue</p>
                <p className="mt-1 text-[11px] text-[rgba(242,240,234,0.42)]">Mark each one paid once you have checked the charge.</p>
              </div>
              <p className="font-figure text-[21px] font-semibold text-[#d99f8b]">{formatMoney(model.overdueTotal, currency)}</p>
            </div>
          ) : null}
        </section>
      </div>

      <div className="grid-sub">
        <section className="glass p-5 sm:px-[21px] sm:py-[19px]">
          <div className="flex flex-wrap items-start justify-between gap-3.5">
            <div>
              <h2 className="text-base font-semibold text-(--app-text)">Next 31 days</h2>
              <p className="mt-1 text-[11.5px] text-[rgba(242,240,234,0.42)]">Scheduled cash leaving your account, not recorded payments.</p>
            </div>
            <p className="font-figure text-[13px] font-semibold text-(--app-text)">{formatMoney(model.nextThirtyOneTotal, currency)} <span className="font-sans font-normal text-[rgba(242,240,234,0.42)]">scheduled</span></p>
          </div>
          <CashTimeline events={model.cashEvents} currency={currency} />
        </section>

        <section className="glass p-5 sm:px-[21px] sm:py-[19px]">
          <h2 className="text-base font-semibold text-(--app-text)">By category</h2>
          <p className="mt-1 text-[11.5px] text-[rgba(242,240,234,0.42)]">Monthly commitment</p>
          <div className="mt-[17px] flex flex-col gap-3.5">
            {model.categories.slice(0, 5).map((row, rank) => {
              const category = getCategoryById(row.category)
              const pct = model.monthly > 0 ? (row.amount / model.monthly) * 100 : 0
              return (
                <div key={row.category}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="micro-label truncate text-[rgba(242,240,234,0.7)]">{category.label}</span>
                    <span className="font-figure text-[11px] text-[rgba(242,240,234,0.45)]">{formatMoney(row.amount, currency)} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-[rgba(242,240,234,0.06)]">
                    <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: goldRampColor(rank) }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

function buildDashboardModel(subs, settings, day) {
  const today = startOfDay(day || new Date())
  // Every cross-subscription figure lands in the base display currency;
  // per-record rows keep their own money.
  const toBase = makeSubConverter(settings)
  const active = subs.filter(isActiveSub)
  const monthly = active.reduce((sum, sub) => sum + toBase(getEffectiveMonthlyCost(sub), sub), 0)
  const overdue = getOverdueSubs(subs)
  const remindersEnding = getEndingReminders(subs, 14)

  const trialsSoon = subs
    .filter(s => getSubscriptionStatus(s) === 'trial' && parseLocalDate(s.trialEnd))
    .map(sub => ({ sub, days: daysBetween(today, sub.trialEnd) }))
    .filter(item => item.days >= 0 && item.days <= 14)
    .sort((a, b) => a.days - b.days)

  const renewals = active.map(sub => {
    const days = getDaysUntilBilling(sub)
    return { sub, days, date: getNextBillingDate(sub), type: 'renewal', amount: getEffectiveAmount(sub) }
  })
  const trialRenewals = trialsSoon.map(item => ({
    sub: item.sub,
    days: item.days,
    date: parseLocalDate(item.sub.trialEnd),
    type: 'trial',
    amount: getEffectiveAmount(item.sub),
  }))
  const upcomingAll = [...renewals, ...trialRenewals].sort((a, b) => a.date - b.date)
  const upcoming = upcomingAll.filter(item => item.days <= 45).slice(0, 6)

  // Cash figures are computed per scheduled charge, not per subscription: a
  // weekly plan bills four to five times inside a 31-day window and the
  // subscription-level view counted it once.
  // Horizon is 30 days *ahead*, i.e. day offsets 0-30 — exactly the 31 bars
  // the timeline renders, so the headline total and the chart always agree.
  const chargesThirtyOne = getUpcomingCharges(subs, 30, toBase)
  const seven = chargesThirtyOne.filter(charge => charge.days <= 7)

  const budget = parseFloat(settings.budget) || 0
  const budgetRemaining = budget - monthly
  const budgetUsed = budget > 0 ? Math.min(100, Math.max(0, (monthly / budget) * 100)) : 0

  // Only things the user can act on right now: overdue payments first
  // (each with a Mark-paid button), then trials about to convert, then
  // one-time reminders about to run out.
  const attentionItems = [
    ...overdue.map(sub => ({
      id: `overdue-${sub.id}`,
      kind: 'overdue',
      icon: AlertTriangle,
      color: '#d99f8b',
      title: `${sub.name} is ${relativeDayPhrase(getDaysUntilBilling(sub))}`,
      detail: 'Check the charge, then mark it paid to reset the schedule.',
      amount: getEffectiveAmount(sub),
      sub,
    })),
    ...trialsSoon.map(({ sub, days }) => ({
      id: `trial-${sub.id}`,
      kind: 'trial',
      icon: Clock3,
      color: '#e1ad66',
      title: `${sub.name} trial ends ${relativeDayPhrase(days)}`,
      detail: 'Decide before it converts to a paid plan.',
      amount: getEffectiveMonthlyCost(sub),
      sub,
    })),
    ...remindersEnding.map(({ sub, days }) => ({
      id: `reminder-${sub.id}`,
      kind: 'reminder',
      icon: BellRing,
      color: '#d9c28b',
      title: `${sub.name} ends ${relativeDayPhrase(days)}`,
      detail: 'One-time purchase running out — rebuy or let it go.',
      amount: sub.amount,
      sub,
    })),
  ].slice(0, 5)

  const cashEvents = chargesThirtyOne

  return {
    active,
    monthly,
    overdue,
    trialsSoon,
    remindersEnding,
    recurringCount: subs.filter(s => !isReminder(s)).length,
    paidThisMonth: getPaidThisMonth(subs, toBase),
    dueSeven: seven.reduce((sum, item) => sum + item.amount, 0),
    dueSevenCount: seven.length,
    budgetRemaining,
    budgetUsed,
    upcoming,
    attentionItems,
    overdueTotal: overdue.reduce((sum, sub) => sum + toBase(getEffectiveAmount(sub), sub), 0),
    cashEvents,
    nextThirtyOneTotal: cashEvents.reduce((sum, item) => sum + item.amount, 0),
    categories: getCategoryBreakdown(subs, toBase),
  }
}

function Metric({ label, value, detail, valueColor, progress, icon: Icon, onAction }) {
  return (
    <div className="glass metric-card relative min-h-[146px] px-[21px] py-[19px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[rgba(242,240,234,0.65)]">{label}</p>
        {Icon && <Icon aria-hidden="true" className="h-4 w-4 flex-none text-[#e1ad66]/70" />}
      </div>
      <p className="font-figure mt-[13px] text-[clamp(24px,7vw,31px)] font-medium leading-none tracking-[-0.02em]" style={{ color: valueColor || 'var(--app-text)' }}>{value}</p>
      {onAction ? <button onClick={onAction} className="mt-[9px] text-left text-[11.5px] text-[#e1ad66] hover:underline">{detail} →</button>
        : <p className="mt-[9px] text-[11.5px] text-[rgba(242,240,234,0.55)]">{detail}</p>}
      {progress !== null && progress !== undefined ? (
        <div className="absolute inset-x-[21px] bottom-3.5 h-[3px] rounded-full bg-[rgba(242,240,234,0.07)]">
          <div className="h-[3px] rounded-full bg-[#e1ad66]" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  )
}

function SectionHeader({ title, action, onAction }) {
  return (
    <div className="flex min-h-[54px] flex-none items-center justify-between gap-3 border-b px-5" style={{ borderColor: HAIRLINE }}>
      <h2 className="text-base font-semibold text-(--app-text)">{title}</h2>
      {action ? <button onClick={onAction} className="btn btn-ghost text-xs">{action}</button> : null}
    </div>
  )
}

function RenewalRow({ item, currency, onOpen, onPaid }) {
  const { sub, days, date, type } = item
  const category = getCategoryById(sub.category)
  const status = type === 'trial'
    ? { label: 'Trial ends', color: '#e1ad66', bg: 'rgba(225,173,102,0.12)' }
    : days < 0
      ? { label: 'Overdue', color: '#d99f8b', bg: 'rgba(217,159,139,0.12)' }
      : days <= 1
        ? { label: 'Due', color: '#d9c28b', bg: 'rgba(217,194,139,0.12)' }
        : { label: 'Scheduled', color: '#9ec8a0', bg: 'rgba(158,200,160,0.1)' }

  return (
    <div className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-5 py-3 text-[13px] transition-colors last:border-b-0 hover:bg-[rgba(242,240,234,0.028)] md:grid-cols-[minmax(190px,1.6fr)_1fr_.7fr_.75fr_112px]" style={{ borderColor: 'rgba(242,240,234,0.05)' }}>
      <button onClick={onOpen} className="flex min-w-0 items-center gap-3 text-left">
        <ServiceMark sub={sub} />
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold text-(--app-text)">{sub.name}</span>
          <span className="cat-label truncate">{category.label}</span>
        </span>
      </button>
      <div className="hidden md:block">
        <p className="text-[rgba(242,240,234,0.82)]">{formatDisplayDate(date, { month: 'short', day: 'numeric' })}</p>
        <p className="mt-0.5 text-[11px]" style={{ color: days < 0 ? '#d99f8b' : 'rgba(242,240,234,0.42)' }}>{relativeDayPhrase(days)}</p>
      </div>
      <div className="text-right md:text-left">
        {/* Row amounts stay in the subscription's own currency; every total
            above is already converted to the base currency. */}
        <p className="font-figure font-semibold text-(--app-text)">{formatMoney(item.amount, sub.currency || currency)}</p>
        <p className="mt-0.5 text-[11px] text-[rgba(242,240,234,0.38)]">{cycleLabel(sub.cycle).toLowerCase()}</p>
      </div>
      <div>
        <span className="status-pill" style={{ background: status.bg, color: status.color }}><i aria-hidden="true" />{status.label}</span>
      </div>
      <div className="flex justify-end">
        {onPaid ? (
          <button onClick={onPaid} className="btn btn-secondary btn-sm">
            <Check className="h-3.5 w-3.5" /> Paid
          </button>
        ) : (
          <button onClick={onOpen} className="btn btn-ghost btn-sm">Review</button>
        )}
      </div>
    </div>
  )
}

function AttentionItem({ item, currency, separated, onOpen, onPaid }) {
  const Icon = item.icon
  return (
    <div className="flex min-h-[84px] items-center gap-[13px] px-5 py-[15px]" style={separated ? { borderTop: '1px solid rgba(242,240,234,0.05)' } : undefined}>
      <span className="grid h-9 w-9 flex-none place-items-center rounded-[11px]" style={{ background: `${item.color}1c`, color: item.color }}>
        <Icon className="h-4 w-4" />
      </span>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block text-[13.5px] font-semibold text-(--app-text)">{item.title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-5 text-[rgba(242,240,234,0.42)]">{item.detail}</span>
      </button>
      <span className="flex-none text-right">
        <span className="font-figure block text-xs text-[rgba(242,240,234,0.6)]">{formatMoney(item.amount, item.sub.currency || currency)}{item.kind === 'trial' ? '/mo' : ''}</span>
        {onPaid ? (
          <button onClick={onPaid} className="btn btn-secondary mt-1.5 min-h-[26px] px-[11px] py-0.5 text-[11.5px]">
            <Check className="h-3 w-3" /> Paid
          </button>
        ) : (
          <button onClick={onOpen} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[#facb8d]">Review <ChevronRight className="h-3.5 w-3.5" /></button>
        )}
      </span>
    </div>
  )
}

function CashTimeline({ events, currency }) {
  // Scale against the largest per-day TOTAL, not the largest single event —
  // a day with several charges must not overflow the 100px chart row.
  const dayTotals = Array.from({ length: 31 }, (_, day) =>
    events.filter(event => event.days === day).reduce((sum, event) => sum + event.amount, 0)
  )
  const max = Math.max(1, ...dayTotals)
  return (
    <div className="mt-5">
      <div className="flex h-[100px] items-end gap-[3px] border-b px-0.5" style={{ borderColor: 'rgba(242,240,234,0.09)' }} role="img" aria-label="Scheduled charges over the next 31 days">
        {dayTotals.map((total, day) => {
          const height = total > 0 ? Math.max(12, (total / max) * 84) : 2
          return (
            <div
              key={day}
              title={total ? `Day ${day}: ${formatMoney(total, currency)}` : `Day ${day}: no charge`}
              className="min-w-0 flex-1 rounded-t-[3px]"
              style={{ height, background: total ? 'rgba(225,173,102,0.75)' : 'rgba(242,240,234,0.07)' }}
            />
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[9.5px] uppercase tracking-[0.09em] text-[rgba(242,240,234,0.32)]"><span>Today</span><span>15 days</span><span>30 days</span></div>
      {events.length ? (
        <div className="mt-3.5 flex flex-wrap gap-x-[18px] gap-y-1.5">
          {events.slice(0, 4).map(event => (
            <span key={`${event.sub.id}-${event.days}`} className="text-xs text-[rgba(242,240,234,0.52)]">
              <span className="mr-[7px] inline-block h-1.5 w-1.5 rounded-full bg-[#e1ad66] align-[1px]" />{event.sub.name} {formatMoney(event.amount, currency)}
            </span>
          ))}
        </div>
      ) : <p className="mt-3.5 text-xs text-[rgba(242,240,234,0.4)]">No scheduled charges in this range.</p>}
    </div>
  )
}
