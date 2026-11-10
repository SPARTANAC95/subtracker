import { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  LayoutDashboard, List, BellRing, BarChart3, CalendarDays, Settings,
  Volume2, VolumeX, Search, Plus, X
} from 'lucide-react'
import useLocalStorage from './hooks/useLocalStorage'
import useAutoBackup from './hooks/useAutoBackup'
import useServerSync from './hooks/useServerSync'
import useDayTick from './hooks/useDayTick'
import useModal from './hooks/useModal'
import { clearAllAppData, ensurePersistentStorage, parseBackupPayload } from './utils/persistence'
import { playClick, playSuccess, playDelete, isEnabled, setEnabled } from './utils/sounds'
import { makeSubConverter, pinSubscriptionCurrency } from './utils/currencies'
import {
  getDaysUntilBilling, getMissedOccurrences, getNextBillingDate,
  isActiveSub, reactivateSubscription, recordSubscriptionPayment,
  undoSubscriptionPayment,
} from './utils/stats'
import { checkUpcomingBills } from './utils/notifications'
import { daysBetween, formatDateOnly, formatDisplayDate, parseLocalDate } from './utils/dates'
import { MOD_KEY, plural } from './utils/labels'
import { normalizeSettings } from './utils/settings'
import {
  SUBSCRIPTION_DEFAULTS,
  createSubscriptionId,
  getSubscriptionStatus,
  isReminder,
  normalizeSubscription,
  normalizeSubscriptions,
  normalizeSubscriptionsWithReport,
  repairSubscriptions,
} from './utils/subscriptions'

import { ToastProvider } from './components/Toast'
import { useToast } from './components/toast-context'
import BrandMark from './components/BrandMark'
import Presence, { leaving, useIsPresent } from './components/Presence'
import SetupWizard from './components/SetupWizard'
import CommandPalette from './components/CommandPalette'
import ShortcutsHelp from './components/ShortcutsHelp'
import SubscriptionDetail from './components/SubscriptionDetail'
import Dashboard from './components/Dashboard'
import SubscriptionForm from './components/SubscriptionForm'
import SubscriptionList from './components/SubscriptionList'
// A tab left open across a rebuild still asks for the previous build's files,
// which are gone. Reload once to pick up the new build instead of showing an
// error (at most once every few seconds, so a real failure cannot loop).
const CHUNK_RELOAD_KEY = 'st-chunk-reload'
function reloadIfStale(importer) {
  return () => importer().catch(error => {
    try {
      const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0
      if (Date.now() - last > 10000) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
        window.location.reload()
        return new Promise(() => {})
      }
    } catch { /* storage unavailable — fall through to the error screen */ }
    throw error
  })
}

// A page that is not on screen first lives in its own chunk. Once that chunk
// has arrived (it is fetched while the browser is idle) the page renders
// directly; React.lazy alone would still flash the loading fallback for a
// frame on every first visit.
function panel(importer) {
  let Loaded = null
  const load = () => importer().then(module => { Loaded = module.default; return module })
  const Lazy = lazy(reloadIfStale(load))
  function Panel(props) {
    // Decided once per mount: swapping component types mid-life would
    // remount the page and drop its state.
    const [Component] = useState(() => Loaded || Lazy)
    return <Component {...props} />
  }
  Panel.preload = () => load().catch(() => {})
  return Panel
}

const AnalyticsPanel = panel(() => import('./components/AnalyticsPanel'))
const CalendarView = panel(() => import('./components/CalendarView'))
const RemindersPanel = panel(() => import('./components/RemindersPanel'))
const SettingsPanel = panel(() => import('./components/SettingsPanel'))

// Fetch the other pages' code while the browser is idle, so switching to them
// never waits on a download and they are cached for the times the local
// server is not running.
function preloadPanels() {
  for (const Panel of [AnalyticsPanel, CalendarView, RemindersPanel, SettingsPanel]) Panel.preload()
}

// Order matters: the 1–6 shortcuts index into this list.
const TABS = [
  { id: 'track', label: 'Overview', icon: LayoutDashboard },
  { id: 'list', label: 'Subscriptions', icon: List },
  { id: 'reminders', label: 'Reminders', icon: BellRing },
  { id: 'charts', label: 'Insights', icon: BarChart3 },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'settings', label: 'Settings', icon: Settings },
]
const SETTINGS_TAB = TABS[5]
const MAIN_TABS = TABS.slice(0, 5)

// Five slots only — Reminders and Settings sit in the mobile header instead.
const MOBILE_NAV = [
  TABS[0],
  TABS[1],
  { id: 'add', label: 'Add', icon: Plus, action: 'add' },
  TABS[4],
  TABS[3],
]

const FULL_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

const UP_NEXT_COUNT = 4

// Compact "when" for the sidebar's Up next list.
function shortWhen(days, date) {
  if (days < 0) return 'Overdue'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return `${days} days`
  return formatDisplayDate(date, SHORT_DATE)
}

const subsValidator = v => Array.isArray(v) && v.every(s => s && typeof s === 'object' && !Array.isArray(s))
const settingsValidator = v => v === null || (v && typeof v === 'object' && !Array.isArray(v))
const dismissedValidator = v => Array.isArray(v)

const SHORT_DATE = { month: 'short', day: 'numeric' }

function AppInner() {
  const [subs, setSubs, subsStatus, subsHydrated] = useLocalStorage('st-subs', [], { validate: subsValidator, transform: repairSubscriptions })
  const [settings, setSettings, settingsStatus, settingsHydrated] = useLocalStorage('st-settings', null, { validate: settingsValidator, transform: normalizeSettings })
  const [dismissed, setDismissed, , dismissedHydrated] = useLocalStorage('st-dismissed', [], { validate: dismissedValidator })
  const hydrated = subsHydrated && settingsHydrated && dismissedHydrated
  const [tab, setTab] = useState('track')
  const [editSub, setEditSub] = useState(null)
  const [detailSub, setDetailSub] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [formKind, setFormKind] = useState('recurring')
  const [soundOn, setSoundOn] = useState(isEnabled)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const mainRef = useRef(null)
  const toast = useToast()
  const migratedRef = useRef(false)
  // Re-renders at local midnight and when the tab comes back on a new day,
  // so "due in N days" and overdue states never go stale in a long-lived tab.
  const today = useDayTick()

  // Server sync boot handler: the disk file was newer than this browser's
  // copy, so replace state with it (repair-mode normalization — it is our own
  // file). Runs before first paint, so opening the app in a brand-new browser
  // lands directly on the data instead of the setup wizard.
  const applyServerPayload = useCallback((payload) => {
    try {
      const parsed = parseBackupPayload(payload)
      setSubs(normalizeSubscriptions(parsed.subs, { genId: createSubscriptionId }))
      setSettings(normalizeSettings(parsed.settings))
      if (Array.isArray(parsed.dismissed)) setDismissed(parsed.dismissed)
      return true
    } catch {
      return false
    }
  }, [setSubs, setSettings, setDismissed])

  const sync = useServerSync({ subs, settings, dismissed, hydrated, onApply: applyServerPayload })
  const backup = useAutoBackup({ subs, settings, dismissed, hydrated: hydrated && sync.ready })

  // Converts any subscription amount into the base display currency using
  // the (editable) rates in settings. Identity for base-currency records.
  const toBase = useMemo(() => makeSubConverter(settings), [settings])

  // Ask the browser to exempt our storage from automatic eviction.
  useEffect(() => { ensurePersistentStorage() }, [])

  useEffect(() => {
    if (migratedRef.current || !subsHydrated || !Array.isArray(subs)) return
    const normalized = normalizeSubscriptions(subs, { genId: createSubscriptionId })
    const needsMigration = JSON.stringify(normalized) !== JSON.stringify(subs)
    migratedRef.current = true
    if (needsMigration) setSubs(normalized)
  }, [subs, setSubs, subsHydrated])

  useEffect(() => {
    if (!settings || settings.notifications === false) return
    if (!subs || subs.length === 0) return
    const run = () => checkUpcomingBills(subs, settings)
    run()
    const id = setInterval(run, 6 * 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [subs, settings, today])


  const switchTab = useCallback((newTab) => {
    setTab(newTab)
    playClick()
  }, [])

  // A new page starts at its top; without this, switching from the bottom of
  // a long list landed halfway down the next screen.
  useEffect(() => {
    mainRef.current?.scrollTo?.(0, 0)
    window.scrollTo(0, 0)
  }, [tab])

  // The soonest scheduled renewals, for the sidebar. Recomputed when the
  // calendar day changes so "Tomorrow" and "Overdue" roll over with it.
  const upNext = useMemo(() => {
    const from = parseLocalDate(today) || new Date()
    return (Array.isArray(subs) ? subs : [])
      .filter(isActiveSub)
      // Records without a confirmed schedule have no "next" to show.
      .map(sub => ({ sub, date: getNextBillingDate(sub) }))
      .filter(item => item.date)
      .map(item => ({ ...item, days: daysBetween(from, item.date) }))
      .sort((a, b) => a.date - b.date)
      .slice(0, UP_NEXT_COUNT)
  }, [subs, today])

  // Recurring records and one-time reminders share the store but live in
  // separate tabs — split once per data change so counts and lists stay
  // consistent and the pages only rebuild their models when the data moves.
  const recurringSubs = useMemo(() => (Array.isArray(subs) ? subs.filter(s => !isReminder(s)) : []), [subs])
  const reminderSubs = useMemo(() => (Array.isArray(subs) ? subs.filter(isReminder) : []), [subs])

  // Shortcuts only make sense once the main interface is on screen. Before
  // that (loading, first-run setup) a stray "n" or "2" used to queue up a
  // form or a tab switch that then appeared the moment setup finished.
  const appReady = hydrated && sync.ready && Boolean(settings)

  useEffect(() => {
    if (!appReady) return undefined
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(preloadPanels, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = window.setTimeout(preloadPanels, 1500)
    return () => window.clearTimeout(timer)
  }, [appReady])

  useEffect(() => {
    if (!appReady) return undefined
    function onKey(e) {
      // Synthetic events (autofill, some IMEs) can arrive without a key.
      const key = typeof e.key === 'string' ? e.key : ''
      if (!key) return
      if (!showForm && !detailSub && !shortcutsOpen && (e.metaKey || e.ctrlKey) && key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(o => !o); return }
      // Any overlay open → only Escape works; single-key shortcuts must not
      // fire underneath a modal (typing "n" over the detail drawer used to
      // open the add form behind it).
      if (cmdOpen || showForm || shortcutsOpen || detailSub) {
        if (key === 'Escape') { setEditSub(null); setDetailSub(null); setCmdOpen(false); setShowForm(false); setShortcutsOpen(false) }
        return
      }
      const target = e.target
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable) return
      // Single-key shortcuts must not hijack browser chords such as Ctrl+N.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (key === '?') { e.preventDefault(); setShortcutsOpen(true); return }
      if (key === 'n' || key === 'N') {
        // Same rule as the Add buttons: on the Reminders page, "new" means a
        // new reminder.
        setEditSub(null)
        setFormKind(tab === 'reminders' ? 'reminder' : 'recurring')
        setShowForm(true)
        return
      }
      if (key === '/') {
        e.preventDefault()
        switchTab('list')
        // Land in the search box once the list has rendered.
        window.setTimeout(() => document.getElementById('subscription-search')?.focus(), 60)
        return
      }
      if (key >= '1' && key <= '6') { switchTab(TABS[parseInt(key, 10) - 1]?.id || 'track'); return }
      if (key === 'Escape') { setEditSub(null); setDetailSub(null); setCmdOpen(false); setShowForm(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [appReady, cmdOpen, switchTab, showForm, shortcutsOpen, detailSub, tab])

  // Wait for both browser storage AND the first server handshake — otherwise
  // a new browser would flash the setup wizard before disk data arrives.
  if (!hydrated || !sync.ready) return <LoadingScreen />
  if (!settings) {
    return (
      <SetupWizard
        onComplete={(s, importedSubs, importedDismissed) => {
          setSettings(normalizeSettings(s))
          if (importedSubs && importedSubs.length) {
            setSubs(normalizeSubscriptions(importedSubs, { genId: createSubscriptionId, requireAmount: true }))
          }
          if (Array.isArray(importedDismissed)) setDismissed(importedDismissed)
        }}
      />
    )
  }

  const currency = settings.currency || 'USD'

  // No explicit kind → follow the page: the Reminders tab adds a reminder,
  // everywhere else adds a recurring subscription.
  const addKind = tab === 'reminders' ? 'reminder' : 'recurring'
  function openAddForm(kind) {
    setEditSub(null)
    setFormKind(kind === 'reminder' || kind === 'recurring' ? kind : addKind)
    setShowForm(true)
  }
  function closeForm() { setShowForm(false); setEditSub(null) }

  function handleAddSub(data) {
    if (editSub) {
      const previous = pinSubscriptionCurrency(editSub, currency)
      // Changing the date or the price in the form is how an imported,
      // unverified value gets confirmed.
      const dateField = isReminder(previous) ? 'endDate' : 'billingDate'
      const dateChanged = (data[dateField] || null) !== (previous[dateField] || null)
      const amountChanged = Number(data.amount) !== previous.amount || (data.currency || currency) !== previous.currency
      const updated = normalizeSubscription({
        ...previous,
        ...data,
        scheduleVerified: dateChanged ? true : previous.scheduleVerified,
        amountVerified: amountChanged ? true : previous.amountVerified,
        paymentHistory: previous.paymentHistory,
      }, { genId: createSubscriptionId })
      if (!updated) { toast.error('Subscription is invalid'); return }
      setSubs(prev => prev.map(s => s.id === editSub.id ? updated : s))
      setEditSub(null)
      setShowForm(false)
      playSuccess()
      toast.success('Subscription updated')
      return
    }
    const newSub = normalizeSubscription({ ...SUBSCRIPTION_DEFAULTS, ...data, id: createSubscriptionId() }, { genId: createSubscriptionId, requireAmount: true })
    if (!newSub) { toast.error('Subscription is invalid'); return }
    setSubs(prev => [...prev, newSub])
    playSuccess()
    toast.success(`Added ${data.name}`)
    setShowForm(false)
  }

  async function handleDeleteSub(id) {
    const sub = subs.find(s => s.id === id)
    if (!sub) return
    // Reminders have no cancel lifecycle — deleting one removes it outright
    // (with the same undo window the archive path gets).
    if (isReminder(sub)) {
      const ok = await toast.confirm(`Delete ${sub.name}?`, 'This removes the reminder. You can undo for a few seconds.', { okLabel: 'Delete' })
      if (!ok) return
      setSubs(prev => prev.filter(s => s.id !== id))
      setDetailSub(null)
      playDelete()
      toast.info(`Deleted ${sub.name}`, 7000, {
        actionLabel: 'Undo',
        action: () => {
          setSubs(prev => [...prev, sub])
          toast.success(`Restored ${sub.name}`)
        },
      })
      return
    }
    const isCanceled = Boolean(sub.canceledAt) || sub.status === 'canceled'
    const ok = await toast.confirm(
      isCanceled ? `Permanently delete ${sub.name}?` : `Archive ${sub.name} as canceled?`,
      isCanceled ? 'This removes its payment history and cannot be undone after the toast closes.' : 'Its payment history stays in your records. You can undo this action.',
      { okLabel: isCanceled ? 'Delete' : 'Archive' }
    )
    if (!ok) return
    if (isCanceled) {
      setSubs(prev => prev.filter(s => s.id !== id))
    } else {
      setSubs(prev => prev.map(s => s.id === id ? { ...s, status: 'canceled', canceledAt: formatDateOnly(new Date()), paused: false, isTrial: false } : s))
    }
    setDetailSub(null)
    playDelete()
    toast.info(isCanceled ? `Deleted ${sub.name}` : `Archived ${sub.name}`, 7000, {
      actionLabel: 'Undo',
      action: () => {
        setSubs(prev => isCanceled ? [...prev, sub] : prev.map(s => s.id === id ? sub : s))
        toast.success(`Restored ${sub.name}`)
      },
    })
  }

  function handleTogglePause(id) {
    const sub = subs.find(s => s.id === id)
    if (!sub || getSubscriptionStatus(sub) === 'canceled' || isReminder(sub)) return
    setSubs(prev => prev.map(s => s.id !== id ? s : { ...s, paused: !s.paused, status: s.paused ? (s.isTrial ? 'trial' : 'active') : 'paused' }))
    toast.info(sub.paused ? `Resumed ${sub.name}` : `Paused ${sub.name}`)
    playClick()
  }

  // A canceled record comes back as a live subscription with its payment
  // history intact. The schedule resumes at the next occurrence from today
  // rather than at the old anchor, which could be months in the past.
  function reactivateMany(ids) {
    const idSet = new Set(ids)
    const previous = subs.filter(s => idSet.has(s.id) && getSubscriptionStatus(s) === 'canceled' && !isReminder(s))
    if (!previous.length) return []
    const restoreIds = new Set(previous.map(s => s.id))
    setSubs(prev => prev.map(s => restoreIds.has(s.id) ? reactivateSubscription(s) : s))
    playSuccess()
    return previous
  }

  function handleReactivate(id) {
    const [previous] = reactivateMany([id])
    if (!previous) return
    const resumed = reactivateSubscription(previous)
    toast.success(`Reactivated ${previous.name} · next renewal ${formatDisplayDate(resumed.billingDate, SHORT_DATE)}`, 6000, {
      actionLabel: 'Undo',
      action: () => {
        setSubs(prev => prev.map(s => s.id === id ? previous : s))
        toast.info(`${previous.name} is canceled again`)
      },
    })
  }

  function handleBulkReactivate(ids) {
    const previous = reactivateMany(ids)
    if (!previous.length) return
    const byId = new Map(previous.map(item => [item.id, item]))
    toast.success(`Reactivated ${previous.length} ${plural(previous.length, 'subscription')}`, 6000, {
      actionLabel: 'Undo',
      action: () => {
        setSubs(prev => prev.map(item => byId.get(item.id) || item))
        toast.info(`${previous.length} ${plural(previous.length, 'subscription')} canceled again`)
      },
    })
  }

  async function handleMarkPaid(id) {
    const sub = subs.find(s => s.id === id)
    if (!sub) return
    const prevBillingDate = sub.billingDate

    // Paying an overdue renewal: some services restart the billing period
    // from the day you renew, others keep the original anchor. Let the user
    // pick; dismissing the dialog (Escape/backdrop) records nothing.
    const daysLate = getSubscriptionStatus(sub) === 'active' ? getDaysUntilBilling(sub) : null
    let restartFromToday = false
    if (daysLate != null && daysLate < 0) {
      // Several cycles may have gone by unrecorded. Say so, and say what each
      // choice does about it, so the user is not surprised when "keep the
      // schedule" leaves the next occurrence overdue as well.
      const missed = getMissedOccurrences(sub)
      const missedDates = missed.map(date => formatDisplayDate(date, SHORT_DATE)).join(', ')
      const description = missed.length > 1
        ? `${missed.length} renewals are unsettled (${missedDates}). "Keep original schedule" records the oldest one — mark paid again for each of the others. "Restart from today" records today's payment and counts the next renewal from now, which suits services that restart the billing period when you renew late.`
        : `This payment is ${Math.abs(daysLate)} ${plural(Math.abs(daysLate), 'day')} overdue. If ${sub.name} restarts the billing period when you renew late, count the next renewal from today. Otherwise keep the original schedule.`
      const choice = await toast.confirm('Restart the billing cycle from today?', description, { okLabel: 'Restart from today', cancelLabel: 'Keep original schedule', tone: 'primary' })
      if (choice === null) return
      restartFromToday = choice
    }

    const today = formatDateOnly(new Date())
    // No verified schedule → nothing to settle; the payment is still logged.
    const nextDue = restartFromToday ? null : getNextBillingDate(sub)
    const dueFor = restartFromToday ? today : nextDue ? formatDateOnly(nextDue) : null
    // recordSubscriptionPayment would silently no-op on a duplicate due date;
    // surface that instead of rebasing the anchor and claiming success.
    if (dueFor && (sub.paymentHistory || []).some(p => p.dueFor && formatDateOnly(p.dueFor) === dueFor)) {
      toast.info('Already recorded for this due date')
      return
    }
    // Re-anchoring the schedule on the payment date: the recorded payment
    // settles "today", so the next renewal lands one full cycle from now.
    const updated = restartFromToday
      ? { ...recordSubscriptionPayment(pinSubscriptionCurrency(sub, currency), { dueFor: today }), billingDate: today }
      : recordSubscriptionPayment(pinSubscriptionCurrency(sub, currency), dueFor ? { dueFor } : {})
    setSubs(prev => prev.map(s => (s.id === id ? updated : s)))
    playSuccess()
    const stillMissed = restartFromToday ? 0 : getMissedOccurrences(updated).length
    const summary = restartFromToday
      ? `Marked ${sub.name} paid — schedule restarted from today`
      : dueFor
        ? `Marked ${sub.name} paid for ${formatDisplayDate(dueFor, SHORT_DATE)}${stillMissed ? ` · ${stillMissed} more overdue` : ''}`
        : `Recorded a payment for ${sub.name} — its renewal date is still unverified`
    toast.success(summary, stillMissed ? 6000 : 4000, {
      actionLabel: 'Undo',
      action: () => {
        // Surgical revert: drop only the payment entry this action appended,
        // and touch billingDate only when the restart path changed it — so an
        // edit made while the toast was visible is not clobbered.
        setSubs(prev => prev.map(s => {
          if (s.id !== id) return s
          return { ...undoSubscriptionPayment(s, today, dueFor), ...(restartFromToday && s.billingDate === today ? { billingDate: prevBillingDate } : {}) }
        }))
        toast.info('Payment undone')
      },
    })
  }

  // `paused` and `status` both encode pause state (normalization writes the
  // string form), so they have to move together or a resumed subscription
  // keeps reading as paused.
  // Canceled records and reminders have no pause lifecycle; a bulk action
  // that reached them would leave `paused: true` on a record whose status
  // still reads canceled. Only live recurring records are touched.
  function pausable(s, idSet) {
    return idSet.has(s.id) && !isReminder(s) && getSubscriptionStatus(s) !== 'canceled'
  }

  function handleBulkPause(ids) {
    const idSet = new Set(ids)
    const targets = subs.filter(s => pausable(s, idSet) && !s.paused)
    if (!targets.length) { toast.info('Nothing to pause in this selection'); return }
    const targetIds = new Set(targets.map(s => s.id))
    setSubs(prev => prev.map(s => targetIds.has(s.id) ? { ...s, paused: true, status: 'paused' } : s))
    toast.success(`Paused ${targets.length} ${plural(targets.length, 'subscription')}`)
    playClick()
  }

  function handleBulkResume(ids) {
    const idSet = new Set(ids)
    const targets = subs.filter(s => pausable(s, idSet) && getSubscriptionStatus(s) === 'paused')
    if (!targets.length) { toast.info('Nothing to resume in this selection'); return }
    const targetIds = new Set(targets.map(s => s.id))
    setSubs(prev => prev.map(s => targetIds.has(s.id) ? { ...s, paused: false, status: s.isTrial ? 'trial' : 'active' } : s))
    toast.success(`Resumed ${targets.length} ${plural(targets.length, 'subscription')}`)
    playClick()
  }

  async function handleBulkDelete(ids) {
    const idSet = new Set(ids)
    const targets = subs.filter(s => idSet.has(s.id))
    if (!targets.length) return false
    const live = targets.filter(s => getSubscriptionStatus(s) !== 'canceled')

    // Everything selected is already canceled (the Canceled tab): the only
    // thing left to do with those records is remove them for good.
    if (!live.length) {
      const count = targets.length
      const ok = await toast.confirm(
        `Permanently delete ${count} canceled ${plural(count, 'record')}?`,
        'Their payment history goes with them. You can undo for a few seconds after the toast appears.',
        { okLabel: 'Delete' }
      )
      if (!ok) return false
      setSubs(prev => prev.filter(s => !idSet.has(s.id)))
      playDelete()
      toast.info(`Deleted ${count} ${plural(count, 'record')}`, 8000, {
        actionLabel: 'Undo',
        action: () => {
          setSubs(prev => {
            const present = new Set(prev.map(s => s.id))
            return [...prev, ...targets.filter(s => !present.has(s.id))]
          })
          toast.success(`Restored ${count}`)
        },
      })
      return true
    }

    const count = live.length
    const ok = await toast.confirm(`Archive ${count} ${plural(count, 'subscription')}?`, 'Their payment history will be kept. You\'ll have 8 seconds to undo.', { okLabel: 'Archive' })
    if (!ok) return false
    const liveIds = new Set(live.map(s => s.id))
    const canceledAt = formatDateOnly(new Date())
    setSubs(prev => prev.map(s => liveIds.has(s.id) ? { ...s, status: 'canceled', canceledAt, paused: false, isTrial: false } : s))
    playDelete()
    toast.info(`Archived ${count} ${plural(count, 'subscription')}`, 8000, {
      actionLabel: 'Undo',
      action: () => {
        const byId = new Map(live.map(item => [item.id, item]))
        setSubs(prev => prev.map(item => byId.get(item.id) || item))
        toast.success(`Restored ${count}`)
      },
    })
    return true
  }

  function handleEditSub(sub) { setEditSub(sub); setShowForm(true); setDetailSub(null) }

  // One click to say "the imported date/price is right" without retyping it.
  function handleVerify(id, field) {
    const key = field === 'amount' ? 'amountVerified' : 'scheduleVerified'
    setSubs(prev => prev.map(s => (s.id === id ? { ...s, [key]: true } : s)))
    toast.success(field === 'amount' ? 'Price confirmed' : 'Date confirmed')
  }

  function handleUpdateSettings(next) {
    if (next.currency !== currency) setSubs(prev => prev.map(s => pinSubscriptionCurrency(s, currency)))
    setSettings(normalizeSettings(next))
  }

  function handleImport(data, sourceCurrency) {
    const ids = new Set(subs.map(s => s.id))
    const fresh = normalizeSubscriptions(data, { genId: createSubscriptionId, requireAmount: true }).filter(s => !ids.has(s.id)).map(s => pinSubscriptionCurrency(s, sourceCurrency || currency))
    if (fresh.length) { setSubs(prev => [...prev, ...fresh]); playSuccess() }
    return fresh.length
  }

  async function handleClearAll() {
    // Detach the backup file first so the wipe doesn't overwrite it —
    // the file on disk stays intact as a last-resort restore point.
    if (backup.connected) {
      await backup.disconnect()
      toast.info('Backup file kept on disk and disconnected')
    }
    // Clear the server's data file too (it keeps a dated rescue copy in
    // backups/) — otherwise the next boot would restore from it and undo
    // the reset.
    if (!(await sync.reset())) {
      toast.error('Reset failed: the data server could not be reached. Your browser data was kept. Start SubTracker and try again.')
      return
    }
    await clearAllAppData()
    playDelete()
    window.location.reload()
  }

  async function handleRestore(payload) {
    let parsed
    try { parsed = parseBackupPayload(payload) } catch (error) { toast.error(error.message || 'Backup file is not recognized'); return }
    const report = normalizeSubscriptionsWithReport(parsed.subs, { genId: createSubscriptionId, mode: 'strict', requireAmount: true })
    const valid = report.items
    if (!valid.length && parsed.subs.length) { toast.error('Backup has no valid subscriptions'); return }
    const skipped = report.rejected.length
    const ok = await toast.confirm(
      `Restore ${valid.length} ${plural(valid.length, 'subscription')}?`,
      `This replaces your current data with the backup file contents.${skipped ? ` ${skipped} invalid ${plural(skipped, 'record')} will be skipped. The original backup file is unchanged.` : ''}`
    )
    if (!ok) return
    setSubs(valid)
    if (parsed.settings) setSettings(normalizeSettings(parsed.settings))
    if (Array.isArray(parsed.dismissed)) setDismissed(parsed.dismissed)
    playSuccess()
    toast.success(`Restored ${valid.length} ${plural(valid.length, 'subscription')} from backup`)
  }
  function toggleSound() { const next = !soundOn; setSoundOn(next); setEnabled(next); if (next) playClick() }

  const saveStatus = subsStatus === 'saving' || settingsStatus === 'saving' ? 'saving'
    : subsStatus === 'error' || settingsStatus === 'error' ? 'error'
    : subsStatus === 'quota' || settingsStatus === 'quota' ? 'quota'
    : subsStatus === 'degraded' || settingsStatus === 'degraded' ? 'degraded' : 'saved'

  const todayLabel = FULL_DATE_FORMATTER.format(new Date())
  const addLabel = addKind === 'reminder' ? 'Add reminder' : 'Add subscription'

  // The status line reports the strongest layer that is working: the disk
  // file when the local server is running, browser storage otherwise.
  const diskMode = sync.available
  const storageStatus = diskMode && ['offline', 'conflict'].includes(sync.status) ? 'degraded' : saveStatus
  const localSaveLabel = saveStatus === 'saving' || sync.status === 'saving' ? 'Saving changes…'
    : sync.status === 'conflict' ? 'File changed elsewhere — open Settings'
    : diskMode && sync.status === 'offline' ? 'Server unavailable — retrying'
    : saveStatus === 'quota' ? 'Local storage is full'
    : saveStatus === 'error' || saveStatus === 'degraded' ? 'Backup layer needs attention'
    : diskMode ? 'All changes saved to disk'
    : 'All changes saved in this browser'
  const statusTone = storageStatus === 'saved' || storageStatus === 'saving' ? '' : storageStatus === 'degraded' ? 'warn' : 'danger'

  function navItem(item, extraClass = '') {
    const Icon = item.icon
    const isActive = tab === item.id
    const count = item.id === 'list' ? recurringSubs.length : item.id === 'reminders' ? reminderSubs.length : 0
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => switchTab(item.id)}
        className={`nav-item ${isActive ? 'active' : ''} ${extraClass}`}
        aria-current={isActive ? 'page' : undefined}
      >
        <Icon aria-hidden="true" />
        <span>{item.label}</span>
        {count > 0 && <em>{count}</em>}
      </button>
    )
  }

  return (
    <div className="app" data-page={tab}>
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => switchTab('track')} aria-label="Go to Overview">
          <BrandMark />
          <span>sub<span className="brand-light">tracker</span></span>
        </button>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          {MAIN_TABS.map(item => navItem(item))}

          <p className="sidebar-heading" id="up-next-heading">Up next</p>
          <div className="sidebar-list" role="group" aria-labelledby="up-next-heading">
            {upNext.length ? upNext.map(({ sub, date, days }) => (
              <button key={sub.id} type="button" className="upnext-link" onClick={() => setDetailSub(sub)}>
                <i className={days < 0 ? 'overdue' : days <= 1 ? 'due' : ''} aria-hidden="true" />
                <span>{sub.name}</span>
                <small className={days < 0 ? 'overdue' : ''}>{shortWhen(days, date)}</small>
              </button>
            )) : <p>Renewals appear here once you add a subscription.</p>}
          </div>

          {navItem(SETTINGS_TAB, 'nav-bottom')}
        </nav>

        <div className="sidebar-status" data-status={storageStatus} role="status">
          <span className={`status-dot ${statusTone} ${storageStatus === 'saving' ? 'pulsing' : ''}`} aria-hidden="true" />
          <span title={localSaveLabel}>{localSaveLabel}</span>
          <button type="button" onClick={toggleSound} className="btn btn-icon" aria-label={soundOn ? 'Mute sounds' : 'Enable sounds'}>
            {soundOn ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          </button>
        </div>
      </aside>

      <div className="main" ref={mainRef}>
        {/* Desktop top bar */}
        <header className="topbar">
          <div className="crumbs">
            <time dateTime={formatDateOnly(new Date())}>{todayLabel}</time>
          </div>
          <button type="button" onClick={() => setCmdOpen(true)} className="search-box" aria-label="Search subscriptions">
            <Search aria-hidden="true" />
            <span>Search subscriptions</span>
            <kbd>{MOD_KEY} K</kbd>
          </button>
          <div className="topbar-actions">
            <button type="button" onClick={() => openAddForm()} className="btn btn-primary">
              <Plus aria-hidden="true" />
              <span>{addLabel}</span>
            </button>
          </div>
        </header>

        {/* Mobile header */}
        <header className="mobile-header">
          <button type="button" className="brand" onClick={() => switchTab('track')} aria-label="Go to Overview">
            <BrandMark />
            <span>sub<span className="brand-light">tracker</span></span>
          </button>
          <div className="mobile-header-actions">
            <button type="button" onClick={() => setCmdOpen(true)} className="btn btn-icon" aria-label="Search subscriptions">
              <Search aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => switchTab('reminders')}
              className={`btn btn-icon ${tab === 'reminders' ? 'active' : ''}`}
              aria-label="Open Reminders"
              aria-current={tab === 'reminders' ? 'page' : undefined}
            >
              <BellRing aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => switchTab('settings')}
              className={`btn btn-icon ${tab === 'settings' ? 'active' : ''}`}
              aria-label="Open Settings"
              aria-current={tab === 'settings' ? 'page' : undefined}
            >
              <Settings aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Keyed on the page so each one fades in, and on the calendar day:
            when the date rolls over, every memoised model (dashboard, list,
            calendar, insights) is rebuilt against the new "today" instead of
            showing yesterday's numbers. */}
        <main id="main-content" className="page-content" key={`${tab}-${today}`}>
          {['conflict', 'offline'].includes(sync.status) && (
            <div role="status" className="notice">
              <span>{sync.status === 'conflict' ? 'Another browser changed the data file. Your changes are kept in this browser.' : 'The data server is unavailable. Changes stay in this browser while SubTracker retries.'}</span>
              <button type="button" className="btn btn-sm" onClick={() => switchTab('settings')}>Review saving</button>
            </div>
          )}

          <Suspense fallback={<PanelLoading />}>
            {tab === 'track' && (
              <Dashboard
                subs={subs}
                settings={settings}
                onAddClick={() => openAddForm('recurring')}
                onMarkPaid={handleMarkPaid}
                onViewDetail={setDetailSub}
                onOpenCalendar={() => switchTab('calendar')}
                onOpenSubscriptions={() => switchTab('list')}
                onOpenReminders={() => switchTab('reminders')}
                onOpenSettings={() => switchTab('settings')}
                today={today}
              />
            )}
            {tab === 'list' && (
              <SubscriptionList subs={recurringSubs} currency={currency} toBase={toBase} activeId={detailSub?.id || null} onAdd={() => openAddForm('recurring')} onEdit={handleEditSub} onDelete={handleDeleteSub} onTogglePause={handleTogglePause} onMarkPaid={handleMarkPaid} onReactivate={handleReactivate} onViewDetail={setDetailSub} onBulkPause={handleBulkPause} onBulkResume={handleBulkResume} onBulkDelete={handleBulkDelete} onBulkReactivate={handleBulkReactivate} />
            )}
            {tab === 'reminders' && (
              <RemindersPanel reminders={reminderSubs} currency={currency} toBase={toBase} onAdd={() => openAddForm('reminder')} onEdit={handleEditSub} onDelete={handleDeleteSub} onViewDetail={setDetailSub} />
            )}
            {tab === 'charts' && <AnalyticsPanel subs={subs} settings={settings} onViewDetail={setDetailSub} />}
            {tab === 'calendar' && <CalendarView subs={subs} currency={currency} toBase={toBase} onViewDetail={setDetailSub} />}
            {tab === 'settings' && (
              <SettingsPanel settings={settings} onUpdateSettings={handleUpdateSettings} subs={subs} dismissed={dismissed} onImport={handleImport} onClearAll={handleClearAll} backup={backup} onRestore={handleRestore} sync={sync} soundOn={soundOn} onToggleSound={toggleSound} />
            )}
          </Suspense>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <div className="mobile-nav-inner">
          {MOBILE_NAV.map(item => {
            const Icon = item.icon
            if (item.action === 'add') {
              return (
                <button key={item.id} type="button" onClick={() => openAddForm()} className="mobile-add" aria-label={addLabel}>
                  <span><Icon aria-hidden="true" /></span>
                </button>
              )
            }

            const isActive = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => switchTab(item.id)}
                className={`mobile-nav-item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* ── Add / edit form ── */}
      <Presence show={showForm}>
        <FormModal
          title={editSub
            ? (isReminder(editSub) ? 'Edit reminder' : 'Edit subscription')
            : (formKind === 'reminder' ? 'New reminder' : 'New subscription')}
          onClose={closeForm}
        >
          <SubscriptionForm onAdd={handleAddSub} currency={currency} editData={editSub} initialKind={formKind} onCancelEdit={closeForm} />
        </FormModal>
      </Presence>

      {/* ── Other overlays ── */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} subs={subs} currency={currency} onSwitchTab={switchTab} onViewDetail={setDetailSub} onAdd={openAddForm} />
      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <Presence show={Boolean(detailSub)} exitMs={200}>
        {detailSub && <SubscriptionDetail sub={subs.find(s => s.id === detailSub.id) || detailSub} currency={currency} toBase={toBase} onClose={() => setDetailSub(null)} onEdit={handleEditSub} onDelete={handleDeleteSub} onTogglePause={handleTogglePause} onMarkPaid={handleMarkPaid} onReactivate={handleReactivate} onVerify={handleVerify} />}
      </Presence>
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  )
}

function FormModal({ title, onClose, children }) {
  const panelRef = useRef(null)
  // Inside <Presence>: while the dialog fades out, its full-screen backdrop
  // must not swallow the click that follows, and it is hidden from assistive
  // tech so a closing dialog is never announced alongside the one replacing
  // it (detail panel → edit form). `leaving()` sets both.
  const isPresent = useIsPresent()
  useModal(panelRef, { active: isPresent, onClose })
  return (
    <div
      className="modal-backdrop sheet z-[70]"
      {...leaving(isPresent)}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-form-title"
        className="modal"
      >
        <div className="modal-head">
          <h2 id="subscription-form-title">{title}</h2>
          <button type="button" onClick={onClose} className="btn btn-icon" aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="welcome" role="status">
      <div className="flex items-center gap-3 text-muted">
        <BrandMark width={24} height={24} />
        <span>Loading SubTracker…</span>
      </div>
    </div>
  )
}

function PanelLoading() {
  return (
    <div className="empty compact" role="status">
      <p>Loading this view…</p>
    </div>
  )
}
