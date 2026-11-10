import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, Plus, LayoutDashboard, List, BellRing, BarChart3, CalendarDays, Settings, CornerDownLeft } from 'lucide-react'
import { getCategoryById } from '../utils/categories'
import { formatMoney } from '../utils/currencies'
import { getEffectiveMonthlyCost, getReminderDaysLeft, isReminder } from '../utils/stats'
import ServiceMark from './ServiceMark'
import Presence, { leaving, useIsPresent } from './Presence'
import useModal from '../hooks/useModal'

const COMMANDS = [
  { id: 'nav-track', label: 'Overview', icon: LayoutDashboard, tab: 'track', group: 'Go to' },
  { id: 'nav-list', label: 'Subscriptions', icon: List, tab: 'list', group: 'Go to' },
  { id: 'nav-reminders', label: 'Reminders', icon: BellRing, tab: 'reminders', group: 'Go to' },
  { id: 'nav-charts', label: 'Insights', icon: BarChart3, tab: 'charts', group: 'Go to' },
  { id: 'nav-calendar', label: 'Calendar', icon: CalendarDays, tab: 'calendar', group: 'Go to' },
  { id: 'nav-settings', label: 'Settings', icon: Settings, tab: 'settings', group: 'Go to' },
  { id: 'add-recurring', label: 'Add subscription', sublabel: 'A plan that renews on a cycle', icon: Plus, add: 'recurring', group: 'Actions', keywords: 'new create add' },
  { id: 'add-reminder', label: 'Add reminder', sublabel: 'A one-time purchase with an end date', icon: Plus, add: 'reminder', group: 'Actions', keywords: 'new create add' },
]

const MAX_RECORDS = 6

function subSublabel(sub, baseCurrency) {
  const cat = getCategoryById(sub.category)
  if (isReminder(sub)) {
    const days = getReminderDaysLeft(sub)
    const phrase = sub.scheduleVerified === false ? 'end date unverified' : days == null ? 'no end date' : days < 0 ? 'expired' : days === 0 ? 'ends today' : `ends in ${days}d`
    return `Reminder · ${cat.label} · ${phrase}`
  }
  return `${cat.label} · ${formatMoney(getEffectiveMonthlyCost(sub), sub.currency || baseCurrency)}/mo`
}

export default function CommandPalette({ open, ...props }) {
  return (
    <Presence show={open} exitMs={140}>
      <PaletteDialog {...props} />
    </Presence>
  )
}

// Mounted fresh each time the palette opens, so the query and selection
// always start clean without a reset effect.
function PaletteDialog({ onClose, subs, currency, onSwitchTab, onViewDetail, onAdd }) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  // While the palette fades out it still covers the page; let clicks through.
  const isPresent = useIsPresent()
  useModal(panelRef, { active: isPresent, onClose, initialFocusRef: inputRef })

  const groups = useMemo(() => {
    const q = query.toLowerCase().trim()
    const out = []

    if (q) {
      const matches = subs.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.notes && s.notes.toLowerCase().includes(q)) ||
        (s.tags && s.tags.some(t => t.toLowerCase().includes(q))) ||
        getCategoryById(s.category).label.toLowerCase().includes(q)
      )
      // Name matches first: a search for "net" should offer Netflix before a
      // record that merely mentions it in a note.
      matches.sort((a, b) => Number(b.name.toLowerCase().includes(q)) - Number(a.name.toLowerCase().includes(q)))
      const records = matches.slice(0, MAX_RECORDS).map(s => ({
        id: `sub-${s.id}`,
        label: s.name,
        sublabel: subSublabel(s, currency),
        sub: s,
      }))
      if (records.length) out.push({ title: 'Records', items: records })
    }

    for (const title of ['Go to', 'Actions']) {
      const items = COMMANDS.filter(command => command.group === title
        && (!q || `${command.label} ${command.group} ${command.keywords || ''}`.toLowerCase().includes(q)))
      if (items.length) out.push({ title, items })
    }
    return out
  }, [query, subs, currency])

  const results = useMemo(() => groups.flatMap(group => group.items), [groups])
  const activeIdx = Math.min(selectedIdx, Math.max(0, results.length - 1))
  const activeId = results[activeIdx] ? `cmd-option-${results[activeIdx].id}` : undefined

  function handleSelect(item) {
    if (item.sub) {
      // Searching for a record is a lookup, not an edit — land on its detail
      // drawer, which has Edit one click away.
      onViewDetail(item.sub)
    } else if (item.add) {
      onAdd?.(item.add)
    } else if (item.tab) {
      onSwitchTab(item.tab)
    }
    onClose()
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(results.length ? (activeIdx + 1) % results.length : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(results.length ? (activeIdx - 1 + results.length) % results.length : 0)
    } else if (e.key === 'Enter' && results[activeIdx]) {
      e.preventDefault()
      handleSelect(results[activeIdx])
    }
  }

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return (
    <div
      className="palette-backdrop z-[90]"
      {...leaving(isPresent)}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="palette"
      >
        <div className="palette-input">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search subscriptions or jump to a page"
            aria-label="Command palette search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="cmd-palette-results"
            aria-activedescendant={activeId}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>

        <div id="cmd-palette-results" className="palette-results" role={results.length ? 'listbox' : undefined} aria-label="Results">
          {results.length === 0 ? (
            <p className="palette-empty">Nothing matches &ldquo;{query}&rdquo;.</p>
          ) : groups.map(group => (
            <div key={group.title} role="group" aria-label={group.title}>
              <h3 aria-hidden="true">{group.title}</h3>
              {group.items.map(item => {
                const Icon = item.icon
                const isSelected = results[activeIdx] === item
                return (
                  <button
                    key={item.id}
                    id={`cmd-option-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    onClick={() => handleSelect(item)}
                    onMouseMove={() => { if (!isSelected) setSelectedIdx(results.indexOf(item)) }}
                    className="palette-item"
                  >
                    {item.sub
                      ? <ServiceMark sub={item.sub} size={34} />
                      : <span className="palette-icon"><Icon aria-hidden="true" /></span>}
                    <span className="palette-text">
                      <strong>{item.label}</strong>
                      {item.sublabel && <small>{item.sublabel}</small>}
                    </span>
                    <CornerDownLeft className="palette-enter" aria-hidden="true" />
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="palette-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>Enter</kbd> to open</span>
          <span><kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  )
}
