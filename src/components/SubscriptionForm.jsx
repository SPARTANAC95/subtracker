import { useState, useEffect, useId, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, X, ChevronDown, ChevronUp, Tag, Link, FileText,
  Users, Sparkles, Search, RefreshCw, BellRing, Check,
} from 'lucide-react'
import { CATEGORIES } from '../utils/categories'
import { CURRENCIES, getCurrency } from '../utils/currencies'
import { SERVICE_PRESETS, suggestCategory, getMarkColors, getServiceInitials } from '../utils/presets'
import { formatDateOnly } from '../utils/dates'
import { CYCLE_LABELS, PAYMENT_METHODS } from '../utils/labels'
import { normalizeServiceUrl } from '../utils/input'

const CYCLES = Object.entries(CYCLE_LABELS).map(([id, label]) => ({ id, label }))

const defaultForm = {
  name: '', amount: '', currency: '', kind: 'recurring', cycle: 'monthly', category: 'other',
  billingDate: '',
  endDate: '',
  startDate: '', payment: '', tags: [],
  renewal: 'auto', isTrial: false, trialEnd: '',
  isShared: false, sharedN: 1, sharedPct: 100, url: '', notes: '',
}

// Merge incoming data over defaults and scrub null/undefined so every
// controlled input always gets a string/array (old or imported subs may
// be missing fields entirely).
function initForm(data, initialKind) {
  if (!data) return { ...defaultForm, billingDate: formatDateOnly(new Date()), kind: initialKind === 'reminder' ? 'reminder' : 'recurring' }
  const merged = { ...defaultForm, ...data }
  for (const k of ['name', 'billingDate', 'endDate', 'startDate', 'trialEnd', 'payment', 'url', 'notes', 'currency']) {
    if (merged[k] == null) merged[k] = ''
  }
  if (merged.amount == null) merged.amount = ''
  if (!Array.isArray(merged.tags)) merged.tags = []
  return merged
}

export default function SubscriptionForm({ onAdd, currency, editData, initialKind, onCancelEdit }) {
  const [form, setForm] = useState(() => initForm(editData, initialKind))
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPresets, setShowPresets] = useState(!editData)
  const [presetSearch, setPresetSearch] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const nameRef = useRef(null)
  const categoryEditedRef = useRef(false)
  const submitTimerRef = useRef(null)
  const advancedRef = useRef(null)
  const id = useId()

  const isEdit = !!editData
  const isReminderKind = form.kind === 'reminder'
  // The amount is entered in the subscription's own currency, which may
  // differ from the app's display currency.
  const subCurrency = form.currency || currency
  const sym = getCurrency(subCurrency).symbol
  // A free plan is a legitimate record (amount 0), so test for an entered
  // value rather than truthiness — "0" and 0 must both count as filled in.
  const hasAmount = form.amount !== '' && form.amount !== null && form.amount !== undefined && Number.isFinite(parseFloat(form.amount))
  const canSubmit = form.name.trim() && hasAmount && (!isReminderKind || form.endDate) && !submitting

  useEffect(() => {
    if (editData) {
      setForm(initForm(editData))
      setShowAdvanced(true)
      setShowPresets(false)
      // The record's category is deliberate; typing in the name must not
      // re-guess it the way it does for a brand-new entry.
      categoryEditedRef.current = true
    }
  }, [editData])

  useEffect(() => {
    const timer = window.setTimeout(() => nameRef.current?.focus(), 200)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => () => window.clearTimeout(submitTimerRef.current), [])

  function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    const url = normalizeServiceUrl(form.url)
    if (form.url.trim() && !url) {
      setShowAdvanced(true)
      setFormError('Enter a valid http or https website address, such as netflix.com.')
      return
    }
    if (isReminderKind && form.startDate && form.endDate < form.startDate) {
      setFormError('The end date must be on or after the purchase date.')
      return
    }
    setFormError('')
    setSubmitting(true)
    const payload = {
      ...form, amount: Math.max(0, parseFloat(form.amount) || 0),
      url,
      tags: [...new Set([...form.tags, tagInput.trim()].filter(Boolean))],
      // Pin the currency explicitly so a later change of the app's display
      // currency cannot silently reprice existing records.
      currency: subCurrency,
      // The edited record's stale status string rides along in form state and
      // normalizeSubscription gives `status: 'trial'` precedence over
      // `isTrial: false` — derive it explicitly so unchecking the trial box
      // actually converts the record to active.
      status: form.isTrial ? 'trial' : form.status === 'trial' ? 'active' : form.status,
      sharedN: parseInt(form.sharedN) || 1, sharedPct: parseInt(form.sharedPct) || 100,
    }
    if (isReminderKind) {
      // Reminders never renew or trial; their schedule IS the end date.
      Object.assign(payload, {
        isTrial: false, trialEnd: null, isShared: false, renewal: 'manual',
        status: payload.status === 'trial' ? 'active' : payload.status,
        billingDate: form.endDate,
      })
    }
    onAdd(payload)
    submitTimerRef.current = window.setTimeout(() => setSubmitting(false), 300)
  }

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  function handleNameChange(name) {
    // Until the user picks a category themselves it follows the name — in
    // both directions. A guess made from the first few letters ("Net…" →
    // Streaming) is withdrawn again once the name stops matching.
    setForm(f => ({
      ...f,
      name,
      category: categoryEditedRef.current ? f.category : (suggestCategory(name) || 'other'),
    }))
  }

  function selectPreset(p) {
    categoryEditedRef.current = false
    setForm(f => ({
      ...f,
      name: p.name,
      // Preset prices are US list prices — only prefill when the record is
      // actually priced in USD (the form's own currency, not the display one).
      amount: subCurrency === 'USD' ? p.amount : '',
      cycle: p.cycle,
      category: p.category,
      billingDate: f.billingDate || formatDateOnly(new Date()),
    }))
    setShowPresets(false); setPresetSearch('')
  }

  function addTag(e) {
    if (e.key !== 'Enter') return
    // Enter inside the tag box must never submit the whole form — even when
    // the box is empty.
    e.preventDefault()
    const tag = tagInput.trim()
    if (!tag) return
    if (!form.tags.includes(tag)) set('tags', [...form.tags, tag])
    setTagInput('')
  }

  const filteredPresets = presetSearch ? SERVICE_PRESETS.filter(p => p.name.toLowerCase().includes(presetSearch.trim().toLowerCase())) : SERVICE_PRESETS

  function onPresetSearchKey(e) {
    if (e.key !== 'Enter') return
    // The search box lives inside the form: Enter picks the top match
    // instead of submitting a half-filled record.
    e.preventDefault()
    if (presetSearch.trim() && filteredPresets[0]) selectPreset(filteredPresets[0])
  }

  const presetsVisible = showPresets && !isEdit && !isReminderKind

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="modal-body form-stack">
        {/* Record kind: a renewing subscription or a one-time purchase that
            simply ends (annual license, domain, prepaid plan…). */}
        <div>
          <div role="group" aria-label="Record type" className="segmented">
            <button type="button" aria-pressed={!isReminderKind} onClick={() => set('kind', 'recurring')}>
              <RefreshCw aria-hidden="true" /> Recurring
            </button>
            <button type="button" aria-pressed={isReminderKind} onClick={() => set('kind', 'reminder')}>
              <BellRing aria-hidden="true" /> Reminder
            </button>
          </div>
          {isReminderKind && (
            <p className="fine-print mt-2.5">
              One-time or prepaid purchase with an end date. It never renews and stays out of your monthly spend — SubTracker just reminds you before it ends.
            </p>
          )}
        </div>

        {/* Quick presets */}
        {!isEdit && !isReminderKind && (
          <div>
            <button type="button" onClick={() => setShowPresets(!showPresets)} className="text-link" aria-expanded={showPresets}>
              <Sparkles aria-hidden="true" /> {showPresets ? 'Hide presets' : 'Quick add from presets'}
            </button>
            <AnimatePresence initial={false}>
              {presetsVisible && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                  <div className="preset-box mt-3">
                    <label className="tool-search">
                      <Search aria-hidden="true" />
                      <input type="text" value={presetSearch} onChange={e => setPresetSearch(e.target.value)} onKeyDown={onPresetSearchKey} placeholder="Search services…" aria-label="Search service presets" />
                    </label>
                    {filteredPresets.length ? (
                      <div className="preset-grid">
                        {filteredPresets.map(p => (
                          <button key={p.name} type="button" onClick={() => selectPreset(p)}>
                            <span className="mark h-[34px] w-[34px] text-[11px]" style={getMarkColors(p)}>{getServiceInitials(p.name)}</span>
                            <span>{p.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="fine-print mt-3">No preset matches — just type the name below.</p>
                    )}
                    <p className="fine-print mt-2.5">
                      Presets fill the name and category. {subCurrency === 'USD' ? 'The price is an example — verify it before saving.' : `Enter the current price in ${subCurrency}.`}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div>
          <Label htmlFor={`${id}-name`}>Service name</Label>
          <input id={`${id}-name`} ref={nameRef} type="text" value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="Netflix, Spotify…" className="input" required autoComplete="off" />
        </div>

        <div className="form-grid">
          <div>
            <Label htmlFor={`${id}-amount`}>{isReminderKind ? `Price paid (${sym})` : `Amount (${sym})`}</Label>
            <input id={`${id}-amount`} type="number" inputMode="decimal" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="9.99" step="0.01" min="0" className="input num" required />
          </div>
          <div>
            <Label htmlFor={`${id}-currency`}>Currency</Label>
            <select id={`${id}-currency`} value={subCurrency} onChange={e => set('currency', e.target.value)} className="input" title="The money this subscription is billed in — totals convert to your display currency">
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
            </select>
          </div>

          {isReminderKind ? (
            <>
              <div>
                <Label htmlFor={`${id}-start`}>Purchased on</Label>
                <input id={`${id}-start`} type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} className="input num" />
              </div>
              <div>
                <Label htmlFor={`${id}-end`}>Ends on</Label>
                <input id={`${id}-end`} type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} className="input num" required title="When this purchase runs out — you'll see a countdown and get a reminder" />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor={`${id}-cycle`}>Cycle</Label>
                <select id={`${id}-cycle`} value={form.cycle} onChange={e => set('cycle', e.target.value)} className="input">{CYCLES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
              </div>
              <div>
                <Label htmlFor={`${id}-billing`}>Next billing</Label>
                <input id={`${id}-billing`} type="date" value={form.billingDate} onChange={e => set('billingDate', e.target.value)} className="input num" required title="Date of the next scheduled bill or original billing anchor" />
              </div>
            </>
          )}
        </div>

        <div>
          <Label htmlFor={`${id}-category`}>Category</Label>
          <select id={`${id}-category`} value={form.category} onChange={e => { categoryEditedRef.current = true; set('category', e.target.value) }} className="input">{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </div>

        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="text-link self-start" aria-expanded={showAdvanced}>
          {showAdvanced ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {showAdvanced ? 'Fewer options' : isReminderKind ? 'More options — payment, tags, notes' : 'More options — start date, trial, payment, notes'}
        </button>

        <AnimatePresence initial={false}>
          {showAdvanced && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
              // The toggle sits at the bottom of the scroll area, so the new
              // fields would otherwise open out of sight below it.
              onAnimationComplete={definition => { if (definition?.height === 'auto') advancedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }}
              ref={advancedRef}
              className="-m-[3px] overflow-hidden p-[3px]"
            >
              {/* The 3px inset keeps focus rings inside the clipped, animated box. */}
              <div className="form-stack">
                <div className="form-grid">
                  {!isReminderKind && (
                    <div>
                      <Label htmlFor={`${id}-start`}>Start date</Label>
                      <input id={`${id}-start`} type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} className="input num" />
                    </div>
                  )}
                  <div className={isReminderKind ? 'col-span-2' : undefined}>
                    <Label htmlFor={`${id}-payment`}>Payment</Label>
                    <select id={`${id}-payment`} value={form.payment} onChange={e => set('payment', e.target.value)} className="input">{PAYMENT_METHODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                  </div>
                </div>

                {!isReminderKind && (
                  <>
                    <div>
                      <Label htmlFor={`${id}-renewal`}>Renewal</Label>
                      <select id={`${id}-renewal`} value={form.renewal} onChange={e => set('renewal', e.target.value)} className="input"><option value="auto">Auto-renew</option><option value="manual">Manual</option></select>
                    </div>

                    <div className="check-row">
                      <label>
                        <input
                          type="checkbox"
                          checked={form.isTrial}
                          onChange={e => {
                            const on = e.target.checked
                            // A trial without an end date can never warn — default to
                            // the billing date, which is when it would convert.
                            setForm(f => ({ ...f, isTrial: on, trialEnd: on && !f.trialEnd ? (f.billingDate || formatDateOnly(new Date())) : f.trialEnd }))
                          }}
                        />
                        Free trial, ends
                      </label>
                      {form.isTrial && <input type="date" value={form.trialEnd} onChange={e => set('trialEnd', e.target.value)} className="input input-sm num flex-1" aria-label="Trial end date" />}
                    </div>

                    <div className="check-row">
                      <label>
                        <input type="checkbox" checked={form.isShared} onChange={e => set('isShared', e.target.checked)} />
                        <Users aria-hidden="true" /> Shared
                      </label>
                      {form.isShared && (
                        <span className="flex flex-1 items-center gap-2 text-[11.5px] text-muted">
                          <input type="number" min="1" value={form.sharedN} onChange={e => set('sharedN', e.target.value)} aria-label="People sharing this subscription" className="input input-sm num !w-16" />
                          people, my share
                          <input type="number" min="1" max="100" value={form.sharedPct} onChange={e => set('sharedPct', e.target.value)} aria-label="Your share percentage" className="input input-sm num !w-16" />
                          %
                        </span>
                      )}
                    </div>
                  </>
                )}

                <div>
                  <Label htmlFor={`${id}-tags`}><Tag aria-hidden="true" /> Tags</Label>
                  <div className="tag-box">
                    {form.tags.map(tag => (
                      <span key={tag} className="chip">
                        {tag}<button type="button" onClick={() => set('tags', form.tags.filter(t => t !== tag))} aria-label={`Remove tag ${tag}`}><X className="h-2.5 w-2.5" aria-hidden="true" /></button>
                      </span>
                    ))}
                    <input id={`${id}-tags`} type="text" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={addTag} placeholder={form.tags.length ? '' : 'Type and press Enter'} />
                  </div>
                </div>
                <div>
                  <Label htmlFor={`${id}-url`}><Link aria-hidden="true" /> URL</Label>
                  <input id={`${id}-url`} type="text" inputMode="url" autoComplete="off" spellCheck={false} aria-invalid={Boolean(formError && form.url.trim() && !normalizeServiceUrl(form.url))} value={form.url} onChange={e => set('url', e.target.value)} placeholder="netflix.com" className="input" />
                </div>
                <div>
                  <Label htmlFor={`${id}-notes`}><FileText aria-hidden="true" /> Notes</Label>
                  <textarea id={`${id}-notes`} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Plan details, cancellation date…" rows={3} className="input" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {formError && <p role="alert" className="notice danger !m-0">{formError}</p>}
      </div>

      <div className="modal-foot">
        {onCancelEdit && <button type="button" onClick={onCancelEdit} className="btn">Cancel</button>}
        <button type="submit" disabled={!canSubmit} className="btn btn-primary">
          {isEdit ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {isEdit ? 'Save changes' : isReminderKind ? 'Add reminder' : 'Add subscription'}
        </button>
      </div>
    </form>
  )
}

function Label({ children, htmlFor }) {
  return <label htmlFor={htmlFor} className="field-label">{children}</label>
}
