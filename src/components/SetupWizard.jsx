import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, DollarSign, Target, Sparkles, Upload, AlertCircle } from 'lucide-react'
import { CURRENCIES } from '../utils/currencies'
import { normalizeSubscriptionsWithReport } from '../utils/subscriptions'
import { parseBackupText } from '../utils/persistence'
import { detectCurrency, normalizeSettings } from '../utils/settings'

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0)
  const [currency, setCurrency] = useState(() => detectCurrency(typeof navigator !== 'undefined' ? navigator.language : ''))
  const [budget, setBudget] = useState('')
  const [importError, setImportError] = useState('')
  const fileRef = useRef(null)

  const steps = [
    { title: 'Welcome to SubTracker', sub: 'Know what is due, paid, and worth keeping', icon: Sparkles },
    { title: 'Choose currency', sub: 'Used for every total and budget', icon: DollarSign },
    { title: 'Set a monthly budget', sub: 'Optional — change this anytime', icon: Target },
  ]
  const cur = steps[step]
  const Icon = cur.icon

  function finish() {
    onComplete(normalizeSettings({ currency, budget: parseFloat(budget) || 0, notifications: false, reminderDays: 3, setupDate: new Date().toISOString() }))
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
          setImportError(`${report.rejected.length} invalid records found. Nothing was restored. Repair the backup, or finish setup and use Settings import to add only valid records.`)
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
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#060605]">
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="glass-deep w-full max-w-sm rounded-[22px] p-8">
        {/* Progress */}
        <div className="flex justify-center gap-2 mb-6">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 rounded-full transition-all duration-300 ${i === step ? 'w-8 bg-[#e1ad66]' : i < step ? 'w-4 bg-[rgba(225,173,102,0.4)]' : 'w-4 bg-[rgba(242,240,234,0.1)]'}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[14px] border border-[rgba(225,173,102,0.32)] bg-[linear-gradient(145deg,rgba(225,173,102,0.2),rgba(182,130,53,0.06))]">
              <Icon className="h-7 w-7 text-[#e1ad66]" />
            </div>
            <h2 className="font-figure mb-1 text-xl font-medium text-(--app-text)">{cur.title}</h2>
            <p className="mb-6 text-xs text-[rgba(242,240,234,0.45)]">{cur.sub}</p>

            {step === 1 && (
              <div className="mb-4 grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1">
                {CURRENCIES.map(c => (
                  <button key={c.code} onClick={() => setCurrency(c.code)}
                    className={`py-2.5 px-2 rounded-xl text-xs font-medium transition-all ${currency === c.code ? 'border border-[rgba(225,173,102,0.5)] bg-[rgba(225,173,102,0.12)] text-[#facb8d]' : 'border border-[rgba(242,240,234,0.05)] bg-[rgba(242,240,234,0.03)] text-[rgba(242,240,234,0.55)] hover:border-[rgba(242,240,234,0.12)]'}`}>
                    <span className="font-figure block text-base">{c.symbol}</span>
                    <span className="text-[9px] text-[rgba(242,240,234,0.4)]">{c.code}</span>
                  </button>
                ))}
              </div>
            )}

            {step === 0 && (
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="btn btn-secondary w-full text-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Restore from backup
                </button>
                <p className="mt-2 text-[10px] leading-relaxed text-[rgba(242,240,234,0.4)]">
                  Switching browsers or devices? Import the <span className="text-[rgba(242,240,234,0.75)]">.json</span> backup you exported previously.
                </p>
                <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleImportFile} className="hidden" />
                {importError && (
                  <p role="alert" className="mt-2 flex items-center justify-center gap-1 text-xs leading-5 text-[#d99f8b]">
                    <AlertCircle className="w-3 h-3" />{importError}
                  </p>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="mb-4">
                <div className="relative">
                  <span className="font-figure absolute left-4 top-1/2 -translate-y-1/2 text-lg text-[rgba(242,240,234,0.4)]">{CURRENCIES.find(c => c.code === currency)?.symbol || '$'}</span>
                  <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="0" className="input-base font-figure py-3.5 pl-10 pr-4 text-center text-xl font-medium" autoFocus aria-label="Monthly budget" />
                </div>
                <p className="mt-2 text-[10px] text-[rgba(242,240,234,0.4)]">Leave empty to skip</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-4 flex gap-2.5">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} className="btn btn-secondary flex-1 text-xs">Back</button>
          )}
          <button onClick={() => step < steps.length - 1 ? setStep(s => s + 1) : finish()} className="btn btn-primary flex-1 text-xs">
            {step < steps.length - 1 ? <>Next <ChevronRight className="w-3.5 h-3.5" /></> : <>Get started <Sparkles className="w-3.5 h-3.5" /></>}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
