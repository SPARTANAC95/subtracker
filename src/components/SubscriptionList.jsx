import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, Check, Eye, MoreHorizontal, Pause, Pencil, Play,
  Plus, RotateCcw, Search, SlidersHorizontal, Trash2, X,
} from 'lucide-react'
import { getCategoryById, CATEGORIES } from '../utils/categories'
import { formatMoney } from '../utils/currencies'
import { getEffectiveMonthlyCost, getDaysUntilBilling, getNextBillingDate } from '../utils/stats'
import { getSubscriptionStatus } from '../utils/subscriptions'
import { STATUS_STYLES, cycleLabel, plural, relativeDay } from '../utils/labels'
import { daysBetween, formatDisplayDate, parseLocalDate } from '../utils/dates'
import useMediaQuery, { WIDE_LAYOUT } from '../hooks/useMediaQuery'
import PageHeading from './PageHeading'
import ServiceMark from './ServiceMark'
import StatusBadge from './StatusBadge'

const STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'trial', label: 'Trials' },
  { id: 'paused', label: 'Paused' },
  { id: 'canceled', label: 'Canceled' },
]

const SORT_OPTIONS = [
  { id: 'due', label: 'Sort: next renewal' },
  { id: 'name', label: 'Sort: name' },
  { id: 'price-desc', label: 'Sort: cost, high to low' },
  { id: 'price-asc', label: 'Sort: cost, low to high' },
]
const VALID_SORTS = new Set(SORT_OPTIONS.map(option => option.id))
const VALID_STATUS = new Set(STATUS_TABS.map(tab => tab.id))

const LIST_VIEW_KEY = 'st-list-view'
const LONG_DATE = { month: 'short', day: 'numeric', year: 'numeric' }

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

// Each status tab already shows a single lifecycle state, so the badge
// reports where the record stands in its schedule instead — the same words
// the overview uses (Overdue, Due, Scheduled, Trial ends).
function renewalInfo(sub) {
  const status = getSubscriptionStatus(sub)
  if (status === 'canceled') {
    return {
      primary: '—',
      secondary: sub.canceledAt ? `Canceled ${formatDisplayDate(sub.canceledAt, LONG_DATE)}` : 'Canceled',
      badge: STATUS_STYLES.canceled,
    }
  }

  if (status === 'trial' && sub.trialEnd) {
    const end = parseLocalDate(sub.trialEnd)
    const days = end ? daysBetween(new Date(), end) : null
    const ended = days != null && days < 0
    return {
      primary: formatDisplayDate(end, LONG_DATE),
      secondary: days == null ? 'Trial ending' : ended ? 'Trial ended' : days === 0 ? 'Ends today' : days === 1 ? 'Ends tomorrow' : `Ends in ${days} days`,
      overdue: ended,
      badge: ended ? { label: 'Trial ended', tone: 'danger' } : { label: 'Trial ends', tone: 'accent' },
    }
  }

  const next = getNextBillingDate(sub)
  // No confirmed date (an imported record nobody has verified yet): say so
  // instead of inventing a schedule state.
  if (!next) {
    return {
      primary: 'Unverified',
      secondary: status === 'paused' ? 'Schedule paused' : 'Renewal date not confirmed',
      badge: status === 'paused' ? STATUS_STYLES.paused : { label: 'Unverified', tone: 'muted' },
    }
  }
  const days = getDaysUntilBilling(sub)
  const overdue = status === 'active' && days < 0
  return {
    primary: formatDisplayDate(next, LONG_DATE),
    secondary: status === 'paused' ? 'Schedule paused' : relativeDay(days),
    overdue,
    badge: status === 'paused' ? STATUS_STYLES.paused
      : status === 'trial' ? STATUS_STYLES.trial
      : overdue ? { label: 'Overdue', tone: 'danger' }
      : days <= 1 ? { label: 'Due', tone: 'warn' }
      : { label: 'Scheduled', tone: 'ok' },
  }
}

export default function SubscriptionList({
  subs, currency, toBase, activeId, onEdit, onDelete, onTogglePause, onMarkPaid, onReactivate,
  onViewDetail, onBulkPause, onBulkResume, onBulkDelete, onBulkReactivate, onAdd,
}) {
  // Cross-currency safety: sorting and totals compare in the base currency.
  const inBase = useMemo(() => toBase || (amount => amount), [toBase])
  const initialView = useMemo(readListView, [])
  const [search, setSearch] = useState(initialView.search || '')
  // Guard the persisted status too — a value written by an older build
  // (e.g. 'all') would make STATUS_STYLES[statusFilter] undefined and crash.
  const [statusFilter, setStatusFilter] = useState(VALID_STATUS.has(initialView.statusFilter) ? initialView.statusFilter : 'active')
  const [storedCategory, setCategoryFilter] = useState(initialView.categoryFilter || 'all')
  const [storedCycle, setCycleFilter] = useState(initialView.cycleFilter || 'all')
  const [renewalFilter, setRenewalFilter] = useState(initialView.renewalFilter || 'all')
  // Guard the persisted sort — a session saved before an option was removed
  // would otherwise leave the select showing nothing.
  const [sort, setSort] = useState(VALID_SORTS.has(initialView.sort) ? initialView.sort : 'due')
  const [selected, setSelected] = useState(() => new Set())
  const [activeMenu, setActiveMenu] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  // Only the layout that is on screen is built: a table on wide windows,
  // cards on narrow ones.
  const wide = useMediaQuery(WIDE_LAYOUT)

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

  // A remembered filter can outlive the records it referred to (the last
  // "Gaming" subscription was deleted, or a session was restored). The
  // select only lists values that still exist, so a stale one would filter
  // everything out while the control showed "All categories".
  const categoryFilter = activeCategories.some(category => category.id === storedCategory) ? storedCategory : 'all'
  const cycleFilter = activeCycles.includes(storedCycle) ? storedCycle : 'all'

  useEffect(() => {
    try {
      sessionStorage.setItem(LIST_VIEW_KEY, JSON.stringify({ search, statusFilter, categoryFilter, cycleFilter, renewalFilter, sort }))
    } catch { /* session persistence is a convenience only */ }
  }, [search, statusFilter, categoryFilter, cycleFilter, renewalFilter, sort])

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
  const estimatedCommitment = useMemo(() => subs
    .filter(sub => getSubscriptionStatus(sub) === 'active' && sub.amountVerified === false)
    .reduce((total, sub) => total + inBase(getEffectiveMonthlyCost(sub), sub), 0), [subs, inBase])
  const afterTrials = useMemo(() => activeCommitment + subs
    .filter(sub => getSubscriptionStatus(sub) === 'trial')
    .reduce((total, sub) => total + inBase(getEffectiveMonthlyCost(sub), sub), 0), [subs, activeCommitment, inBase])

  const selectedIds = useMemo(() => [...selected], [selected])
  const allVisibleSelected = filtered.length > 0 && filtered.every(sub => selected.has(sub.id))
  // Filters hide records; a sort order does not. Only the former should make
  // an empty list say "clear your filters".
  const isNarrowed = Boolean(search.trim()) || categoryFilter !== 'all' || cycleFilter !== 'all' || renewalFilter !== 'all'
  const canReset = isNarrowed || Boolean(search) || sort !== 'due'
  const statusLabel = STATUS_STYLES[statusFilter].label.toLowerCase()

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

  function rowProps(sub) {
    return {
      sub,
      currency,
      toBase: inBase,
      selected: selected.has(sub.id),
      active: activeId === sub.id,
      menuOpen: activeMenu === sub.id,
      onToggleSelected: () => toggleSelected(sub.id),
      onOpen: () => onViewDetail?.(sub),
      onToggleMenu: () => setActiveMenu(activeMenu === sub.id ? null : sub.id),
      onCloseMenu: () => setActiveMenu(null),
      onEdit: () => onEdit?.(sub),
      onDelete: () => onDelete?.(sub.id),
      onTogglePause: () => onTogglePause?.(sub.id),
      onMarkPaid: () => onMarkPaid?.(sub.id),
      onReactivate: () => onReactivate?.(sub.id),
    }
  }

  return (
    <section aria-labelledby="subscriptions-heading">
      <PageHeading title="Subscriptions" id="subscriptions-heading">
        {subs.length} {plural(subs.length, 'subscription')}
        <span aria-hidden="true"> · </span><span className="num">{formatMoney(activeCommitment, currency)}</span>/mo commitment
        {estimatedCommitment > 0 && <> (<span className="num">{formatMoney(estimatedCommitment, currency)}</span> of it unverified prices)</>}
        {statusCounts.trial > 0 && <><span aria-hidden="true"> · </span><span className="num">{formatMoney(afterTrials, currency)}</span>/mo after trials</>}
      </PageHeading>

      <div className="list-tools">
        <div role="group" aria-label="Subscription status filter" className="filter-tabs max-lg:grid max-lg:w-full max-lg:grid-cols-4">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={statusFilter === tab.id}
              onClick={() => { setStatusFilter(tab.id); clearSelection(); setActiveMenu(null) }}
            >
              {tab.label} <span className="num">({statusCounts[tab.id]})</span>
            </button>
          ))}
        </div>

        <div className="filter-group max-lg:w-full">
          <label className="tool-search max-lg:flex-1 lg:w-[200px]">
            <Search aria-hidden="true" />
            <input
              id="subscription-search"
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search subscriptions…"
              aria-label="Search this list"
            />
          </label>
          <button type="button" className="btn btn-sm lg:hidden" aria-expanded={filtersOpen} aria-controls="subscription-filters" onClick={() => setFiltersOpen(open => !open)}>
            <SlidersHorizontal aria-hidden="true" /> {filtersOpen ? 'Hide filters' : 'Filters & sort'}{canReset ? ' · on' : ''}
          </button>
          <div id="subscription-filters" className={`${filtersOpen ? 'grid' : 'hidden'} w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:items-center`}>
            <select className="tool-select" aria-label="Category" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
              <option value="all">All categories</option>
              {activeCategories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
            <select className="tool-select" aria-label="Billing cycle" value={cycleFilter} onChange={event => setCycleFilter(event.target.value)}>
              <option value="all">All cycles</option>
              {activeCycles.map(cycle => <option key={cycle} value={cycle}>{cycleLabel(cycle)}</option>)}
            </select>
            <select className="tool-select" aria-label="Renewal" value={renewalFilter} onChange={event => setRenewalFilter(event.target.value)}>
              <option value="all">All renewals</option>
              <option value="auto">Auto-renew</option>
              <option value="manual">Manual</option>
            </select>
            <select className="tool-select" aria-label="Sort by" value={sort} onChange={event => setSort(event.target.value)}>
              {SORT_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <button type="button" onClick={resetFilters} disabled={!canReset} className="btn btn-sm btn-ghost max-lg:col-span-2" title="Clear search, filters and sort">
              <RotateCcw aria-hidden="true" /> Reset
            </button>
          </div>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="bulk-bar">
          <span>{selectedIds.length} selected</span>
          {/* Selection is cleared when the status tab changes, so every
              selected record shares the current tab's lifecycle state —
              offer only the actions that make sense for it. */}
          {statusFilter === 'canceled' ? (
            <>
              <button type="button" onClick={() => { onBulkReactivate?.(selectedIds); clearSelection() }} className="btn btn-sm"><RotateCcw aria-hidden="true" /> Reactivate</button>
              <button type="button" onClick={async () => { if (await onBulkDelete?.(selectedIds)) clearSelection() }} className="btn btn-sm btn-danger"><Trash2 aria-hidden="true" /> Delete</button>
            </>
          ) : (
            <>
              {statusFilter === 'paused'
                ? <button type="button" onClick={() => { onBulkResume?.(selectedIds); clearSelection() }} className="btn btn-sm"><Play aria-hidden="true" /> Resume</button>
                : <button type="button" onClick={() => { onBulkPause?.(selectedIds); clearSelection() }} className="btn btn-sm"><Pause aria-hidden="true" /> Pause</button>}
              <button type="button" onClick={async () => { if (await onBulkDelete?.(selectedIds)) clearSelection() }} className="btn btn-sm btn-danger"><Archive aria-hidden="true" /> Archive</button>
            </>
          )}
          <button type="button" onClick={clearSelection} className="btn btn-icon" aria-label="Clear selection"><X aria-hidden="true" /></button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          hasSubscriptions={subs.length > 0}
          statusLabel={statusLabel}
          isNarrowed={isNarrowed}
          onReset={resetFilters}
          onAdd={onAdd}
        />
      ) : (
        <>
          <div className="list-meta">
            <span>Showing {filtered.length} of {statusCounts[statusFilter]} {statusLabel}</span>
            <button type="button" onClick={toggleAllVisible} className="text-link md:hidden">
              {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
            </button>
          </div>

          {wide ? (
            <table className="data-table">
              <caption className="sr-only">Filtered subscription library</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-9">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all visible subscriptions" />
                  </th>
                  <th scope="col">Subscription</th>
                  <th scope="col">Status</th>
                  <th scope="col">Next renewal</th>
                  <th scope="col" className="hidden xl:table-cell">Cycle</th>
                  <th scope="col" className="text-right">Monthly</th>
                  <th scope="col" className="w-12"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(sub => <DesktopRow key={sub.id} {...rowProps(sub)} />)}
              </tbody>
            </table>
          ) : (
            <div className="simple-list">
              {filtered.map(sub => <MobileRow key={sub.id} {...rowProps(sub)} />)}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function DesktopRow({ sub, currency, toBase, selected, active, menuOpen, onToggleSelected, onOpen, onToggleMenu, onCloseMenu, onEdit, onDelete, onTogglePause, onMarkPaid, onReactivate }) {
  const status = getSubscriptionStatus(sub)
  const info = renewalInfo(sub)
  const monthly = getEffectiveMonthlyCost(sub)
  const subCurrency = sub.currency || currency

  return (
    <tr className={active ? 'active' : selected ? 'selected' : undefined}>
      <td>
        <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label={`Select ${sub.name}`} />
      </td>
      <td className="max-w-0 w-[34%]">
        <button type="button" onClick={onOpen} className="row-title max-w-full">
          <ServiceMark sub={sub} />
          <span>
            <strong>{sub.name}</strong>
            <small>{getCategoryById(sub.category).label}</small>
          </span>
        </button>
      </td>
      <td><StatusBadge tone={info.badge.tone}>{info.badge.label}</StatusBadge></td>
      <td>
        <span className="num text-soft">{info.primary}</span>
        <span className={`sub ${info.overdue ? 'danger' : ''}`}>{info.secondary}</span>
      </td>
      <td className="hidden text-muted xl:table-cell">{cycleLabel(sub.cycle)}</td>
      <td className="text-right">
        {/* Native currency first; the ≈ line translates it into the display
            currency so mixed-currency libraries stay comparable. */}
        <span className="num font-[560]">{formatMoney(monthly, subCurrency)}</span>
        {sub.amountVerified === false
          ? <span className="sub">price estimate</span>
          : subCurrency !== currency
            ? <span className="sub num">≈ {formatMoney(toBase(monthly, sub), currency)}/mo</span>
            : sub.cycle !== 'monthly' && <span className="sub">monthly equivalent</span>}
      </td>
      <td className="text-right">
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
  const monthly = getEffectiveMonthlyCost(sub)
  const subCurrency = sub.currency || currency

  return (
    <article className={`rounded-[5px] px-1.5 py-3 ${active ? 'bg-[#a78bfa14]' : selected ? 'bg-[#a78bfa0a]' : ''}`}>
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label={`Select ${sub.name}`} />
        <button type="button" onClick={onOpen} className="row-title flex-1">
          <ServiceMark sub={sub} />
          <span>
            <strong>{sub.name}</strong>
            <small>{getCategoryById(sub.category).label} · {cycleLabel(sub.cycle)}</small>
          </span>
        </button>
        <MoreMenu
          sub={sub} status={status} open={menuOpen} onToggle={onToggleMenu} onClose={onCloseMenu}
          onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onTogglePause={onTogglePause}
          onMarkPaid={onMarkPaid} onReactivate={onReactivate}
        />
      </div>
      <button type="button" onClick={onOpen} tabIndex={-1} aria-hidden="true" className="mt-2.5 grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 pl-[27px] text-left">
        <StatusBadge tone={info.badge.tone}>{info.badge.label}</StatusBadge>
        <span className="min-w-0">
          <span className="num block truncate text-[12px] text-soft">{info.primary}</span>
          <span className={`block truncate text-[10.5px] ${info.overdue ? 'text-danger' : 'text-dim'}`}>{info.secondary}</span>
        </span>
        <span className="text-right">
          <span className="num text-[12.5px] font-[560]">{formatMoney(monthly, subCurrency)}<span className="font-normal text-dim">/mo</span></span>
          {sub.amountVerified === false
            ? <span className="block text-[10.5px] text-dim">price estimate</span>
            : subCurrency !== currency && <span className="num block text-[10.5px] text-dim">≈ {formatMoney(toBase(monthly, sub), currency)}</span>}
        </span>
      </button>
    </article>
  )
}

const MENU_HEIGHT = 250

function MoreMenu({ sub, status, open, onToggle, onClose, onOpen, onEdit, onDelete, onTogglePause, onMarkPaid, onReactivate }) {
  const menuRef = useRef(null)
  const triggerRef = useRef(null)
  const [above, setAbove] = useState(false)

  // The ARIA menu pattern promises focus lands in the menu and arrow keys
  // move it; deliver that instead of leaving focus on the trigger.
  useEffect(() => {
    if (open) menuRef.current?.querySelector('button')?.focus()
  }, [open])

  function toggle(event) {
    event.stopPropagation()
    // Rows near the bottom of the window open their menu upwards instead of
    // pushing it under the edge (or the mobile tab bar).
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect && !open) {
      const below = window.innerHeight - rect.bottom
      setAbove(below < MENU_HEIGHT + 70 && rect.top > MENU_HEIGHT)
    }
    onToggle()
  }

  function run(action) {
    onClose()
    triggerRef.current?.focus()
    action?.()
  }

  function onMenuKeyDown(event) {
    if (event.key === 'Tab') { onClose(); return }
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
    <div className="relative inline-block" data-subscription-menu>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="btn btn-icon"
        aria-label={`More actions for ${sub.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open && (
        <div ref={menuRef} role="menu" onKeyDown={onMenuKeyDown} className={`menu ${above ? 'above' : 'below'}`}>
          <MenuButton icon={Eye} label="View details" onClick={() => run(onOpen)} />
          {status === 'active' && <MenuButton icon={Check} label="Mark paid" onClick={() => run(onMarkPaid)} />}
          {status === 'canceled' && <MenuButton icon={RotateCcw} label="Reactivate" onClick={() => run(onReactivate)} />}
          {status !== 'canceled' && <MenuButton icon={status === 'paused' ? Play : Pause} label={status === 'paused' ? 'Resume' : 'Pause'} onClick={() => run(onTogglePause)} />}
          <MenuButton icon={Pencil} label="Edit" onClick={() => run(onEdit)} />
          <hr />
          <MenuButton icon={status === 'canceled' ? Trash2 : Archive} label={status === 'canceled' ? 'Delete record' : 'Archive as canceled'} onClick={() => run(onDelete)} danger />
        </div>
      )}
    </div>
  )
}

function MenuButton({ icon: Icon, label, onClick, danger }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={danger ? 'danger' : undefined}>
      <Icon aria-hidden="true" />{label}
    </button>
  )
}

function EmptyState({ hasSubscriptions, statusLabel, isNarrowed, onReset, onAdd }) {
  return (
    <div className="empty">
      <h2>{hasSubscriptions ? `No ${statusLabel} subscriptions found` : 'No subscriptions yet'}</h2>
      <p>
        {isNarrowed ? 'Clear the current search and filters to see more records.' : hasSubscriptions ? 'Try another status tab or add a new subscription.' : 'Add your first subscription to start tracking renewals and payments.'}
      </p>
      <div className="flex flex-wrap justify-center gap-2.5">
        {isNarrowed && <button type="button" onClick={onReset} className="btn"><RotateCcw aria-hidden="true" /> Reset filters</button>}
        {onAdd && <button type="button" onClick={onAdd} className="btn btn-primary"><Plus aria-hidden="true" /> Add subscription</button>}
      </div>
    </div>
  )
}
