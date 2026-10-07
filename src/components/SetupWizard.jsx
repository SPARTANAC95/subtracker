import { useState, useRef } from 'react'
import { ChevronRight, Upload } from 'lucide-react'
import { CURRENCIES, getCurrency } from '../utils/currencies'
import { normalizeSubscriptionsWithReport } from '../utils/subscriptions'
import { parseBackupText } from '../utils/persistence'
import { detectCurrency, normalizeSettings } from '../utils/settings'
import BrandMark from './BrandMark'

const STEPS = [
  { title: 'Welcome to SubTracker', sub: 'Know what is due, what is paid, and what is worth keeping.' },
  { title: 'Choose currency', sub: 'Used for every total and budget. Individual subscriptions can still be billed in another one.' },
  { title: 'Set a monthly budget', sub: 'Optional — you can change this anytime in Settings.' },
]

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0)
  const [currency, setCurrency] = useState(() => detectCurrency(typeof navigator !== 'undefined' ? navigator.language : ''))
  const [budget, setBudget] = useState('')
  const [importError, setImportError] = useState('')
  const fileRef = useRef(null)
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  function finish() {
    onComplete(normalizeSettings({ currency, budget: parseFloat(budget) || 0, notifications: false, reminderDays: 3, setupDate: new Date().toISOString() }))
  }

  function next() {
    if (isLast) finish()
    else setStep(s => s + 1)
  }

  function handleImportFile(e) {
    const f = e.target.files[0]; if (!f) return
    setImportError('')
    const r = new FileReader()
    r.onload = ev => {
      try {
        const parsed = parseBackupText(ev.target.result)
        const importedSettings = parsed.settings
        const report = normalizeSubscriptionsWithReport(parsed.subs, { requireAmount: true, mode: 'strict' })
        const valid = report.items
        if (report.rejected.length) {
          setImportError(`${report.rejected.length} invalid ${report.rejected.length === 1 ? 'record' : 'records'} found. Nothing was restored. Repair the backup, or finish setup and use Settings import to add only valid records.`)
          return
        }
        if (!valid.length && !importedSettings) { setImportError('No subscriptions or settings in file'); return }
        // Carry the whole settings record over (custom exchange rates
        // included) — the normalizer clamps anything out of range.
        const settings = normalizeSettings({
          ...(importedSettings || {}),
          setupDate: importedSettings?.setupDate || new Date().toISOString(),
          lastBackupAt: new Date().toISOString(),
        })
        onComplete(settings, valid, parsed.dismissed)
      } catch (error) {
        setImportError(error.message || 'Invalid backup file')
      }
    }
    r.onerror = () => setImportError('Could not read this file. Try choosing it again.')
    r.readAsText(f); e.target.value = ''
  }

  return (
    <main className="welcome">
      {/* A form, so Enter moves the wizard forward from any step. */}
      <form className="welcome-card" onSubmit={event => { event.preventDefault(); next() }}>
        <BrandMark className="mx-auto mb-5 !h-11 !w-11" />

        <div className="welcome-progress" role="img" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((_, i) => <i key={i} className={i === step ? 'current' : i < step ? 'done' : ''} />)}
        </div>

        <div key={step} style={{ animation: 'page-in 0.2s ease-out' }}>
          <h1>{current.title}</h1>
          <p>{current.sub}</p>

          {step === 0 && (
            <div className="mb-5">
              <button type="button" onClick={() => fileRef.current?.click()} className="btn w-full">
                <Upload aria-hidden="true" /> Restore from backup
              </button>
              <p className="fine-print mt-2.5">
                Switching browsers or devices? Import the <span className="text-soft">.json</span> backup you exported previously.
              </p>
              <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleImportFile} className="hidden" />
              {importError && <p role="alert" className="notice danger mt-3 text-left">{importError}</p>}
            </div>
          )}

          {step === 1 && (
            <div className="currency-grid mb-5" role="group" aria-label="Display currency">
              {CURRENCIES.map(c => (
                <button key={c.code} type="button" onClick={() => setCurrency(c.code)} aria-pressed={currency === c.code}>
                  <span>{c.symbol}</span>{' '}
                  <small>{c.code}</small>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="mb-5">
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[17px] text-muted" aria-hidden="true">{getCurrency(currency).symbol}</span>
                <input type="number" inputMode="decimal" min="0" value={budget} onChange={e => setBudget(e.target.value)} placeholder="0" className="input num !min-h-[52px] !px-12 text-center !text-[20px] font-semibold" autoFocus aria-label="Monthly budget" />
              </div>
              <p className="fine-print mt-2.5">Leave empty to skip.</p>
            </div>
          )}
        </div>

        <div className="flex gap-2.5">
          {step > 0 && <button type="button" onClick={() => setStep(s => s - 1)} className="btn flex-1">Back</button>}
          <button type="submit" className="btn btn-primary flex-1">
            {isLast ? 'Get started' : <>Next <ChevronRight aria-hidden="true" /></>}
          </button>
        </div>
        <p className="fine-print mt-5">Everything stays on this device.</p>
      </form>
    </main>
  )
}
