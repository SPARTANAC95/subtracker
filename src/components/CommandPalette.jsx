import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Plus, LayoutDashboard, List, BellRing, BarChart3, CalendarDays, Settings, ArrowRight } from 'lucide-react'
import { getCategoryById } from '../utils/categories'
import { formatMoney } from '../utils/currencies'
import { getEffectiveMonthlyCost, getReminderDaysLeft, isReminder } from '../utils/stats'
import { getBrandColor, getServiceInitials } from '../utils/presets'
import useModal from '../hooks/useModal'

const NAV_ACTIONS = [
  { id: 'nav-track', label: 'Go to Overview', icon: LayoutDashboard, tab: 'track', type: 'nav' },
  { id: 'nav-list', label: 'Go to Subscriptions', icon: List, tab: 'list', type: 'nav' },
  { id: 'nav-reminders', label: 'Go to Reminders', icon: BellRing, tab: 'reminders', type: 'nav' },
  { id: 'nav-charts', label: 'Go to Insights', icon: BarChart3, tab: 'charts', type: 'nav' },
  { id: 'nav-calendar', label: 'Go to Calendar', icon: CalendarDays, tab: 'calendar', type: 'nav' },
  { id: 'nav-settings', label: 'Go to Settings', icon: Settings, tab: 'settings', type: 'nav' },
  { id: 'action-add', label: 'Add new subscription', icon: Plus, tab: 'track', type: 'action' },
]

function subSublabel(sub, baseCurrency) {
  const cat = getCategoryById(sub.category)
  if (isReminder(sub)) {
    const days = getReminderDaysLeft(sub)
    const phrase = days == null ? 'no end date' : days < 0 ? 'expired' : days === 0 ? 'ends today' : `ends in ${days}d`
    return `${cat.label} · reminder · ${phrase}`
  }
  return `${cat.label} · ${formatMoney(getEffectiveMonthlyCost(sub), sub.currency || baseCurrency)}/mo`
}

export default function CommandPalette({ open, onClose, subs, currency, onSwitchTab, onViewDetail, onAdd }) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  useModal(panelRef, { active: open, onClose, initialFocusRef: inputRef })
  const listRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    const items = []

    // Match subscriptions
    if (q) {
      const matchedSubs = subs.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.notes && s.notes.toLowerCase().includes(q)) ||
        (s.tags && s.tags.some(t => t.toLowerCase().includes(q))) ||
        getCategoryById(s.category).label.toLowerCase().includes(q)
      ).slice(0, 6)

      matchedSubs.forEach(s => {
        const brand = getBrandColor(s)
        items.push({
          id: `sub-${s.id}`,
          label: s.name,
          sublabel: subSublabel(s, currency),
          mark: getServiceInitials(s.name),
          iconColor: brand || '#e1ad66',
          iconBg: brand ? `${brand}22` : 'rgba(225,173,102,0.1)',
          type: 'sub',
          data: s,
        })
      })
    }

    // Match nav actions
    const matchedActions = NAV_ACTIONS.filter(a =>
      !q || a.label.toLowerCase().includes(q)
    )
    matchedActions.forEach(a => {
      items.push({
        id: a.id,
        label: a.label,
        sublabel: a.type === 'nav' ? 'Navigation' : 'Action',
        icon: a.icon,
        type: a.type,
        tab: a.tab,
      })
    })

    return items
  }, [query, subs, currency])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  function handleSelect(item) {
    if (item.type === 'sub') {
      // Searching for a record is a lookup, not an edit — land on its detail
      // drawer, which has Edit one click away.
      onViewDetail(item.data)
    } else if (item.id === 'action-add') {
      onAdd?.()
    } else if (item.tab) {
      onSwitchTab(item.tab)
    }
    onClose()
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      e.preventDefault()
      handleSelect(results[selectedIdx])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.children[selectedIdx]
    if (selected) selected.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 px-4 pt-[14vh]"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            onClick={e => e.stopPropagation()}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="w-full max-w-[560px] overflow-hidden rounded-[20px] border border-[rgba(242,240,234,0.11)] bg-[#151412] shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
          >
            {/* Search input */}
            <div className="flex items-center gap-[11px] border-b px-[18px] py-[15px]" style={{ borderColor: 'rgba(242,240,234,0.07)' }}>
              <Search className="h-4 w-4 flex-shrink-0 text-[rgba(242,240,234,0.4)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search subscriptions or jump to a page…"
                className="min-w-0 flex-1 bg-transparent text-[14.5px] text-(--app-text) outline-none placeholder:text-[rgba(242,240,234,0.3)]"
                aria-label="Command palette search"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls="cmd-palette-results"
                aria-activedescendant={results[selectedIdx] ? `cmd-option-${results[selectedIdx].id}` : undefined}
              />
              <kbd className="hidden sm:block">Esc</kbd>
            </div>

            {/* Results */}
            <div ref={listRef} id="cmd-palette-results" className="max-h-[340px] overflow-y-auto p-2" role={results.length ? 'listbox' : undefined}>
              {results.length === 0 ? (
                <p className="px-4 py-[26px] text-center text-[12.5px] text-[rgba(242,240,234,0.42)]">Nothing matches &ldquo;{query}&rdquo;.</p>
              ) : (
                results.map((item, idx) => {
                  const Icon = item.icon
                  const isSelected = idx === selectedIdx
                  return (
                    <button
                      key={item.id}
                      id={`cmd-option-${item.id}`}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={`cmd-item w-full text-left ${isSelected ? 'selected' : ''}`}
                    >
                      <span
                        className="font-figure grid h-[30px] w-[30px] flex-shrink-0 place-items-center rounded-[9px] text-[10.5px] font-semibold"
                        style={{
                          background: item.iconBg || 'rgba(242,240,234,0.06)',
                          color: item.iconColor || 'rgba(242,240,234,0.6)',
                        }}
                      >
                        {item.mark || (Icon ? <Icon className="h-3.5 w-3.5" /> : null)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] text-(--app-text)">{item.label}</span>
                        {item.sublabel && (
                          <span className="font-figure block truncate text-[10.5px] text-[rgba(242,240,234,0.4)]">{item.sublabel}</span>
                        )}
                      </span>
                      <ArrowRight className={`h-3.5 w-3.5 flex-shrink-0 text-[rgba(242,240,234,0.35)] transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                    </button>
                  )
                })
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center gap-4 border-t px-[18px] py-2.5 text-[10px] text-[rgba(242,240,234,0.35)]" style={{ borderColor: 'rgba(242,240,234,0.07)' }}>
              <span className="flex items-center gap-1.5"><kbd>↑↓</kbd> navigate</span>
              <span className="flex items-center gap-1.5"><kbd>↵</kbd> select</span>
              <span className="flex items-center gap-1.5"><kbd>Esc</kbd> close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
