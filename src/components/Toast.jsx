import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import { X } from 'lucide-react'
import { ToastContext } from './toast-context'
import useModal from '../hooks/useModal'

// Semantic dot colors: sage / terracotta / sand / gold.
const DOT_COLORS = {
  success: '#9ec8a0',
  error: '#d99f8b',
  warning: '#d9c28b',
  info: '#e1ad66',
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

  // opts: { okLabel, cancelLabel, tone } — tone 'primary' renders a gold
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

      {/* Toast container — bottom-right, above the mobile nav on small screens */}
      <div className="pointer-events-none toast-stack fixed right-[22px] bottom-[calc(96px+env(safe-area-inset-bottom))] z-[100] flex w-full max-w-[380px] flex-col items-end gap-[9px] lg:bottom-[22px]" aria-live="polite" aria-atomic="false">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="pointer-events-auto flex min-w-[250px] max-w-[380px] items-center gap-[11px] rounded-2xl border border-[rgba(242,240,234,0.1)] bg-[rgba(23,22,20,0.92)] px-[15px] py-3 shadow-[0_8px_26px_rgba(0,0,0,0.5)] backdrop-blur-md"
            >
              <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: DOT_COLORS[t.type] || DOT_COLORS.info }} aria-hidden="true" />
              <p className="flex-1 text-[12.5px] text-[rgba(242,240,234,0.85)]">{t.message}</p>
              {t.action && (
                <button
                  onClick={() => { t.action(); removeToast(t.id) }}
                  className="-my-2 flex-none px-2 py-2.5 text-[12.5px] font-semibold text-[#facb8d] transition-colors hover:text-[#f6e2c4]"
                >
                  {t.actionLabel || 'Undo'}
                </button>
              )}
              <button
                onClick={() => removeToast(t.id)}
                className="-my-2 -mr-1.5 flex-none p-2.5 text-xs text-[rgba(242,240,234,0.35)] transition-colors hover:text-[rgba(242,240,234,0.7)]"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
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
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
      onClick={() => onResolve(null)}
    >
      <motion.div
        ref={dialogRef}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-[20px] border border-[rgba(242,240,234,0.1)] bg-[#171614] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h3 id="confirm-dialog-title" className="text-lg font-semibold text-(--app-text)">
          {state.message}
        </h3>
        {state.description && (
          <p className="mt-2 text-sm leading-6 text-[rgba(242,240,234,0.6)]">{state.description}</p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          {/* Cancel gets initial focus — a stray Enter must never
              confirm a destructive action. */}
          <button autoFocus onClick={() => onResolve(false)} className="btn btn-secondary">
            {state.cancelLabel || 'Cancel'}
          </button>
          <button
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
