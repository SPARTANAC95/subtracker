import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import { X } from 'lucide-react'
import { ToastContext } from './toast-context'
import useModal from '../hooks/useModal'

// Dot tone per toast type (see `.status-dot` in index.css).
const DOT_TONES = {
  success: '',
  error: 'danger',
  warning: 'warn',
  info: 'accent',
}

let toastId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [confirmState, setConfirmState] = useState(null)
  const resolveRef = useRef(null)
  const timersRef = useRef(new Map())
  const dialogRef = useRef(null)

  const removeToast = useCallback((id) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((type, message, duration = 3000, opts = {}) => {
    const id = ++toastId
    setToasts(prev => [...prev.slice(-4), { id, type, message, duration, action: opts.action, actionLabel: opts.actionLabel }])
    if (duration > 0) {
      timersRef.current.set(id, window.setTimeout(() => removeToast(id), duration))
    }
    return id
  }, [removeToast])

  // Dismiss timers outlive their toast when one is closed by hand; clear the
  // whole set on unmount so nothing fires against a torn-down provider.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach(timer => window.clearTimeout(timer))
      timers.clear()
    }
  }, [])

  // opts: { okLabel, cancelLabel, tone } — tone 'primary' renders the bright
  // confirm button for non-destructive choices, default is the danger accent.
  // Resolves true (ok), false (cancel button), or null (dismissed via
  // Escape/backdrop) — callers that treat cancel as a real choice must
  // distinguish dismissal; `if (!ok)` callers abort on both, unchanged.
  const confirm = useCallback((message, description, opts = {}) => new Promise((resolve) => {
    resolveRef.current?.(null)
    resolveRef.current = resolve
    setConfirmState({ message, description, ...opts })
  }), [])

  const api = useMemo(() => ({
    success: (msg, dur, opts) => toast('success', msg, dur, opts),
    error: (msg, dur, opts) => toast('error', msg, dur ?? 5000, opts),
    warning: (msg, dur, opts) => toast('warning', msg, dur, opts),
    info: (msg, dur, opts) => toast('info', msg, dur, opts),
    remove: removeToast,
    confirm,
  }), [confirm, removeToast, toast])

  const handleConfirm = useCallback((result) => {
    resolveRef.current?.(result)
    resolveRef.current = null
    setConfirmState(null)
  }, [])

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Toasts — bottom-right, above the mobile tab bar on small screens */}
      <div className="toast-stack z-[100]" aria-live="polite" aria-atomic="false">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="toast"
            >
              <span className={`status-dot ${DOT_TONES[t.type] ?? 'accent'}`} aria-hidden="true" />
              <p>{t.message}</p>
              {t.action && (
                <button type="button" onClick={() => { t.action(); removeToast(t.id) }} className="toast-undo">
                  {t.actionLabel || 'Undo'}
                </button>
              )}
              <button type="button" onClick={() => removeToast(t.id)} className="btn btn-icon" aria-label="Dismiss">
                <X aria-hidden="true" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Confirm dialog */}
      <AnimatePresence>
        {confirmState && <ConfirmDialog key="confirm" state={confirmState} dialogRef={dialogRef} onResolve={handleConfirm} />}
      </AnimatePresence>
    </ToastContext.Provider>
  )
}

function ConfirmDialog({ state, dialogRef, onResolve }) {
  // While the dialog fades out it still covers the whole page; a click that
  // lands in that window (confirm, then straight on to the next row) must
  // reach the page, not a backdrop that is already on its way out.
  const isPresent = useIsPresent()
  useModal(dialogRef, { active: isPresent, onClose: () => onResolve(null) })
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      className="modal-backdrop z-[110]"
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
      aria-hidden={isPresent ? undefined : true}
      onMouseDown={event => { if (event.target === event.currentTarget) onResolve(null) }}
    >
      <motion.div
        ref={dialogRef}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="modal confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={state.description ? 'confirm-dialog-description' : undefined}
      >
        <h2 id="confirm-dialog-title">{state.message}</h2>
        {state.description && <p id="confirm-dialog-description">{state.description}</p>}
        <div className="button-row">
          {/* Cancel gets initial focus — a stray Enter must never
              confirm a destructive action. */}
          <button type="button" autoFocus onClick={() => onResolve(false)} className="btn">
            {state.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className={`btn ${state.tone === 'primary' ? 'btn-primary' : 'btn-danger'}`}
          >
            {state.okLabel || 'Confirm'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
