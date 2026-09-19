import { useRef } from 'react'
import useModal from '../hooks/useModal'
import { motion, AnimatePresence } from 'framer-motion'
import { Keyboard, X } from 'lucide-react'
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
    { keys: ['/'], label: 'Jump to the subscription list' },
  ]},
  { section: 'Actions', items: [
    { keys: ['N'], label: 'New subscription (or reminder on the Reminders page)' },
    { keys: [MOD_KEY, 'K'], label: 'Command palette' },
    { keys: ['?'], label: 'Show this panel' },
    { keys: ['Esc'], label: 'Close dialogs' },
  ]},
]

export default function ShortcutsHelp({ open, onClose }) {
  const panelRef = useRef(null)
  useModal(panelRef, { active: open, onClose })
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={e => e.stopPropagation()}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-help-title"
            className="glass-deep rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-[rgba(242,240,234,0.07)] px-5 py-4">
              <div className="flex items-center gap-2">
                <Keyboard className="h-4 w-4 text-[#e1ad66]" />
                <h2 id="shortcuts-help-title" className="text-base font-semibold text-(--app-text)">Keyboard shortcuts</h2>
              </div>
              <button autoFocus onClick={onClose} className="btn btn-secondary btn-icon" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-5 px-5 py-4">
              {SHORTCUTS.map(sec => (
                <div key={sec.section}>
                  <p className="micro-label mb-2">{sec.section}</p>
                  <div className="space-y-1">
                    {sec.items.map(i => (
                      <div key={i.label} className="flex items-center justify-between border-b border-dotted border-[rgba(242,240,234,0.09)] py-1.5 last:border-0">
                        <span className="text-[12.5px] text-[rgba(242,240,234,0.72)]">{i.label}</span>
                        <div className="flex gap-1">
                          {i.keys.map(k => (
                            <kbd key={k} className="min-w-6 text-center">{k}</kbd>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
