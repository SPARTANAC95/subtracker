import { createContext, useContext } from 'react'

// Kept out of Toast.jsx so that file exports components only — mixing hooks
// and components in one module breaks fast refresh for the whole tree.
export const ToastContext = createContext(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
