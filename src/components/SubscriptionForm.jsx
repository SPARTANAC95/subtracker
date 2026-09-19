import { useState, useEffect, useId, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, X, ChevronDown, ChevronUp, Tag, Link, FileText,
  Users, Sparkles, Search, RefreshCw, BellRing
} from 'lucide-react'
import { CATEGORIES } from '../utils/categories'
import { CURRENCIES, getCurrency } from '../utils/currencies'
import { SERVICE_PRESETS, suggestCategory, getServiceInitials } from '../utils/presets'
import { formatDateOnly } from '../utils/dates'
import { CYCLE_LABELS, PAYMENT_METHODS } from '../utils/labels'
import { normalizeServiceUrl } from '../utils/input'

const CYCLES = Object.entries(CYCLE_LABELS).map(([id, label]) => ({ id, label }))

// "netflix.com" is what people type; a URL input would refuse to submit it.
// Accept bare hosts and store them as proper https links.
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
    setTimeout(() => setSubmitting(false), 300)
  }

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  function handleNameChange(name) {
    set('name', name)
    const suggested = suggestCategory(name)
    if (suggested && !categoryEditedRef.current) set('category', suggested)
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

  const filteredPresets = presetSearch ? SERVICE_PRESETS.filter(p => p.name.toLowerCase().includes(presetSearch.toLowerCase())) : SERVICE_PRESETS

  return (
    <div>
      {/* Record kind: a renewing subscription or a one-time purchase that
          simply ends (annual license, domain, prepaid plan…). */}
      <div className="px-[22px] pb-1 pt-4">
        <div role="group" aria-label="Record type" className="grid grid-cols-2 gap-1 rounded-full border border-[rgba(242,240,234,0.07)] bg-[rgba(242,240,234,0.04)] p-1">
          <button
            type="button"
            aria-pressed={!isReminderKind}
            onClick={() => set('kind', 'recurring')}
            className={`flex min-h-9 items-center justify-center gap-1.5 rounded-full text-[12px] transition-colors ${!isReminderKind ? 'bg-[rgba(225,173,102,0.16)] font-semibold text-[#facb8d]' : 'text-[rgba(242,240,234,0.55)] hover:text-[rgba(242,240,234,0.8)]'}`}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Recurring
          </button>
          <button
            type="button"
            aria-pressed={isReminderKind}
            onClick={() => set('kind', 'reminder')}
            className={`flex min-h-9 items-center justify-center gap-1.5 rounded-full text-[12px] transition-colors ${isReminderKind ? 'bg-[rgba(225,173,102,0.16)] font-semibold text-[#facb8d]' : 'text-[rgba(242,240,234,0.55)] hover:text-[rgba(242,240,234,0.8)]'}`}
          >
            <BellRing className="h-3.5 w-3.5" /> Reminder
          </button>
        </div>
        {isReminderKind && (
          <p className="mt-2 px-1 text-[10.5px] leading-5 text-[rgba(242,240,234,0.4)]">
            One-time or prepaid purchase with an end date. It never renews and stays out of your monthly spend — SubTracker just reminds you before it ends.
          </p>
        )}
      </div>

      {/* Quick presets */}
      {!isEdit && !isReminderKind && (
        <div className="px-[22px] pb-2 pt-1">
          <button type="button" onClick={() => setShowPresets(!showPresets)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-colors ${showPresets ? 'bg-[rgba(225,173,102,0.12)] text-[#facb8d]' : 'text-[rgba(242,240,234,0.45)] hover:text-[rgba(242,240,234,0.7)]'}`}>
            <Sparkles className="h-3 w-3" /> {showPresets ? 'Hide presets' : 'Quick add from presets'}
          </button>
        </div>
      )}

      <AnimatePresence>
        {showPresets && !isEdit && !isReminderKind && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-[22px] pb-4">
              <div className="rounded-2xl border border-[rgba(242,240,234,0.07)] p-[13px]">
                <div className="relative mb-[11px]">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[rgba(242,240,234,0.35)]" />
                  <input type="text" value={presetSearch} onChange={e => setPresetSearch(e.target.value)} placeholder="Quick add — search services…" aria-label="Search service presets" className="input-base input-with-icon min-h-[38px] text-xs" />
                </div>
                <div className="grid max-h-[196px] grid-cols-4 gap-[7px] overflow-y-auto">
                  {filteredPresets.map(p => (
                    <button key={p.name} type="button" onClick={() => selectPreset(p)} className="preset-item">
                      <span className="font-figure grid h-[34px] w-[34px] place-items-center rounded-[10px] text-[11px] font-semibold" style={{ background: `${p.color}20`, color: p.color }}>{getServiceInitials(p.name)}</span>
                      <span className="w-full truncate text-center text-[9.5px] leading-tight text-[rgba(242,240,234,0.5)]">{p.name}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2.5 text-[10.5px] leading-5 text-[rgba(242,240,234,0.4)]">
                  Presets fill identity and category. {subCurrency === 'USD' ? 'The price is an example — verify it before saving.' : `Enter the current price in ${subCurrency}.`}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-3.5 px-[22px] pb-[22px]">
        <div>
          <Label htmlFor={`${id}-name`}>Service name</Label>
          <input id={`${id}-name`} ref={nameRef} type="text" value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="Netflix, Spotify…" className="input-base" required autoComplete="off" />
        </div>

        <div className="grid grid-cols-2 gap-[11px]">
          <div>
            <Label htmlFor={`${id}-amount`}>{isReminderKind ? `Price paid (${sym})` : `Amount (${sym})`}</Label>
            <input id={`${id}-amount`} type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="9.99" step="0.01" min="0" className="input-base font-figure" required />
          </div>
          <div>
            <Label htmlFor={`${id}-currency`}>Currency</Label>
            <select id={`${id}-currency`} value={subCurrency} onChange={e => set('currency', e.target.value)} className="input-base" title="The money this subscription is billed in — totals convert to your display currency">
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
            </select>
          </div>
        </div>

        {isReminderKind ? (
          <div className="grid grid-cols-2 gap-[11px]">
            <div>
              <Label htmlFor={`${id}-start`}>Purchased on</Label>
              <input id={`${id}-start`} type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} className="input-base font-figure" />
            </div>
            <div>
              <Label htmlFor={`${id}-end`}>Ends on</Label>
              <input id={`${id}-end`} type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} className="input-base font-figure" required title="When this purchase runs out — you'll see a countdown and get a reminder" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-[11px]">
            <div>
              <Label htmlFor={`${id}-cycle`}>Cycle</Label>
              <select id={`${id}-cycle`} value={form.cycle} onChange={e => set('cycle', e.target.value)} className="input-base">{CYCLES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            </div>
            <div>
              <Label htmlFor={`${id}-billing`}>Next billing</Label>
              <input id={`${id}-billing`} type="date" value={form.billingDate} onChange={e => set('billingDate', e.target.value)} className="input-base font-figure" required title="Date of the next scheduled bill or original billing anchor" />
            </div>
          </div>
        )}

        <div>
          <Label htmlFor={`${id}-category`}>Category</Label>
          <select id={`${id}-category`} value={form.category} onChange={e => { categoryEditedRef.current = true; set('category', e.target.value) }} className="input-base">{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </div>

        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex w-full items-center justify-center gap-1.5 py-1.5 text-[11.5px] text-[rgba(242,240,234,0.45)] transition-colors hover:text-[rgba(242,240,234,0.7)]">
          {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {showAdvanced ? 'Fewer options' : isReminderKind ? 'More options — payment, tags, notes' : 'More options — start date, trial, payment, notes'}
        </button>

        <AnimatePresence>
          {showAdvanced && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="space-y-3.5 overflow-hidden">
              <div className="grid grid-cols-2 gap-[11px]">
                {!isReminderKind && <div><Label htmlFor={`${id}-start`}>Start date</Label><input id={`${id}-start`} type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} className="input-base font-figure" /></div>}
                <div className={isReminderKind ? 'col-span-2' : undefined}><Label htmlFor={`${id}-payment`}>Payment</Label><select id={`${id}-payment`} value={form.payment} onChange={e => set('payment', e.target.value)} className="input-base">{PAYMENT_METHODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
              </div>
              {!isReminderKind && <div><Label htmlFor={`${id}-renewal`}>Renewal</Label><select id={`${id}-renewal`} value={form.renewal} onChange={e => set('renewal', e.target.value)} className="input-base"><option value="auto">Auto-renew</option><option value="manual">Manual</option></select></div>}
              {!isReminderKind && <label className="flex cursor-pointer items-center gap-2.5 py-1">
                <input
                  type="checkbox"
                  checked={form.isTrial}
                  onChange={e => {
                    const on = e.target.checked
                    set('isTrial', on)
                    // A trial without an end date can never warn — default to
                    // the billing date, which is when it would convert.
                    if (on && !form.trialEnd) set('trialEnd', form.billingDate || formatDateOnly(new Date()))
                  }}
                  className="h-4 w-4"
                />
                <span className="text-[13px] text-[rgba(242,240,234,0.75)]">Free trial ends</span>
                {form.isTrial && <input type="date" value={form.trialEnd} onChange={e => set('trialEnd', e.target.value)} className="input-base font-figure min-h-[38px] flex-1 py-1.5 text-xs" aria-label="Trial end date" />}
              </label>}
              {!isReminderKind && <label className="flex cursor-pointer items-center gap-2.5 py-1">
                <input type="checkbox" checked={form.isShared} onChange={e => set('isShared', e.target.checked)} className="h-4 w-4" />
                <span className="flex items-center gap-1.5 text-[13px] text-[rgba(242,240,234,0.75)]"><Users className="h-3 w-3" /> Shared</span>
                {form.isShared && (
                  <div className="flex flex-1 gap-1.5">
                    <input type="number" min="1" value={form.sharedN} onChange={e => set('sharedN', e.target.value)} aria-label="People sharing this subscription" placeholder="People" className="input-base font-figure min-h-[38px] w-16 py-1.5 text-xs" />
                    <input type="number" min="1" max="100" value={form.sharedPct} onChange={e => set('sharedPct', e.target.value)} aria-label="Your share percentage" placeholder="%" className="input-base font-figure min-h-[38px] w-16 py-1.5 text-xs" />
                    <span className="self-center text-[10.5px] text-[rgba(242,240,234,0.4)]">%</span>
                  </div>
                )}
              </label>}
              <div>
                <Label><Tag className="inline h-3 w-3" /> Tags</Label>
                <div className="flex min-h-[38px] flex-wrap gap-1 rounded-xl border border-[rgba(242,240,234,0.08)] bg-[rgba(242,240,234,0.045)] p-2">
                  {form.tags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[rgba(225,173,102,0.12)] px-2 py-0.5 text-[10.5px] font-medium text-[#facb8d]">
                      {tag}<button type="button" onClick={() => set('tags', form.tags.filter(t => t !== tag))} aria-label={`Remove tag ${tag}`} className="hover:text-(--app-text)"><X className="h-2.5 w-2.5" /></button>
                    </span>
                  ))}
                  <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={addTag} placeholder={form.tags.length ? '' : 'Type + Enter'} aria-label="Add tag" className="min-w-[60px] flex-1 bg-transparent text-xs text-[rgba(242,240,234,0.75)] outline-none placeholder:text-[rgba(242,240,234,0.3)]" />
                </div>
              </div>
              <div><Label htmlFor={`${id}-url`}><Link className="inline h-3 w-3" /> URL</Label><input id={`${id}-url`} type="text" inputMode="url" autoComplete="off" spellCheck={false} aria-invalid={Boolean(formError && form.url.trim() && !normalizeServiceUrl(form.url))} value={form.url} onChange={e => set('url', e.target.value)} placeholder="netflix.com" className="input-base" /></div>
              <div><Label htmlFor={`${id}-notes`}><FileText className="inline h-3 w-3" /> Notes</Label><textarea id={`${id}-notes`} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Plan details, cancellation date…" rows={3} className="input-base resize-none" /></div>
            </motion.div>
          )}
        </AnimatePresence>

        {formError && <p role="alert" className="rounded-xl border border-[#d99f8b]/30 bg-[#d99f8b]/10 px-3 py-2 text-xs leading-5 text-[#edb9a6]">{formError}</p>}
        <div className="form-actions flex gap-2.5 pt-1">
          <button type="submit" disabled={!canSubmit} className="btn btn-primary min-h-[42px] flex-[2]">
            <Plus className="h-4 w-4" />
            {isEdit ? 'Save changes' : isReminderKind ? 'Add reminder' : 'Add subscription'}
          </button>
          {isEdit && onCancelEdit && (
            <button type="button" onClick={onCancelEdit} className="btn btn-secondary min-h-[42px] flex-1">
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function Label({ children, htmlFor }) {
  return <label htmlFor={htmlFor} className="field-label">{children}</label>
}
