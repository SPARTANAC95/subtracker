import { useState, useRef, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { CURRENCIES, getDefaultRate } from '../utils/currencies'
import { openDataFolder } from '../utils/syncServer'
import { useToast } from './toast-context'
import { isNotificationSupported, getPermission, requestPermission } from '../utils/notifications'
import { isStoragePersisted, ensurePersistentStorage, parseBackupText } from '../utils/persistence'
import { formatDateOnly, formatDisplayDate } from '../utils/dates'
import { getSubscriptionStatus, normalizeSubscriptionsWithReport } from '../utils/subscriptions'
import { getCategoryById } from '../utils/categories'
import { MAX_REMINDER_DAYS, MIN_REMINDER_DAYS, clampReminderDays } from '../utils/settings'
import { MOD_KEY, STATUS_STYLES, paymentLabel } from '../utils/labels'
import { csvCell } from '../utils/input'

export default function SettingsPanel({ settings, onUpdateSettings, subs, dismissed, onImport, onClearAll, backup, onRestore, sync }) {
  const [flashSave, setFlashSave] = useState(false)
  const [permission, setPermission] = useState(getPermission())
  const [persisted, setPersisted] = useState(null)
  const fileRef = useRef(null)
  const importModeRef = useRef('merge')
  const flashTimerRef = useRef(null)
  const toast = useToast()
  const notifSupported = isNotificationSupported()

  useEffect(() => {
    let cancelled = false
    isStoragePersisted().then(v => { if (!cancelled) setPersisted(v) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => window.clearTimeout(flashTimerRef.current), [])

  function update(field, value) {
    onUpdateSettings({ ...settings, [field]: value })
    setFlashSave(true)
    window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setFlashSave(false), 1500)
  }

  const baseCurrency = settings.currency || 'USD'
  // Currencies actually used by subscriptions other than the base — these are
  // the only exchange rates that matter for this library.
  const foreignCurrencies = useMemo(
    () => [...new Set(subs.map(s => s.currency).filter(code => code && code !== baseCurrency))].sort(),
    [subs, baseCurrency]
  )

  function handleBaseCurrencyChange(code) {
    if (code === baseCurrency) return
    // Stored overrides are expressed in the old base currency — they would be
    // silently wrong under the new one, so they reset to the built-in table.
    onUpdateSettings({ ...settings, currency: code, rates: {} })
    if (Object.keys(settings.rates || {}).length) toast.info(`Exchange rates reset to defaults for ${code}`)
    setFlashSave(true)
    window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setFlashSave(false), 1500)
  }

  function updateRate(code, raw) {
    const next = { ...(settings.rates || {}) }
    const parsed = parseFloat(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) delete next[code]
    else next[code] = parsed
    update('rates', next)
  }

  async function handleNotifToggle(next) {
    if (!notifSupported) { toast.error('Notifications not supported in this browser'); return }
    if (next) {
      const result = await requestPermission()
      setPermission(result)
      if (result === 'granted') {
        update('notifications', true)
        toast.success('Notifications enabled')
      } else if (result === 'denied') {
        toast.error('Permission denied. Enable notifications in browser settings.')
      } else {
        toast.info('Notifications not enabled')
      }
    } else {
      update('notifications', false)
      toast.info('Notifications disabled')
    }
  }

  function handleExport(fmt) {
    if (fmt === 'json') {
      const now = new Date().toISOString()
      const payload = { app: 'subtracker-pro', version: 2, exportedAt: now, settings: { ...settings, lastBackupAt: now }, subs, dismissed: dismissed || [] }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      dl(blob, `subtracker-${dateStr()}.json`)
      onUpdateSettings({ ...settings, lastBackupAt: now })
      toast.success('Exported JSON backup')
    } else if (fmt === 'csv') {
      const esc = csvCell
      const hdr = ['Name','Amount','Currency','Kind','Cycle','Category','Billing Date','End Date','Last Paid','Status','Payment Method','Shared %','Payments Count','Notes','Tags','URL']
      const rows = subs.map(s => [
        esc(s.name), s.amount, s.currency || settings.currency || 'USD', s.kind || 'recurring', s.cycle, esc(getCategoryById(s.category).label), s.billingDate, s.endDate || '', s.lastPaid || '',
        STATUS_STYLES[getSubscriptionStatus(s)]?.label || 'Active', esc(paymentLabel(s.payment)),
        s.isShared ? s.sharedPct : 100, (s.paymentHistory || []).length,
        esc(s.notes || ''), esc((s.tags || []).join('|')), esc(s.url || '')
      ].join(','))
      const blob = new Blob([[hdr.join(','), ...rows].join('\n')], { type: 'text/csv' })
      dl(blob, `subtracker-${dateStr()}.csv`); toast.success('Exported CSV')
    } else if (fmt === 'payments') {
      const esc = csvCell
      const hdr = ['Paid On','Due For','Subscription','Category','Amount','Currency']
      const rows = []
      subs.forEach(s => {
        (s.paymentHistory || []).forEach(p => {
          rows.push([p.paidAt || p.date, p.dueFor || '', esc(s.name), esc(getCategoryById(s.category).label), p.amount, p.currency || s.currency || settings.currency || 'USD'].join(','))
        })
      })
      rows.sort()
      if (!rows.length) { toast.info('No payments recorded yet'); return }
      const blob = new Blob([[hdr.join(','), ...rows].join('\n')], { type: 'text/csv' })
      dl(blob, `subtracker-payments-${dateStr()}.csv`); toast.success('Exported payments')
    }
  }
  function dl(blob, name) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u) }
  function dateStr() { return formatDateOnly(new Date()) }

  function handleImport(e) {
    const f = e.target.files[0]; if (!f) return
    const r = new FileReader()
    r.onload = async ev => {
      try {
        const parsed = parseBackupText(ev.target.result)
        if (importModeRef.current === 'restore') {
          await onRestore(parsed)
          return
        }
        const report = normalizeSubscriptionsWithReport(parsed.subs, { requireAmount: true, mode: 'strict' })
        const valid = report.items
        if (!valid.length) { toast.error('No valid subscriptions in file'); return }
        const imported = onImport(valid, parsed.settings?.currency)
        if (imported === 0) toast.info('No new subscriptions to import')
        else toast.success(`Imported ${imported ?? valid.length}; skipped ${report.rejected.length}`)
      } catch (error) {
        toast.error(error.message || 'Invalid backup file')
      }
    }
    r.onerror = () => toast.error('Could not read this file. Try choosing it again.')
    r.readAsText(f); e.target.value = ''
  }

  async function handleClear() {
    if (await toast.confirm('Factory reset SubTracker?', 'Subscriptions, payment history, settings, and browser storage will be removed. A dated rescue copy stays in data\\backups\\.', { okLabel: 'Reset' })) {
      await onClearAll()
    }
  }

  async function handleConnectBackup() {
    try {
      await backup.connect()
      toast.success('Auto-backup connected — file stays in sync automatically')
    } catch (e) {
      if (e?.name !== 'AbortError') toast.error('Could not connect backup file')
    }
  }

  async function handleReauthorize() {
    const ok = await backup.reauthorize()
    if (ok) toast.success('Backup re-authorized and written')
    else toast.error('Permission not granted')
  }

  async function handleRestoreFromFile() {
    try {
      const payload = await backup.restore()
      await onRestore(payload)
    } catch {
      toast.error('Could not read backup file')
    }
  }

  async function handleDisconnectBackup() {
    await backup.disconnect()
    toast.info('Auto-backup disconnected — the file stays on disk')
  }

  async function handlePersistRequest() {
    const granted = await ensurePersistentStorage()
    setPersisted(granted)
    if (granted) toast.success('Storage marked as persistent')
    else toast.info('Browser declined — install as app or bookmark to increase trust')
  }

  const syncStatusLabel = sync?.available
    ? (sync.status === 'saving' ? 'Saving…'
      : sync.status === 'offline' ? 'Server unavailable — retrying automatically'
      : sync.info.lastSavedAt ? `Last saved ${new Date(sync.info.lastSavedAt).toLocaleString()}` : 'Up to date')
    : null

  return (
    <div className="grid-half max-w-[1040px]">
      {/* Preferences */}
      <Card>
        <CardTitle>Preferences {flashSave && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ml-2 inline-flex items-center gap-1 text-[10px] font-normal text-[#9ec8a0]"><Check className="h-3 w-3" />Saved</motion.span>}</CardTitle>
        <Row title="Currency" desc="Display currency — every total converts into it">
          <select value={baseCurrency} onChange={e => handleBaseCurrencyChange(e.target.value)} className="input-base min-h-[38px] w-[110px] py-1.5 text-xs" aria-label="Currency">
            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
          </select>
        </Row>
        <Row title="Monthly budget" desc="Spending limit — leave empty to disable it">
          <NumberField
            value={settings.budget || 0}
            onCommit={value => update('budget', Math.max(0, value))}
            min={0}
            step="1"
            emptyValue={0}
            placeholder="0"
            className="w-[90px]"
            ariaLabel="Monthly budget"
          />
        </Row>
        {/* Clamped to the same 1-30 range the settings normalizer enforces —
            the input used to advertise a 14-day maximum it did not apply. */}
        <Row title="Reminder days" desc={`Days before billing (${MIN_REMINDER_DAYS}–${MAX_REMINDER_DAYS})`}>
          <NumberField
            value={clampReminderDays(settings.reminderDays)}
            onCommit={value => update('reminderDays', clampReminderDays(value))}
            min={MIN_REMINDER_DAYS}
            max={MAX_REMINDER_DAYS}
            step="1"
            integer
            className="w-[70px]"
            ariaLabel="Reminder days"
          />
        </Row>
        <Row
          title="Notifications"
          desc={notifSupported
            ? (permission === 'denied' ? 'Blocked — enable in browser settings' : 'Browser reminders for upcoming bills')
            : 'Not supported here'}
        >
          <Toggle
            checked={settings.notifications === true && permission === 'granted'}
            onChange={handleNotifToggle}
            label="Notifications toggle"
            disabled={!notifSupported || permission === 'denied'}
          />
        </Row>
      </Card>

      {/* Exchange rates for subscriptions billed in another currency */}
      <Card>
        <CardTitle>Exchange rates</CardTitle>
        {foreignCurrencies.length ? (
          <>
            {foreignCurrencies.map(code => (
              <RateRow
                key={`${code}-${baseCurrency}`}
                code={code}
                base={baseCurrency}
                stored={settings.rates?.[code]}
                onCommit={value => updateRate(code, value)}
              />
            ))}
            <Row title="About these rates" desc={`Totals convert into ${baseCurrency} with these rates. Built-in defaults are offline approximations — adjust them to match your bank's rate.`}>
              {Object.keys(settings.rates || {}).length > 0 && (
                <button onClick={() => update('rates', {})} className="btn btn-secondary btn-sm">Use defaults</button>
              )}
            </Row>
          </>
        ) : (
          <Row title="No foreign currencies yet" desc={`Every subscription is in ${baseCurrency}. Pick a different currency on a subscription (Edit → Currency) and its rate appears here.`} />
        )}
      </Card>

      {/* Where your data lives — the local data server's disk file */}
      <Card>
        <CardTitle>Your data on this PC</CardTitle>
        {sync?.status === 'conflict' && (
          <div role="alert" className="my-3 rounded-xl border border-[#d9c28b]/30 bg-[#d9c28b]/10 p-3 text-xs leading-5 text-[#d9c28b]">
            <p className="font-semibold">This data file changed in another browser.</p>
            <p>Your changes are still in this tab. Back them up before loading the latest disk copy.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => handleExport('json')} className="btn btn-secondary btn-sm">Back up this tab</button>
              <button onClick={async () => {
                if (await toast.confirm('Load the latest disk copy?', 'This replaces the records and settings in this tab. Export a backup first if you need to keep your changes.', { okLabel: 'Load disk copy' })) {
                  (await sync.loadDiskCopy()) ? toast.success('Loaded the latest disk copy') : toast.error('Could not load the data file')
                }
              }} className="btn btn-primary btn-sm">Load disk copy</button>
            </div>
          </div>
        )}
        {sync?.available ? (
          <>
            <Row title="Data file" desc={<span className="font-figure break-all">{sync.info.dataFile}</span>} descTitle={syncStatusLabel}>
              {sync.status === 'offline' || sync.status === 'conflict'
                ? <span className="status-pill" style={{ background: 'rgba(217,194,139,0.1)', color: '#d9c28b' }}><i aria-hidden="true" />Paused</span>
                : sync.status === 'saving'
                  ? <span className="status-pill" style={{ background: 'rgba(242,240,234,0.07)', color: 'rgba(242,240,234,0.6)' }}><Loader2 className="h-3 w-3 animate-spin" />Saving</span>
                  : <span className="status-pill" style={{ background: 'rgba(158,200,160,0.1)', color: '#9ec8a0' }}><i aria-hidden="true" />Live</span>}
            </Row>
            <Row title="Daily snapshots" desc={`data\\backups\\ — one per day, last 30 kept${sync.info.backups > 0 ? ` · ${sync.info.backups} on disk` : ''}`}>
              <div className="flex gap-[7px]">
                <button onClick={async () => { (await sync.pushNow()) ? toast.success('Saved to your data file') : toast.error('Could not save — is SubTracker still running?') }} className="btn btn-secondary btn-sm">Save now</button>
                <button onClick={async () => { if (!(await openDataFolder())) toast.error('Could not open the folder') }} className="btn btn-secondary btn-sm">Open folder</button>
              </div>
            </Row>
          </>
        ) : (
          <Row title="Data file" desc="Running without the launcher — data stays in this browser only. Start SubTracker with launch.bat to save to a real file.">
            <span className="status-pill" style={{ background: 'rgba(217,194,139,0.1)', color: '#d9c28b' }}><i aria-hidden="true" />Browser only</span>
          </Row>
        )}
        <Row title="Export" desc={
          settings.lastBackupAt
            ? <>Full backup, subscriptions CSV, or payments ledger · last manual export <span style={{ color: daysSince(settings.lastBackupAt) > 14 ? '#d9c28b' : '#9ec8a0' }}>{relTime(settings.lastBackupAt)}</span></>
            : 'Full backup, subscriptions CSV, or payments ledger'
        }>
          <div className="flex flex-wrap justify-end gap-[7px]">
            <button onClick={() => handleExport('json')} className="btn btn-secondary btn-sm" title="Full backup including settings and payment history">Backup</button>
            <button onClick={() => handleExport('csv')} className="btn btn-secondary btn-sm">CSV</button>
            <button onClick={() => handleExport('payments')} className="btn btn-secondary btn-sm" title="Actual payments ledger">Payments</button>
          </div>
        </Row>
        <Row title="Import or restore" desc="Add missing records, or restore a full backup including settings and payment history. Restore asks before replacing data.">
          <div className="flex flex-wrap justify-end gap-[7px]">
            <button onClick={() => { importModeRef.current = 'merge'; fileRef.current?.click() }} className="btn btn-secondary btn-sm">Add records…</button>
            <button onClick={() => { importModeRef.current = 'restore'; fileRef.current?.click() }} className="btn btn-secondary btn-sm">Restore backup…</button>
          </div>
        </Row>
        <input ref={fileRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
      </Card>

      {/* Optional extra copy via the File System Access API */}
      <Card>
        <CardTitle>Extra backup file{sync?.available ? ' (optional)' : ''}</CardTitle>
        {backup?.supported ? (
          backup.connected ? (
            <>
              <Row title={backup.fileName || 'Backup file'} desc={
                backup.status === 'ok' ? (backup.lastBackupAt ? `Synced ${new Date(backup.lastBackupAt).toLocaleTimeString()}` : 'Connected')
                : backup.status === 'pending' ? 'Writing changes…'
                : backup.status === 'needs-permission' ? 'Needs re-authorization'
                : 'Last write failed'
              }>
                <BackupStatusDot status={backup.status} />
              </Row>
              {backup.status === 'needs-permission' && (
                <Row title="Re-authorize" desc="The browser needs permission again">
                  <button onClick={handleReauthorize} className="btn btn-primary btn-sm">Re-authorize</button>
                </Row>
              )}
              <Row title="File actions" desc="Keep the file in a synced folder (OneDrive, Dropbox) for an off-device copy">
                <div className="flex gap-[7px]">
                  <button onClick={handleRestoreFromFile} className="btn btn-secondary btn-sm" title="Replace current data with the file contents">Restore</button>
                  <button onClick={handleDisconnectBackup} className="btn btn-secondary btn-sm" title="Stop auto-syncing (the file stays on disk)">Disconnect</button>
                </div>
              </Row>
            </>
          ) : (
            <Row title="Connect a file" desc="SubTracker keeps it in sync with every change — survives a browser-storage wipe">
              <button onClick={handleConnectBackup} className="btn btn-primary btn-sm">Connect backup file</button>
            </Row>
          )
        ) : (
          <Row title="Live file backup" desc="Needs Chrome or Edge. Data is still mirrored to IndexedDB with auto-recovery, and you can export manual backups." />
        )}
        <Row title="Persistent storage" desc={persisted ? 'Granted — the browser won\'t auto-evict your data' : 'Not granted — data could be evicted under storage pressure'}>
          {persisted
            ? <Check className="h-4 w-4 text-[#9ec8a0]" />
            : <button onClick={handlePersistRequest} className="btn btn-secondary btn-sm">Request</button>}
        </Row>
      </Card>

      {/* Shortcuts */}
      <Card>
        <CardTitle>Keyboard shortcuts</CardTitle>
        {[[`${MOD_KEY} K`, 'Command palette'], ['N', 'New subscription'], ['/', 'Search the list'], ['1 – 6', 'Switch pages'], ['?', 'All shortcuts'], ['Esc', 'Close dialogs']].map(([k, d]) => (
          <div key={k} className="srow">
            <p className="text-[12.5px] text-[rgba(242,240,234,0.72)]">{d}</p>
            <kbd>{k}</kbd>
          </div>
        ))}
      </Card>

      {/* Danger zone */}
      <Card>
        <CardTitle>Danger zone</CardTitle>
        <Row title="Factory reset" desc="Clears app data. A dated rescue copy stays in data\backups\.">
          <button onClick={handleClear} className="btn btn-danger btn-sm">Reset…</button>
        </Row>
        <div className="srow">
          <p className="text-xs text-[rgba(242,240,234,0.42)]">SubTracker Pro · local-first · your data never leaves this PC{settings.setupDate ? ` · setup ${formatDisplayDate(settings.setupDate)}` : ''}</p>
          <span className="font-figure text-[11px] text-[rgba(242,240,234,0.35)]">v2.0</span>
        </div>
      </Card>
    </div>
  )
}

function Card({ children }) {
  return <div className="glass px-[21px] py-1.5">{children}</div>
}

// One editable exchange-rate line: "1 GBP = [ 1.17 ] EUR". Keeps a local
// draft so partial input ("0.", "1.0") doesn't fight the controlled value;
// only valid positive numbers are committed, and clearing the field falls
// back to the built-in default rate.
function RateRow({ code, base, stored, onCommit }) {
  const fallback = getDefaultRate(code, base)
  const [draft, setDraft] = useState(stored != null ? String(stored) : '')

  function handleChange(raw) {
    setDraft(raw)
    const parsed = parseFloat(raw)
    if (raw === '' || (Number.isFinite(parsed) && parsed > 0)) onCommit(raw)
  }

  const usingDefault = stored == null
  return (
    <div className="srow">
      <div className="min-w-0">
        <p className="font-figure text-[13px] font-semibold text-(--app-text)">1 {code} = {(parseFloat(draft) > 0 ? parseFloat(draft) : fallback).toFixed(4).replace(/\.?0+$/, '')} {base}</p>
        <p className="mt-0.5 text-[11px] leading-5 text-[rgba(242,240,234,0.42)]">{usingDefault ? `Built-in default (~${fallback.toFixed(4).replace(/\.?0+$/, '')})` : 'Your custom rate'}</p>
      </div>
      <input
        type="number"
        value={draft}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => { const parsed = parseFloat(draft); if (draft !== '' && (!Number.isFinite(parsed) || parsed <= 0)) { setDraft(''); onCommit('') } }}
        placeholder={fallback.toFixed(4).replace(/\.?0+$/, '')}
        min="0"
        step="0.0001"
        className="input-base font-figure min-h-[38px] w-[110px] py-1.5 text-right text-xs"
        aria-label={`Exchange rate: 1 ${code} in ${base}`}
      />
    </div>
  )
}

// A numeric setting with a local draft: the stored value only changes when
// the text parses, so clearing the box to retype a number no longer snaps
// it to the minimum mid-keystroke. The draft re-syncs from the stored value
// on blur (and whenever it changes while the field is not focused).
function NumberField({ value, onCommit, min, max, step, integer = false, emptyValue = null, placeholder, className = '', ariaLabel }) {
  const shown = value == null || (emptyValue !== null && value === emptyValue) ? '' : String(value)
  const [draft, setDraft] = useState(shown)
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) setDraft(shown)
  }, [shown])

  function parse(raw) {
    const parsed = integer ? parseInt(raw, 10) : parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : null
  }

  function clamp(number) {
    let next = number
    if (min != null) next = Math.max(min, next)
    if (max != null) next = Math.min(max, next)
    return next
  }

  function handleChange(raw) {
    setDraft(raw)
    if (raw.trim() === '') {
      if (emptyValue !== null) onCommit(emptyValue)
      return
    }
    const parsed = parse(raw)
    if (parsed != null) onCommit(clamp(parsed))
  }

  return (
    <input
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={draft}
      onChange={e => handleChange(e.target.value)}
      onFocus={() => { focusedRef.current = true }}
      onBlur={() => { focusedRef.current = false; setDraft(shown) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      className={`input-base font-figure min-h-[38px] py-1.5 text-right text-xs ${className}`}
      aria-label={ariaLabel}
    />
  )
}

function CardTitle({ children }) {
  return <h2 className="mb-0.5 mt-3.5 text-base font-semibold text-(--app-text)">{children}</h2>
}

function Row({ title, desc, descTitle, children }) {
  return (
    <div className="srow">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-(--app-text)">{title}</p>
        {desc && <p className="mt-0.5 text-[11px] leading-5 text-[rgba(242,240,234,0.42)]" title={descTitle || undefined}>{desc}</p>}
      </div>
      {children}
    </div>
  )
}

function daysSince(iso) {
  if (!iso) return Infinity
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return Infinity
  return Math.floor((Date.now() - t) / 86400000)
}

function relTime(iso) {
  const d = daysSince(iso)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d} days ago`
  if (d < 365) return `${Math.floor(d / 30)} months ago`
  return `${Math.floor(d / 365)} years ago`
}

function BackupStatusDot({ status }) {
  if (status === 'pending') return <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-[rgba(242,240,234,0.5)]" />
  if (status === 'needs-permission') return <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-[#d9c28b]" />
  if (status === 'error') return <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-[#d99f8b]" />
  return <Check className="h-3.5 w-3.5 flex-shrink-0 text-[#9ec8a0]" />
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-[42px] flex-none rounded-full border transition-colors ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
      style={{
        background: checked ? 'rgba(225,173,102,0.55)' : 'rgba(242,240,234,0.1)',
        borderColor: checked ? 'rgba(225,173,102,0.7)' : 'rgba(242,240,234,0.14)',
      }}
    >
      <span className="absolute top-[3px] h-4 w-4 rounded-full bg-[#f2f0ea] transition-[left] duration-200" style={{ left: checked ? 21 : 3 }} />
    </button>
  )
}
