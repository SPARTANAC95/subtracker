import { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { motion, AnimatePresence, useIsPresent } from 'framer-motion'
import {
  LayoutDashboard, List, BellRing, BarChart3, CalendarDays, Settings,
  Volume2, VolumeX, Gem, Search, Plus, X
} from 'lucide-react'
import useLocalStorage from './hooks/useLocalStorage'
import useAutoBackup from './hooks/useAutoBackup'
import useServerSync from './hooks/useServerSync'
import useDayTick from './hooks/useDayTick'
import useModal from './hooks/useModal'
import { clearAllAppData, ensurePersistentStorage, parseBackupPayload } from './utils/persistence'
import { playClick, playSuccess, playDelete, isEnabled, setEnabled } from './utils/sounds'
import { formatMoney, makeSubConverter, pinSubscriptionCurrency } from './utils/currencies'
import {
  getDaysUntilBilling, getEffectiveMonthlyCost, getMissedOccurrences, getNextBillingDate,
  isActiveSub, reactivateSubscription, recordSubscriptionPayment,
  undoSubscriptionPayment,
} from './utils/stats'
import { tabSlide } from './utils/motion'
import { checkUpcomingBills } from './utils/notifications'
import { formatDateOnly, formatDisplayDate } from './utils/dates'
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
import SaveIndicator from './components/SaveIndicator'
import SetupWizard from './components/SetupWizard'
import CommandPalette from './components/CommandPalette'
import ShortcutsHelp from './components/ShortcutsHelp'
import SubscriptionDetail from './components/SubscriptionDetail'
import Dashboard from './components/Dashboard'
import SubscriptionForm from './components/SubscriptionForm'
import SubscriptionList from './components/SubscriptionList'
const AnalyticsPanel = lazy(() => import('./components/AnalyticsPanel'))
const CalendarView = lazy(() => import('./components/CalendarView'))
const RemindersPanel = lazy(() => import('./components/RemindersPanel'))
const SettingsPanel = lazy(() => import('./components/SettingsPanel'))

const TABS = [
  { id: 'track', label: 'Overview', icon: LayoutDashboard, num: '01' },
  { id: 'list', label: 'Subscriptions', icon: List, num: '02' },
  { id: 'reminders', label: 'Reminders', icon: BellRing, num: '03' },
  { id: 'charts', label: 'Insights', icon: BarChart3, num: '04' },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays, num: '05' },
  { id: 'settings', label: 'Settings', icon: Settings, num: '06' },
]

// Five slots only — Reminders and Settings stay reachable through the header
// icons and the command palette on mobile.
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
  year: 'numeric',
})

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
  const prevTabRef = useRef('track')
  const direction = useRef(1)
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


  const tabIndex = TABS.findIndex(t => t.id === tab)
  const prevIndex = TABS.findIndex(t => t.id === prevTabRef.current)
  direction.current = tabIndex >= prevIndex ? 1 : -1

  const switchTab = useCallback((newTab) => {
    prevTabRef.current = tab
    setTab(newTab)
    playClick()
  }, [tab])

  useEffect(() => {
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
        // Land in the search box once the tab transition settles.
        window.setTimeout(() => document.getElementById('subscription-search')?.focus(), 380)
        return
      }
      if (key >= '1' && key <= '6') { switchTab(TABS[parseInt(key, 10) - 1]?.id || 'track'); return }
      if (key === 'Escape') { setEditSub(null); setDetailSub(null); setCmdOpen(false); setShowForm(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cmdOpen, switchTab, showForm, shortcutsOpen, detailSub, tab])

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
  const monthlyTotal = subs.filter(isActiveSub).reduce((a, s) => a + toBase(getEffectiveMonthlyCost(s), s), 0)
  // Recurring records and one-time reminders share the store but live in
  // separate tabs — split once here so counts and lists stay consistent.
  const recurringSubs = subs.filter(s => !isReminder(s))
  const reminderSubs = subs.filter(isReminder)

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
      const updated = normalizeSubscription({ ...previous, ...data, paymentHistory: previous.paymentHistory }, { genId: createSubscriptionId })
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
    const daysLate = getSubscriptionStatus(sub) === 'active' ? getDaysUntilBilling(sub) : 0
    let restartFromToday = false
    if (daysLate < 0) {
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
    const dueFor = restartFromToday ? today : formatDateOnly(getNextBillingDate(sub))
    // recordSubscriptionPayment would silently no-op on a duplicate due date;
    // surface that instead of rebasing the anchor and claiming success.
    if ((sub.paymentHistory || []).some(p => p.dueFor && formatDateOnly(p.dueFor) === dueFor)) {
      toast.info('Already recorded for this due date')
      return
    }
    // Re-anchoring the schedule on the payment date: the recorded payment
    // settles "today", so the next renewal lands one full cycle from now.
    const updated = restartFromToday
      ? { ...recordSubscriptionPayment(pinSubscriptionCurrency(sub, currency), { dueFor: today }), billingDate: today }
      : recordSubscriptionPayment(pinSubscriptionCurrency(sub, currency))
    setSubs(prev => prev.map(s => (s.id === id ? updated : s)))
    playSuccess()
    const stillMissed = restartFromToday ? 0 : getMissedOccurrences(updated).length
    const summary = restartFromToday
      ? `Marked ${sub.name} paid — schedule restarted from today`
      : `Marked ${sub.name} paid for ${formatDisplayDate(dueFor, SHORT_DATE)}${stillMissed ? ` · ${stillMissed} more overdue` : ''}`
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
    const ok = await toast.confirm(
      `Restore ${valid.length} subscriptions?`,
      `This replaces your current data with the backup file contents.${report.rejected.length ? ` ${report.rejected.length} invalid records will be skipped. The original backup file is unchanged.` : ''}`
    )
    if (!ok) return
    setSubs(valid)
    if (parsed.settings) setSettings(normalizeSettings(parsed.settings))
    if (Array.isArray(parsed.dismissed)) setDismissed(parsed.dismissed)
    playSuccess()
    toast.success(`Restored ${valid.length} subscriptions from backup`)
  }
  function toggleSound() { const next = !soundOn; setSoundOn(next); setEnabled(next); if (next) playClick() }

  const saveStatus = subsStatus === 'saving' || settingsStatus === 'saving' ? 'saving'
    : subsStatus === 'error' || settingsStatus === 'error' ? 'error'
    : subsStatus === 'quota' || settingsStatus === 'quota' ? 'quota'
    : subsStatus === 'degraded' || settingsStatus === 'degraded' ? 'degraded' : 'saved'

  const activeTab = TABS.find(item => item.id === tab) || TABS[0]
  const todayLabel = FULL_DATE_FORMATTER.format(new Date())
  const addLabel = addKind === 'reminder' ? 'Add reminder' : 'Add subscription'

  // The storage card reports the strongest layer that is working: the disk
  // file when the local server is running, browser storage otherwise.
  const diskMode = sync.available
  // Short on purpose: the rail card is narrow and this line is uppercase
  // letterspaced — "Saved on this computer" wrapped onto three lines.
  const storageTitle = diskMode ? 'Saved on this PC' : 'In this browser'
  const storageStatus = diskMode && ['offline', 'conflict'].includes(sync.status) ? 'degraded' : saveStatus
  const localSaveLabel = saveStatus === 'saving' || sync.status === 'saving' ? 'Saving changes...'
    : sync.status === 'conflict' ? 'Another browser changed the file — open Settings'
    : diskMode && sync.status === 'offline' ? 'Server unavailable — retrying automatically'
    : saveStatus === 'quota' ? 'Local storage is full'
    : saveStatus === 'error' || saveStatus === 'degraded' ? 'Backup layer needs attention'
    : diskMode ? 'Everything is saved to your data file'
    : 'All changes saved on this device'

  return (
    <>
      {/* Desktop navigation rail */}
      <aside className="app-sidebar hidden lg:flex">
        <button type="button" className="app-brand" onClick={() => switchTab('track')} aria-label="Go to Overview">
          <span className="app-brand-mark"><Gem aria-hidden="true" /></span>
          <span className="app-brand-name">SubTracker<sup>PRO</sup></span>
        </button>

        <nav className="app-sidebar-nav" aria-label="Primary navigation">
          {TABS.map(item => {
            const isActive = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => switchTab(item.id)}
                className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="sidebar-nav-num" aria-hidden="true">{item.num}</span>
                <span>{item.label}</span>
                {item.id === 'list' && recurringSubs.length > 0 && (
                  <span className="font-figure ml-auto text-[10.5px] text-[rgba(242,240,234,0.35)]">{recurringSubs.length}</span>
                )}
                {item.id === 'reminders' && reminderSubs.length > 0 && (
                  <span className="font-figure ml-auto text-[10.5px] text-[rgba(242,240,234,0.35)]">{reminderSubs.length}</span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="app-sidebar-footer">
          <button type="button" onClick={() => openAddForm()} className="app-primary-button app-sidebar-add">
            <Plus aria-hidden="true" />
            <span>{addLabel}</span>
          </button>

          <div className="app-local-card" data-status={storageStatus} aria-live="polite">
            <div className="app-local-card-head">
              <span className="app-local-dot" aria-hidden="true" />
              <div>
                <p>{storageTitle}</p>
                <span>{localSaveLabel}</span>
              </div>
              <SaveIndicator status={storageStatus} />
            </div>
            <div className="app-local-card-meta">
              <div>
                <span>Monthly commitment</span>
                <strong>{formatMoney(monthlyTotal, currency)}</strong>
              </div>
              <button type="button" onClick={toggleSound} className="app-icon-button" aria-label={soundOn ? 'Mute sounds' : 'Enable sounds'}>
                {soundOn ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="app-shell" data-page={tab}>
        {/* Desktop global header */}
        <header className="app-desktop-header hidden lg:flex">
          <div className="app-desktop-header-inner">
            <h1>{activeTab.label}</h1>
            <div className="app-header-actions">
              <time dateTime={formatDateOnly(new Date())} className="max-[1100px]:hidden">{todayLabel}</time>
              <button type="button" onClick={() => setCmdOpen(true)} className="app-search-button" aria-label="Search subscriptions">
                <Search aria-hidden="true" />
                <span>Search…</span>
                <kbd>{MOD_KEY} K</kbd>
              </button>
              <button type="button" onClick={() => openAddForm()} className="app-primary-button">
                <Plus aria-hidden="true" />
                <span>{addLabel}</span>
              </button>
            </div>
          </div>
        </header>

        {/* Mobile global header */}
        <header className="app-mobile-header lg:hidden">
          <button type="button" className="app-brand" onClick={() => switchTab('track')} aria-label="Go to Overview">
            <span className="app-brand-mark"><Gem aria-hidden="true" /></span>
            <span className="app-brand-name">SubTracker<sup>PRO</sup></span>
          </button>
          <div className="app-mobile-header-actions">
            <button type="button" onClick={() => setCmdOpen(true)} className="app-icon-button" aria-label="Search subscriptions">
              <Search aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => switchTab('settings')}
              className={`app-icon-button ${tab === 'settings' ? 'active' : ''}`}
              aria-label="Open Settings"
              aria-current={tab === 'settings' ? 'page' : undefined}
            >
              <Settings aria-hidden="true" />
            </button>
          </div>
        </header>

        <main id="main-content" className="app-content">
          {['conflict', 'offline'].includes(sync.status) && (
            <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d9c28b]/30 bg-[#d9c28b]/10 px-4 py-3 text-xs leading-5 text-[#d9c28b]">
              <span>{sync.status === 'conflict' ? 'Another browser changed the data file. Your changes are kept in this browser.' : 'The data server is unavailable. Changes stay in this browser while SubTracker retries.'}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => switchTab('settings')}>Review saving</button>
            </div>
          )}
          <div className="app-mobile-page-heading lg:hidden">
            <h1>{activeTab.label}</h1>
            <time dateTime={formatDateOnly(new Date())}>{todayLabel}</time>
          </div>

          {/* Keyed on the calendar day: when the date rolls over, every
              memoised model (dashboard, list, calendar, insights) is rebuilt
              against the new "today" instead of showing yesterday's numbers. */}
          <Suspense fallback={<PanelLoading />} key={today}>
          <AnimatePresence mode="wait">
            {tab === 'track' && (
              <motion.div key="track" {...tabSlide(direction.current)}>
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
              </motion.div>
            )}
            {tab === 'list' && (
              <motion.div key="list" {...tabSlide(direction.current)}>
                <SubscriptionList subs={recurringSubs} currency={currency} toBase={toBase} onAdd={() => openAddForm('recurring')} onEdit={handleEditSub} onDelete={handleDeleteSub} onTogglePause={handleTogglePause} onMarkPaid={handleMarkPaid} onReactivate={handleReactivate} onViewDetail={setDetailSub} onBulkPause={handleBulkPause} onBulkResume={handleBulkResume} onBulkDelete={handleBulkDelete} onBulkReactivate={handleBulkReactivate} />
              </motion.div>
            )}
            {tab === 'reminders' && (
              <motion.div key="reminders" {...tabSlide(direction.current)}>
                <RemindersPanel reminders={reminderSubs} currency={currency} toBase={toBase} onAdd={() => openAddForm('reminder')} onEdit={handleEditSub} onDelete={handleDeleteSub} onViewDetail={setDetailSub} />
              </motion.div>
            )}
            {tab === 'charts' && (
              <motion.div key="charts" {...tabSlide(direction.current)}>
                <AnalyticsPanel key={today} subs={subs} settings={settings} />
              </motion.div>
            )}
            {tab === 'calendar' && (
              <motion.div key="calendar" {...tabSlide(direction.current)}>
                <CalendarView key={today} subs={subs} currency={currency} toBase={toBase} />
              </motion.div>
            )}
            {tab === 'settings' && (
              <motion.div key="settings" {...tabSlide(direction.current)}>
                <SettingsPanel settings={settings} onUpdateSettings={handleUpdateSettings} subs={subs} dismissed={dismissed} onImport={handleImport} onClearAll={handleClearAll} backup={backup} onRestore={handleRestore} sync={sync} />
              </motion.div>
            )}
          </AnimatePresence>
          </Suspense>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="app-mobile-nav lg:hidden" aria-label="Mobile navigation">
        <div className="app-mobile-nav-inner">
          {MOBILE_NAV.map(item => {
            const Icon = item.icon
            if (item.action === 'add') {
              return (
                <button key={item.id} type="button" onClick={() => openAddForm()} className="app-mobile-add" aria-label={addLabel}>
                  <span><Icon aria-hidden="true" /></span>
                  <strong>{item.label}</strong>
                </button>
              )
            }

            const isActive = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => switchTab(item.id)}
                className={`app-mobile-nav-item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* ── Form Slide-over ── */}
      <AnimatePresence>
        {showForm && (
          <FormSlideOver
            key="form"
            title={editSub
              ? (isReminder(editSub) ? 'Edit reminder' : 'Edit subscription')
              : (formKind === 'reminder' ? 'New reminder' : 'New subscription')}
            onClose={closeForm}
          >
            <SubscriptionForm onAdd={handleAddSub} currency={currency} editData={editSub} initialKind={formKind} onCancelEdit={closeForm} />
          </FormSlideOver>
        )}
      </AnimatePresence>

      {/* ── Other Overlays ── */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} subs={subs} currency={currency} onSwitchTab={switchTab} onViewDetail={setDetailSub} onAdd={() => openAddForm()} />
      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <AnimatePresence>
        {detailSub && <SubscriptionDetail sub={subs.find(s => s.id === detailSub.id) || detailSub} currency={currency} toBase={toBase} onClose={() => setDetailSub(null)} onEdit={handleEditSub} onDelete={handleDeleteSub} onTogglePause={handleTogglePause} onMarkPaid={handleMarkPaid} onReactivate={handleReactivate} />}
      </AnimatePresence>
    </>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  )
}

function FormSlideOver({ title, onClose, children }) {
  const panelRef = useRef(null)
  // Direct child of AnimatePresence: while the panel slides out, its
  // full-screen backdrop must not swallow the click that follows.
  const isPresent = useIsPresent()
  useModal(panelRef, { active: isPresent, onClose })
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/65"
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ x: '110%' }}
        animate={{ x: 0 }}
        exit={{ x: '110%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 350 }}
        onClick={e => e.stopPropagation()}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-form-title"
        className="app-panel w-[calc(100%-24px)] max-w-[432px] overflow-y-auto"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[rgba(242,240,234,0.07)] bg-[rgba(19,18,16,0.94)] px-[22px] pb-3.5 pt-[18px] backdrop-blur-md">
          <h2 id="subscription-form-title" className="text-[17px] font-semibold text-(--app-text)">{title}</h2>
          <button onClick={onClose} className="btn btn-secondary btn-icon" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#060605]">
      <div className="flex items-center gap-3 text-sm text-(--app-muted)">
        <Gem className="w-5 h-5 text-[#e1ad66]" />
        <span>Loading SubTracker...</span>
      </div>
    </div>
  )
}

function PanelLoading() {
  return (
    <div className="glass flex min-h-56 items-center justify-center" role="status">
      <div className="flex items-center gap-3 text-sm text-(--app-muted)">
        <Gem className="h-4 w-4 text-[#e1ad66]" /> Loading this view...
      </div>
    </div>
  )
}
