import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Archive, Check, Eye, MoreHorizontal, Pause, Pencil, Play,
  Plus, RotateCcw, Search, SlidersHorizontal, Trash2, X,
} from 'lucide-react'
import { getCategoryById, CATEGORIES } from '../utils/categories'
import { formatMoney } from '../utils/currencies'
import { getEffectiveMonthlyCost, getDaysUntilBilling, getNextBillingDate } from '../utils/stats'
import { getSubscriptionStatus } from '../utils/subscriptions'
import { STATUS_STYLES, cycleLabel, relativeDay } from '../utils/labels'
import { daysBetween, formatDisplayDate, parseLocalDate } from '../utils/dates'
import ServiceMark from './ServiceMark'

const STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'trial', label: 'Trials' },
  { id: 'paused', label: 'Paused' },
  { id: 'canceled', label: 'Canceled' },
]

const SORT_OPTIONS = [
  { id: 'due', label: 'Next renewal' },
  { id: 'name', label: 'Name' },
  { id: 'price-desc', label: 'Monthly cost: high to low' },
  { id: 'price-asc', label: 'Monthly cost: low to high' },
]
const VALID_SORTS = new Set(SORT_OPTIONS.map(option => option.id))
const VALID_STATUS = new Set(STATUS_TABS.map(tab => tab.id))

const LIST_VIEW_KEY = 'st-list-view'

function readListView() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(LIST_VIEW_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return {
      ...parsed,
      search: typeof parsed.search === 'string' ? parsed.search : '',
      categoryFilter: CATEGORIES.some(c => c.id === parsed.categoryFilter) ? parsed.categoryFilter : 'all',
      cycleFilter: ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly'].includes(parsed.cycleFilter) ? parsed.cycleFilter : 'all',
      renewalFilter: ['auto', 'manual'].includes(parsed.renewalFilter) ? parsed.renewalFilter : 'all',
    }
  } catch { return {} }
}

function renewalTimestamp(sub) {
  const status = getSubscriptionStatus(sub)
  const value = status === 'trial' && sub.trialEnd
    ? parseLocalDate(sub.trialEnd)
    : status === 'canceled'
      ? parseLocalDate(sub.canceledAt)
      : getNextBillingDate(sub)
  return value?.getTime?.() || Number.MAX_SAFE_INTEGER
}

function renewalInfo(sub) {
  const status = getSubscriptionStatus(sub)
  if (status === 'canceled') {
    return {
      primary: '—',
      secondary: sub.canceledAt ? `Canceled ${formatDisplayDate(sub.canceledAt)}` : 'Canceled',
    }
  }

  if (status === 'trial' && sub.trialEnd) {
    const end = parseLocalDate(sub.trialEnd)
    const days = end ? daysBetween(new Date(), end) : null
    return {
      primary: formatDisplayDate(end, { month: 'short', day: 'numeric', year: 'numeric' }),
      secondary: days == null ? 'Trial ending' : days < 0 ? 'Trial ended' : days === 0 ? 'Ends today' : days === 1 ? 'Ends tomorrow' : `Ends in ${days} days`,
    }
  }

  const next = getNextBillingDate(sub)
  const days = getDaysUntilBilling(sub)
  return {
    primary: formatDisplayDate(next, { month: 'short', day: 'numeric', year: 'numeric' }),
    secondary: status === 'paused' ? 'Schedule paused' : relativeDay(days),
    overdue: status === 'active' && days < 0,
  }
}

export default function SubscriptionList({
  subs, currency, toBase, onEdit, onDelete, onTogglePause, onMarkPaid, onReactivate,
  onViewDetail, onBulkPause, onBulkResume, onBulkDelete, onBulkReactivate, onAdd,
}) {
  // Cross-currency safety: sorting and totals compare in the base currency.
  const inBase = useMemo(() => toBase || (amount => amount), [toBase])
  const initialView = useMemo(readListView, [])
  const [search, setSearch] = useState(initialView.search || '')
  // Guard the persisted status too — a value written by an older build
  // (e.g. 'all') would make STATUS_STYLES[statusFilter] undefined and crash.
  const [statusFilter, setStatusFilter] = useState(VALID_STATUS.has(initialView.statusFilter) ? initialView.statusFilter : 'active')
  const [categoryFilter, setCategoryFilter] = useState(initialView.categoryFilter || 'all')
  const [cycleFilter, setCycleFilter] = useState(initialView.cycleFilter || 'all')
  const [renewalFilter, setRenewalFilter] = useState(initialView.renewalFilter || 'all')
  // Guard the persisted sort — a session saved before an option was removed
  // would otherwise leave the select showing nothing.
  const [sort, setSort] = useState(VALID_SORTS.has(initialView.sort) ? initialView.sort : 'due')
  const [selected, setSelected] = useState(() => new Set())
  const [activeMenu, setActiveMenu] = useState(null)
  const [activeRow, setActiveRow] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    const ids = new Set(subs.map(sub => sub.id))
    setSelected(previous => {
      const next = new Set([...previous].filter(id => ids.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [subs])

  useEffect(() => {
    function closeMenu(event) {
      if (!event.target.closest('[data-subscription-menu]')) setActiveMenu(null)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setActiveMenu(null)
    }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(LIST_VIEW_KEY, JSON.stringify({ search, statusFilter, categoryFilter, cycleFilter, renewalFilter, sort }))
    } catch { /* session persistence is a convenience only */ }
  }, [search, statusFilter, categoryFilter, cycleFilter, renewalFilter, sort])

  const statusCounts = useMemo(() => {
    const counts = { active: 0, trial: 0, paused: 0, canceled: 0 }
    subs.forEach(sub => { counts[getSubscriptionStatus(sub)] += 1 })
    return counts
  }, [subs])

  const activeCategories = useMemo(() => {
    const ids = new Set(subs.map(sub => sub.category))
    return CATEGORIES.filter(category => ids.has(category.id))
  }, [subs])

  const activeCycles = useMemo(() => {
    return [...new Set(subs.map(sub => sub.cycle).filter(Boolean))]
  }, [subs])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = subs.filter(sub => {
      const matchesSearch = !query
        || sub.name.toLowerCase().includes(query)
        || sub.notes?.toLowerCase().includes(query)
        || sub.tags?.some(tag => tag.toLowerCase().includes(query))
        || getCategoryById(sub.category).label.toLowerCase().includes(query)
      return getSubscriptionStatus(sub) === statusFilter
        && matchesSearch
        && (categoryFilter === 'all' || sub.category === categoryFilter)
        && (cycleFilter === 'all' || sub.cycle === cycleFilter)
        && (renewalFilter === 'all' || sub.renewal === renewalFilter)
    })

    list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'price-desc') return inBase(getEffectiveMonthlyCost(b), b) - inBase(getEffectiveMonthlyCost(a), a)
      if (sort === 'price-asc') return inBase(getEffectiveMonthlyCost(a), a) - inBase(getEffectiveMonthlyCost(b), b)
      return renewalTimestamp(a) - renewalTimestamp(b)
    })
    return list
  }, [subs, search, statusFilter, categoryFilter, cycleFilter, renewalFilter, sort, inBase])

  const activeCommitment = useMemo(() => subs
    .filter(sub => getSubscriptionStatus(sub) === 'active')
    .reduce((total, sub) => total + inBase(getEffectiveMonthlyCost(sub), sub), 0), [subs, inBase])
  const afterTrials = useMemo(() => activeCommitment + subs
    .filter(sub => getSubscriptionStatus(sub) === 'trial')
    .reduce((total, sub) => total + inBase(getEffectiveMonthlyCost(sub), sub), 0), [subs, activeCommitment, inBase])

  const selectedIds = useMemo(() => [...selected], [selected])
  const allVisibleSelected = filtered.length > 0 && filtered.every(sub => selected.has(sub.id))
  const hasFilters = search || categoryFilter !== 'all' || cycleFilter !== 'all' || renewalFilter !== 'all' || sort !== 'due'

  function resetFilters() {
    setSearch('')
    setCategoryFilter('all')
    setCycleFilter('all')
    setRenewalFilter('all')
    setSort('due')
  }

  function toggleSelected(id) {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected(previous => {
      const next = new Set(previous)
      if (allVisibleSelected) filtered.forEach(sub => next.delete(sub.id))
      else filtered.forEach(sub => next.add(sub.id))
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function openDetail(sub) {
    setActiveRow(sub.id)
    onViewDetail?.(sub)
  }

  return (
    <section aria-labelledby="subscriptions-heading" className="flex flex-col gap-[15px]">
      <h1 id="subscriptions-heading" className="sr-only">Subscriptions</h1>
      <div className="flex flex-wrap items-center justify-between gap-3.5">
        <p className="text-[13px] text-[rgba(242,240,234,0.48)]">
          {subs.length} {subs.length === 1 ? 'subscription' : 'subscriptions'}
          <span aria-hidden="true"> · </span>{formatMoney(activeCommitment, currency)}/mo commitment
          {statusCounts.trial > 0 && <><span aria-hidden="true"> · </span>{formatMoney(afterTrials, currency)}/mo after trials</>}
        </p>
        <div role="group" aria-label="Subscription status filter" className="subscription-status-tabs inline-flex gap-[3px] rounded-full border border-[rgba(242,240,234,0.06)] bg-[rgba(242,240,234,0.045)] p-1">
          {STATUS_TABS.map(tab => {
            const isActive = statusFilter === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => { setStatusFilter(tab.id); clearSelection(); setActiveMenu(null) }}
                className={`min-h-8 whitespace-nowrap rounded-full px-4 text-[12.5px] transition-colors ${isActive ? 'bg-[rgba(225,173,102,0.16)] font-semibold text-[#facb8d]' : 'text-[rgba(242,240,234,0.55)] hover:text-[rgba(242,240,234,0.8)]'}`}
              >
                {tab.label} ({statusCounts[tab.id]})
              </button>
            )
          })}
        </div>
      </div>

      <div className="glass flex flex-col gap-[11px] px-[18px] py-3.5">
        <div className="flex flex-col gap-[11px] lg:flex-row lg:flex-wrap lg:items-end">
          <label className="block min-w-[200px] flex-1">
            <span className="field-label">Search</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgba(242,240,234,0.35)]" />
              <input
                id="subscription-search"
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search subscriptions…"
                className="input-base input-with-icon text-[13px]"
              />
            </span>
          </label>

          <button type="button" className="btn btn-secondary lg:hidden" aria-expanded={filtersOpen} aria-controls="subscription-filters" onClick={() => setFiltersOpen(open => !open)}>
            <SlidersHorizontal className="h-4 w-4" /> {filtersOpen ? 'Hide filters' : 'Filters & sort'}{hasFilters ? ' · active' : ''}
          </button>
          <div id="subscription-filters" className={`subscription-filters ${filtersOpen ? 'grid' : 'hidden'} grid-cols-2 gap-[11px] lg:flex lg:flex-wrap lg:items-end`}>
          <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter}>
            <option value="all">All categories</option>
            {activeCategories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
          </FilterSelect>
          <FilterSelect label="Billing cycle" value={cycleFilter} onChange={setCycleFilter}>
            <option value="all">All cycles</option>
            {activeCycles.map(cycle => <option key={cycle} value={cycle}>{cycleLabel(cycle)}</option>)}
          </FilterSelect>
          <FilterSelect label="Renewal" value={renewalFilter} onChange={setRenewalFilter}>
            <option value="all">All renewals</option>
            <option value="auto">Auto-renew</option>
            <option value="manual">Manual</option>
          </FilterSelect>
          <FilterSelect label="Sort by" value={sort} onChange={setSort} wide>
            {SORT_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </FilterSelect>
          <button
            type="button"
            onClick={resetFilters}
            disabled={!hasFilters}
            className="btn btn-ghost min-h-11 text-[12.5px]"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-[11.5px] text-[rgba(242,240,234,0.42)]">
          <span>Showing {filtered.length} of {statusCounts[statusFilter]} {STATUS_STYLES[statusFilter].label.toLowerCase()}</span>
          {filtered.length > 0 && (
            <button type="button" onClick={toggleAllVisible} className="text-[11.5px] text-[#e1ad66] transition-colors hover:text-[#facb8d]">
              {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="flex flex-wrap items-center gap-[9px] rounded-full border border-[rgba(225,173,102,0.28)] bg-[rgba(182,130,53,0.08)] py-[7px] pl-[18px] pr-[9px]"
          >
            <span className="mr-auto text-[13px] text-[#facb8d]">{selectedIds.length} selected</span>
            {/* Selection is cleared when the status tab changes, so every
                selected record shares the current tab's lifecycle state —
                offer only the actions that make sense for it. */}
            {statusFilter === 'canceled' ? (
              <>
                <button onClick={() => { onBulkReactivate?.(selectedIds); clearSelection() }} className="bulk-action"><RotateCcw className="h-3.5 w-3.5" /> Reactivate</button>
                <button onClick={async () => { if (await onBulkDelete?.(selectedIds)) clearSelection() }} className="btn btn-danger btn-sm"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
              </>
            ) : (
              <>
                {statusFilter === 'paused'
                  ? <button onClick={() => { onBulkResume?.(selectedIds); clearSelection() }} className="bulk-action"><Play className="h-3.5 w-3.5" /> Resume</button>
                  : <button onClick={() => { onBulkPause?.(selectedIds); clearSelection() }} className="bulk-action"><Pause className="h-3.5 w-3.5" /> Pause</button>}
                <button onClick={async () => { if (await onBulkDelete?.(selectedIds)) clearSelection() }} className="btn btn-danger btn-sm"><Archive className="h-3.5 w-3.5" /> Archive</button>
              </>
            )}
            <button onClick={clearSelection} className="btn btn-ghost btn-icon" aria-label="Clear selection"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {filtered.length === 0 ? (
        <EmptyState
          hasSubscriptions={subs.length > 0}
          statusLabel={STATUS_STYLES[statusFilter].label.toLowerCase()}
          hasFilters={Boolean(hasFilters)}
          onReset={resetFilters}
          onAdd={onAdd}
        />
      ) : (
        <>
          <div className="glass hidden overflow-visible md:block">
            <table className="w-full border-collapse text-left text-[13px]">
              <caption className="sr-only">Filtered subscription library</caption>
              <thead>
                <tr className="font-figure border-b border-[rgba(242,240,234,0.08)] text-[10.5px] font-medium uppercase tracking-[0.08em] text-[rgba(242,240,234,0.42)]">
                  <th scope="col" className="w-12 py-3 pl-[18px] pr-2">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="h-4 w-4" aria-label="Select all visible subscriptions" />
                  </th>
                  <th scope="col" className="px-2 py-3 font-medium">Subscription</th>
                  <th scope="col" className="px-2 py-3 font-medium">Status</th>
                  <th scope="col" className="px-2 py-3 font-medium">Next renewal</th>
                  <th scope="col" className="hidden px-2 py-3 font-medium lg:table-cell">Cycle</th>
                  <th scope="col" className="px-2 py-3 font-medium">Monthly</th>
                  <th scope="col" className="w-14 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(sub => (
                  <DesktopRow
                    key={sub.id}
                    sub={sub}
                    currency={currency}
                    toBase={inBase}
                    selected={selected.has(sub.id)}
                    active={activeRow === sub.id}
                    menuOpen={activeMenu === sub.id}
                    onToggleSelected={() => toggleSelected(sub.id)}
                    onOpen={() => openDetail(sub)}
                    onToggleMenu={() => setActiveMenu(activeMenu === sub.id ? null : sub.id)}
                    onCloseMenu={() => setActiveMenu(null)}
                    onEdit={() => onEdit?.(sub)}
                    onDelete={() => onDelete?.(sub.id)}
                    onTogglePause={() => onTogglePause?.(sub.id)}
                    onMarkPaid={() => onMarkPaid?.(sub.id)}
                    onReactivate={() => onReactivate?.(sub.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="glass overflow-visible md:hidden">
            {filtered.map(sub => (
              <MobileRow
                key={sub.id}
                sub={sub}
                currency={currency}
                toBase={inBase}
                selected={selected.has(sub.id)}
                active={activeRow === sub.id}
                menuOpen={activeMenu === sub.id}
                onToggleSelected={() => toggleSelected(sub.id)}
                onOpen={() => openDetail(sub)}
                onToggleMenu={() => setActiveMenu(activeMenu === sub.id ? null : sub.id)}
                onCloseMenu={() => setActiveMenu(null)}
                onEdit={() => onEdit?.(sub)}
                onDelete={() => onDelete?.(sub.id)}
                onTogglePause={() => onTogglePause?.(sub.id)}
                onMarkPaid={() => onMarkPaid?.(sub.id)}
                onReactivate={() => onReactivate?.(sub.id)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function FilterSelect({ label, value, onChange, children, wide }) {
  return (
    <label className={`block ${wide ? 'lg:w-[190px]' : 'lg:w-[146px]'}`}>
      <span className="field-label">{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className="input-base text-[13px]">
        {children}
      </select>
    </label>
  )
}

function StatusBadge({ status }) {
  const style = STATUS_STYLES[status]
  return (
    <span className="status-pill" style={{ background: style.bg, color: style.color }}>
      <i aria-hidden="true" />{style.label}
    </span>
  )
}

function DesktopRow({ sub, currency, toBase, selected, active, menuOpen, onToggleSelected, onOpen, onToggleMenu, onCloseMenu, onEdit, onDelete, onTogglePause, onMarkPaid, onReactivate }) {
  const status = getSubscriptionStatus(sub)
  const info = renewalInfo(sub)
  const monthly = getEffectiveMonthlyCost(sub)
  const subCurrency = sub.currency || currency
  const category = getCategoryById(sub.category)

  return (
    <tr
      className={`border-b border-[rgba(242,240,234,0.05)] transition-colors last:border-0 ${active ? 'bg-[rgba(225,173,102,0.08)]' : selected ? 'bg-[rgba(225,173,102,0.05)]' : 'hover:bg-[rgba(242,240,234,0.028)]'}`}
    >
      <td className="py-3.5 pl-[18px] pr-2 align-middle">
        <input type="checkbox" checked={selected} onChange={onToggleSelected} className="h-4 w-4" aria-label={`Select ${sub.name}`} />
      </td>
      <td className="px-2 py-3.5 align-middle">
        <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-offset-4">
          <ServiceMark sub={sub} />
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold text-(--app-text)">{sub.name}</span>
            <span className="cat-label truncate">{category.label}</span>
          </span>
        </button>
      </td>
      <td className="px-2 py-3.5 align-middle"><StatusBadge status={status} /></td>
      <td className="px-2 py-3.5 align-middle">
        <span className="block text-[rgba(242,240,234,0.82)]">{info.primary}</span>
        <span className="block text-[11px]" style={{ color: info.overdue ? '#d99f8b' : 'rgba(242,240,234,0.42)' }}>{info.secondary}</span>
      </td>
      <td className="hidden px-2 py-3.5 text-[rgba(242,240,234,0.6)] lg:table-cell">{cycleLabel(sub.cycle)}</td>
      <td className="px-2 py-3.5 align-middle">
        {/* Native currency first; the ≈ line translates it into the display
            currency so mixed-currency libraries stay comparable. */}
        <span className="font-figure block font-semibold text-(--app-text)">{formatMoney(monthly, subCurrency)}</span>
        {subCurrency !== currency
          ? <span className="block text-[10.5px] text-[rgba(242,240,234,0.38)]">≈ {formatMoney(toBase(monthly, sub), currency)}/mo</span>
          : sub.cycle !== 'monthly' && <span className="block text-[10.5px] text-[rgba(242,240,234,0.38)]">monthly equivalent</span>}
      </td>
      <td className="relative px-3 py-3.5 text-right align-middle">
        <MoreMenu
          sub={sub} status={status} open={menuOpen} onToggle={onToggleMenu} onClose={onCloseMenu}
          onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onTogglePause={onTogglePause}
          onMarkPaid={onMarkPaid} onReactivate={onReactivate}
        />
      </td>
    </tr>
  )
}

function MobileRow({ sub, currency, toBase, selected, active, menuOpen, onToggleSelected, onOpen, onToggleMenu, onCloseMenu, onEdit, onDelete, onTogglePause, onMarkPaid, onReactivate }) {
  const status = getSubscriptionStatus(sub)
  const info = renewalInfo(sub)
  const subCurrency = sub.currency || currency
  const category = getCategoryById(sub.category)

  return (
    <article className={`relative border-b border-[rgba(242,240,234,0.05)] p-3.5 last:border-0 ${active ? 'bg-[rgba(225,173,102,0.08)]' : selected ? 'bg-[rgba(225,173,102,0.05)]' : ''}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggleSelected} className="mt-3 h-4 w-4 flex-shrink-0" aria-label={`Select ${sub.name}`} />
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ServiceMark sub={sub} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-(--app-text)">{sub.name}</span>
            <span className="cat-label truncate">{category.label} · {cycleLabel(sub.cycle)}</span>
          </span>
        </button>
        <MoreMenu
          sub={sub} status={status} open={menuOpen} onToggle={onToggleMenu} onClose={onCloseMenu}
          onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onTogglePause={onTogglePause}
          onMarkPaid={onMarkPaid} onReactivate={onReactivate}
        />
      </div>
      <button type="button" onClick={onOpen} className="mt-3 grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 pl-7 text-left">
        <StatusBadge status={status} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-[rgba(242,240,234,0.82)]">{info.primary}</span>
          <span className="block truncate text-[11px]" style={{ color: info.overdue ? '#d99f8b' : 'rgba(242,240,234,0.42)' }}>{info.secondary}</span>
        </span>
        <span className="font-figure text-sm font-semibold text-(--app-text)">
          {formatMoney(getEffectiveMonthlyCost(sub), subCurrency)}<span className="font-sans text-xs font-normal text-[rgba(242,240,234,0.42)]">/mo</span>
          {subCurrency !== currency && <span className="block text-right font-sans text-[10px] font-normal text-[rgba(242,240,234,0.38)]">≈ {formatMoney(toBase(getEffectiveMonthlyCost(sub), sub), currency)}</span>}
        </span>
      </button>
    </article>
  )
}

function MoreMenu({ sub, status, open, onToggle, onClose, onOpen, onEdit, onDelete, onTogglePause, onMarkPaid, onReactivate }) {
  const menuRef = useRef(null)
  const triggerRef = useRef(null)

  // The ARIA menu pattern promises focus lands in the menu and arrow keys
  // move it; deliver that instead of leaving focus on the trigger.
  useEffect(() => {
    if (open) menuRef.current?.querySelector('button')?.focus()
  }, [open])

  function run(action) {
    onClose()
    triggerRef.current?.focus()
    action?.()
  }

  function onMenuKeyDown(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll('button') || [])]
    if (!items.length) return
    const index = items.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % items.length
      : (index - 1 + items.length) % items.length
    items[next].focus()
  }

  return (
    <div className="relative inline-block text-left" data-subscription-menu>
      <button
        ref={triggerRef}
        type="button"
        onClick={event => { event.stopPropagation(); onToggle() }}
        className="btn btn-secondary btn-icon"
        aria-label={`More actions for ${sub.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div ref={menuRef} role="menu" onKeyDown={onMenuKeyDown} className="absolute right-0 z-30 mt-1 w-[196px] overflow-hidden rounded-[14px] border border-[rgba(242,240,234,0.1)] bg-[#1b1a17] p-1.5 text-left shadow-[0_30px_80px_rgba(0,0,0,0.7)]">
          <MenuButton icon={Eye} label="View details" onClick={() => run(onOpen)} />
          {status === 'active' && <MenuButton icon={Check} label="Mark paid" onClick={() => run(onMarkPaid)} tone="gold" />}
          {status === 'canceled' && <MenuButton icon={RotateCcw} label="Reactivate" onClick={() => run(onReactivate)} tone="gold" />}
          {status !== 'canceled' && <MenuButton icon={status === 'paused' ? Play : Pause} label={status === 'paused' ? 'Resume' : 'Pause'} onClick={() => run(onTogglePause)} />}
          <MenuButton icon={Pencil} label="Edit" onClick={() => run(onEdit)} />
          <div className="mx-1 my-[5px] h-px bg-[rgba(242,240,234,0.07)]" />
          <MenuButton icon={status === 'canceled' ? Trash2 : Archive} label={status === 'canceled' ? 'Delete record' : 'Archive / delete'} onClick={() => run(onDelete)} tone="danger" />
        </div>
      )}
    </div>
  )
}

function MenuButton({ icon: Icon, label, onClick, tone }) {
  const toneClass = tone === 'danger' ? 'text-[#d99f8b]' : tone === 'gold' ? 'text-[#facb8d]' : 'text-(--app-text)'
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`flex min-h-10 w-full items-center gap-2.5 rounded-[9px] px-3 text-[13px] transition-colors hover:bg-[rgba(242,240,234,0.07)] ${toneClass}`}>
      <Icon className="h-4 w-4" />{label}
    </button>
  )
}

function EmptyState({ hasSubscriptions, statusLabel, hasFilters, onReset, onAdd }) {
  return (
    <div className="rounded-[20px] border border-dashed border-[rgba(242,240,234,0.16)] px-6 py-14 text-center">
      <p className="font-figure text-lg text-(--app-text)">{hasSubscriptions ? `No ${statusLabel} subscriptions found` : 'No subscriptions yet'}</p>
      <p className="mx-auto mt-2 max-w-[380px] text-[12.5px] leading-6 text-[rgba(242,240,234,0.45)]">
        {hasFilters ? 'Clear the current search and filters to see more records.' : hasSubscriptions ? 'Try another status tab or add a new subscription.' : 'Add your first subscription to start tracking renewals and payments.'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
        {hasFilters && <button onClick={onReset} className="btn btn-secondary"><RotateCcw className="h-4 w-4" /> Reset filters</button>}
        {onAdd && <button onClick={onAdd} className="btn btn-primary"><Plus className="h-4 w-4" /> Add subscription</button>}
      </div>
    </div>
  )
}
