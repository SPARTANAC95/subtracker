import { useState, useRef, useEffect, useMemo } from 'react'
import { AlertCircle, AlertTriangle, ArrowLeftRight, Check, FileDown, HardDrive, Keyboard, Loader2, SlidersHorizontal } from 'lucide-react'
import { CURRENCIES, getDefaultRate } from '../utils/currencies'
import { openDataFolder } from '../utils/syncServer'
import { useToast } from './toast-context'
import { isNotificationSupported, getPermission, requestPermission } from '../utils/notifications'
import { isStoragePersisted, ensurePersistentStorage, parseBackupText } from '../utils/persistence'
import { formatDateOnly, formatDisplayDate } from '../utils/dates'
import { getSubscriptionStatus, normalizeSubscriptionsWithReport } from '../utils/subscriptions'
import { getCategoryById } from '../utils/categories'
import { MAX_REMINDER_DAYS, MIN_REMINDER_DAYS, clampReminderDays } from '../utils/settings'
import { MOD_KEY, STATUS_STYLES, paymentLabel, plural } from '../utils/labels'
import { csvCell } from '../utils/input'
import { downloadBlob } from '../utils/download'
import PageHeading from './PageHeading'

// Excel only reads a CSV as UTF-8 when it starts with a byte-order mark;
// without one, names like "Żabka" or a "—" in notes arrive as mojibake.
const CSV_BOM = '﻿'

function csvBlob(lines) {
  return new Blob([CSV_BOM, lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

function trimRate(value) {
  return value.toFixed(4).replace(/\.?0+$/, '')
}

export default function SettingsPanel({ settings, onUpdateSettings, subs, dismissed, onImport, onClearAll, backup, onRestore, sync, soundOn, onToggleSound }) {
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

  function flash() {
    setFlashSave(true)
    window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setFlashSave(false), 1500)
  }

  function update(field, value) {
    onUpdateSettings({ ...settings, [field]: value })
    flash()
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
    flash()
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
    const stamp = formatDateOnly(new Date())
    if (fmt === 'json') {
      const now = new Date().toISOString()
      const payload = { app: 'subtracker-pro', version: 2, exportedAt: now, settings: { ...settings, lastBackupAt: now }, subs, dismissed: dismissed || [] }
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `subtracker-${stamp}.json`)
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
      downloadBlob(csvBlob([hdr.join(','), ...rows]), `subtracker-${stamp}.csv`)
      toast.success('Exported CSV')
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
      downloadBlob(csvBlob([hdr.join(','), ...rows]), `subtracker-payments-${stamp}.csv`)
      toast.success('Exported payments')
    }
  }

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
        const imported = onImport(valid, parsed.settings?.currency) ?? valid.length
        // Two different reasons a record is left out: it was invalid, or it
        // is already in the library. The old message only counted the first.
        const invalid = report.rejected.length
        const duplicates = valid.length - imported
        const left = [
          duplicates > 0 ? `${duplicates} already here` : null,
          invalid > 0 ? `${invalid} invalid` : null,
        ].filter(Boolean).join(', ')
        if (imported === 0) toast.info(`No new subscriptions to import${left ? ` (${left})` : ''}`)
        else toast.success(`Imported ${imported} ${plural(imported, 'record')}${left ? ` · skipped ${left}` : ''}`)
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

  async function handleLoadDiskCopy() {
    if (!(await toast.confirm('Load the latest disk copy?', 'This replaces the records and settings in this tab. Export a backup first if you need to keep your changes.', { okLabel: 'Load disk copy' }))) return
    if (await sync.loadDiskCopy()) toast.success('Loaded the latest disk copy')
    else toast.error('Could not load the data file')
  }

  const syncStatusLabel = sync?.available
    ? (sync.status === 'saving' ? 'Saving…'
      : sync.status === 'offline' ? 'Server unavailable — retrying automatically'
      : sync.info.lastSavedAt ? `Last saved ${new Date(sync.info.lastSavedAt).toLocaleString()}` : 'Up to date')
    : null

  return (
    <>
      <PageHeading title="Settings">
        Local-first — your data never leaves this PC.
        {settings.setupDate ? ` Set up ${formatDisplayDate(settings.setupDate, { month: 'short', day: 'numeric', year: 'numeric' })}.` : ''}
      </PageHeading>

      <div className="settings">
        <section>
          <h2>
            <SlidersHorizontal aria-hidden="true" /> Preferences
            {flashSave && <span className="status ok ml-1 font-normal"><Check aria-hidden="true" />Saved</span>}
          </h2>
          <Row title="Currency" desc="Display currency — every total converts into it">
            <select value={baseCurrency} onChange={e => handleBaseCurrencyChange(e.target.value)} className="input input-sm" aria-label="Currency">
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
              width={96}
              ariaLabel="Monthly budget"
            />
          </Row>
          {/* Clamped to the same 1-30 range the settings normalizer enforces —
              the input used to advertise a 14-day maximum it did not apply. */}
          <Row title="Reminder days" desc={`How many days ahead to warn about a renewal (${MIN_REMINDER_DAYS}–${MAX_REMINDER_DAYS})`}>
            <NumberField
              value={clampReminderDays(settings.reminderDays)}
              onCommit={value => update('reminderDays', clampReminderDays(value))}
              min={MIN_REMINDER_DAYS}
              max={MAX_REMINDER_DAYS}
              step="1"
              integer
              width={72}
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
              label="Notifications"
              disabled={!notifSupported || permission === 'denied'}
            />
          </Row>
          <Row title="Sounds" desc="Soft clicks and chimes when you add, pay or delete">
            <Toggle checked={Boolean(soundOn)} onChange={() => onToggleSound?.()} label="Sounds" />
          </Row>
        </section>

        {/* Exchange rates for subscriptions billed in another currency */}
        <section>
          <h2><ArrowLeftRight aria-hidden="true" /> Exchange rates</h2>
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
                  <button type="button" onClick={() => update('rates', {})} className="btn btn-sm">Use defaults</button>
                )}
              </Row>
            </>
          ) : (
            <Row title="No foreign currencies yet" desc={`Every subscription is in ${baseCurrency}. Pick a different currency on a subscription (Edit → Currency) and its rate appears here.`} />
          )}
        </section>

        {/* Where your data lives — the local data server's disk file */}
        <section>
          <h2><HardDrive aria-hidden="true" /> Your data on this PC</h2>
          {sync?.status === 'conflict' && (
            <div role="alert" className="notice">
              <div>
                <strong>This data file changed in another browser.</strong>
                <span>Your changes are still in this tab. Back them up before loading the latest disk copy.</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => handleExport('json')} className="btn btn-sm">Back up this tab</button>
                <button type="button" onClick={handleLoadDiskCopy} className="btn btn-sm btn-primary">Load disk copy</button>
              </div>
            </div>
          )}
          {sync?.available ? (
            <>
              <Row title="Data file" desc={<span className="break-all" title={syncStatusLabel || undefined}>{sync.info.dataFile}</span>}>
                {sync.status === 'offline' || sync.status === 'conflict'
                  ? <span className="status warn"><i aria-hidden="true" />Paused</span>
                  : sync.status === 'saving'
                    ? <span className="status"><Loader2 className="spin" aria-hidden="true" />Saving</span>
                    : <span className="status ok"><i aria-hidden="true" />Live</span>}
              </Row>
              <Row title="Daily snapshots" desc={`data\\backups\\ — one per day, last 30 kept${sync.info.backups > 0 ? ` · ${sync.info.backups} on disk` : ''}`}>
                <button type="button" onClick={async () => { (await sync.pushNow()) ? toast.success('Saved to your data file') : toast.error('Could not save — is SubTracker still running?') }} className="btn btn-sm">Save now</button>
                <button type="button" onClick={async () => { if (!(await openDataFolder())) toast.error('Could not open the folder') }} className="btn btn-sm">Open folder</button>
              </Row>
            </>
          ) : (
            <Row title="Data file" desc="Running without the launcher — data stays in this browser only. Start SubTracker with launch.bat to save to a real file.">
              <span className="status warn"><i aria-hidden="true" />Browser only</span>
            </Row>
          )}
          <Row title="Export" desc={
            settings.lastBackupAt
              ? <>Full backup, subscriptions CSV, or payments ledger · last manual export <span className={daysSince(settings.lastBackupAt) > 14 ? 'text-warn' : 'text-ok'}>{relTime(settings.lastBackupAt)}</span></>
              : 'Full backup, subscriptions CSV, or payments ledger'
          }>
            <button type="button" onClick={() => handleExport('json')} className="btn btn-sm" title="Full backup including settings and payment history">Backup</button>
            <button type="button" onClick={() => handleExport('csv')} className="btn btn-sm">CSV</button>
            <button type="button" onClick={() => handleExport('payments')} className="btn btn-sm" title="Actual payments ledger">Payments</button>
          </Row>
          <Row title="Import or restore" desc="Add missing records, or restore a full backup including settings and payment history. Restore asks before replacing data.">
            <button type="button" onClick={() => { importModeRef.current = 'merge'; fileRef.current?.click() }} className="btn btn-sm">Add records…</button>
            <button type="button" onClick={() => { importModeRef.current = 'restore'; fileRef.current?.click() }} className="btn btn-sm">Restore backup…</button>
          </Row>
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleImport} className="hidden" />
        </section>

        {/* Optional extra copy via the File System Access API */}
        <section>
          <h2><FileDown aria-hidden="true" /> Extra backup file{sync?.available ? ' (optional)' : ''}</h2>
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
                    <button type="button" onClick={handleReauthorize} className="btn btn-sm btn-primary">Re-authorize</button>
                  </Row>
                )}
                <Row title="File actions" desc="Keep the file in a synced folder (OneDrive, Dropbox) for an off-device copy">
                  <button type="button" onClick={handleRestoreFromFile} className="btn btn-sm" title="Replace current data with the file contents">Restore</button>
                  <button type="button" onClick={handleDisconnectBackup} className="btn btn-sm" title="Stop auto-syncing (the file stays on disk)">Disconnect</button>
                </Row>
              </>
            ) : (
              <Row title="Connect a file" desc="SubTracker keeps it in sync with every change — survives a browser-storage wipe">
                <button type="button" onClick={handleConnectBackup} className="btn btn-sm">Connect backup file</button>
              </Row>
            )
          ) : (
            <Row title="Live file backup" desc="Needs Chrome or Edge. Data is still mirrored to IndexedDB with auto-recovery, and you can export manual backups." />
          )}
          <Row title="Persistent storage" desc={persisted ? 'Granted — the browser won\'t auto-evict your data' : 'Not granted — data could be evicted under storage pressure'}>
            {persisted
              ? <span className="status ok"><Check aria-hidden="true" />Granted</span>
              : <button type="button" onClick={handlePersistRequest} className="btn btn-sm">Request</button>}
          </Row>
        </section>

        {/* Shortcuts */}
        <section>
          <h2><Keyboard aria-hidden="true" /> Keyboard shortcuts</h2>
          {[[`${MOD_KEY} K`, 'Command palette'], ['N', 'New subscription'], ['/', 'Search the list'], ['1 – 6', 'Switch pages'], ['?', 'All shortcuts'], ['Esc', 'Close dialogs']].map(([k, d]) => (
            <div key={k} className="kv-row">
              <span>{d}</span>
              <kbd>{k}</kbd>
            </div>
          ))}
        </section>

        {/* Danger zone */}
        <section>
          <h2><AlertTriangle aria-hidden="true" /> Danger zone</h2>
          <Row title="Factory reset" desc="Clears app data. A dated rescue copy stays in data\backups\.">
            <button type="button" onClick={handleClear} className="btn btn-sm btn-danger">Reset…</button>
          </Row>
          <p className="fine-print mt-3">SubTracker v2.0</p>
        </section>
      </div>
    </>
  )
}

// One editable exchange-rate line: "1 GBP = [ 1.17 ] EUR". Keeps a local
// draft so partial input ("0.", "1.0") doesn't fight the controlled value;
// only valid positive numbers are committed, and clearing the field falls
// back to the built-in default rate.
function RateRow({ code, base, stored, onCommit }) {
  const fallback = getDefaultRate(code, base)
  const storedText = stored != null ? String(stored) : ''
  const [draft, setDraft] = useState(storedText)
  const focusedRef = useRef(false)

  // "Use defaults" (and a restore) change the stored rate from outside; the
  // box used to keep showing the old custom number under a "Built-in default"
  // caption. Follow the stored value whenever the user is not typing here.
  useEffect(() => {
    if (!focusedRef.current) setDraft(storedText)
  }, [storedText])

  function handleChange(raw) {
    setDraft(raw)
    const parsed = parseFloat(raw)
    if (raw === '' || (Number.isFinite(parsed) && parsed > 0)) onCommit(raw)
  }

  function handleBlur() {
    focusedRef.current = false
    const parsed = parseFloat(draft)
    if (draft !== '' && (!Number.isFinite(parsed) || parsed <= 0)) { setDraft(''); onCommit('') }
  }

  const usingDefault = stored == null
  const shown = parseFloat(draft) > 0 ? parseFloat(draft) : fallback
  return (
    <div className="setting-row">
      <div>
        <strong className="num">1 {code} = {trimRate(shown)} {base}</strong>
        <small>{usingDefault ? `Built-in default (~${trimRate(fallback)})` : 'Your custom rate'}</small>
      </div>
      <div className="controls">
        <input
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => { focusedRef.current = true }}
          onBlur={handleBlur}
          placeholder={trimRate(fallback)}
          min="0"
          step="0.0001"
          className="input input-sm num text-right"
          style={{ width: 110 }}
          aria-label={`Exchange rate: 1 ${code} in ${base}`}
        />
      </div>
    </div>
  )
}

// A numeric setting with a local draft: the stored value only changes when
// the text parses, so clearing the box to retype a number no longer snaps
// it to the minimum mid-keystroke. The draft re-syncs from the stored value
// on blur (and whenever it changes while the field is not focused).
function NumberField({ value, onCommit, min, max, step, integer = false, emptyValue = null, placeholder, width, ariaLabel }) {
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
      className="input input-sm num text-right"
      style={{ width }}
      aria-label={ariaLabel}
    />
  )
}

function Row({ title, desc, children }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        {desc && <small>{desc}</small>}
      </div>
      {children ? <div className="controls">{children}</div> : null}
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
  if (d < 60) return 'a month ago'
  if (d < 365) return `${Math.floor(d / 30)} months ago`
  if (d < 730) return 'a year ago'
  return `${Math.floor(d / 365)} years ago`
}

function BackupStatusDot({ status }) {
  if (status === 'pending') return <span className="status"><Loader2 className="spin" aria-hidden="true" />Writing</span>
  if (status === 'needs-permission') return <span className="status warn"><AlertCircle aria-hidden="true" />Needs permission</span>
  if (status === 'error') return <span className="status danger"><AlertCircle aria-hidden="true" />Failed</span>
  return <span className="status ok"><Check aria-hidden="true" />Synced</span>
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className="switch"
    >
      <span />
    </button>
  )
}
