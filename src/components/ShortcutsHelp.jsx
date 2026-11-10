import { useRef } from 'react'
import useModal from '../hooks/useModal'
import Presence, { leaving, useIsPresent } from './Presence'
import { X } from 'lucide-react'
import { MOD_KEY } from '../utils/labels'

// Keep this in sync with the keydown handler in App.jsx — it previously
// advertised a bulk-select mode (B / A / D) that was never implemented.
const SHORTCUTS = [
  { section: 'Navigation', items: [
    { keys: ['1'], label: 'Overview' },
    { keys: ['2'], label: 'Subscriptions' },
    { keys: ['3'], label: 'Reminders' },
    { keys: ['4'], label: 'Insights' },
    { keys: ['5'], label: 'Calendar' },
    { keys: ['6'], label: 'Settings' },
    { keys: ['/'], label: 'Search the subscription list' },
  ]},
  { section: 'Actions', items: [
    { keys: ['N'], label: 'New subscription (or reminder on the Reminders page)' },
    { keys: [MOD_KEY, 'K'], label: 'Command palette' },
    { keys: ['?'], label: 'Show this panel' },
    { keys: ['Esc'], label: 'Close dialogs' },
  ]},
]

export default function ShortcutsHelp({ open, onClose }) {
  return (
    <Presence show={open} exitMs={150}>
      <ShortcutsDialog onClose={onClose} />
    </Presence>
  )
}

function ShortcutsDialog({ onClose }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const isPresent = useIsPresent()
  useModal(panelRef, { active: isPresent, onClose, initialFocusRef: closeRef })
  return (
    <div
      className="modal-backdrop z-[85]"
      {...leaving(isPresent)}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-help-title"
        className="modal"
      >
        <div className="modal-head">
          <h2 id="shortcuts-help-title">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="btn btn-icon" aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body flex flex-col gap-5">
          {SHORTCUTS.map(sec => (
            <section key={sec.section} aria-label={sec.section}>
              <h3 className="mb-1 text-[11px] font-normal text-dim">{sec.section}</h3>
              {sec.items.map(item => (
                <div key={item.label} className="kv-row !items-center">
                  <span>{item.label}</span>
                  <span className="flex flex-none gap-1">
                    {item.keys.map(key => <kbd key={key}>{key}</kbd>)}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
