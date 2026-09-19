import { useEffect, useRef } from 'react'

const stack = []
let previousOverflow = ''
const focusable = panel => [...panel.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  .filter(element => element.tabIndex >= 0 && element.getClientRects().length)

// Shared ownership prevents an exiting drawer from unlocking the page or
// stealing focus from the edit form that has just replaced it.
export default function useModal(panelRef, { active = true, onClose, initialFocusRef } = {}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!active) return undefined
    const entry = { panelRef }
    const previouslyFocused = document.activeElement
    if (!stack.length) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    stack.push(entry)
    const top = () => stack.at(-1) === entry
    const timer = window.setTimeout(() => {
      if (top() && panelRef.current) (initialFocusRef?.current || focusable(panelRef.current)[0] || panelRef.current).focus()
    }, 0)
    function onKey(event) {
      if (!top() || !panelRef.current) return
      if (panelRef.current.getAttribute('role') === 'alertdialog') event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeRef.current?.()
      } else if (event.key === 'Tab') {
        const items = focusable(panelRef.current)
        const first = items[0], last = items.at(-1)
        if (!first) { event.preventDefault(); return }
        if (!panelRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus() }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
      const wasTop = top()
      stack.splice(stack.indexOf(entry), 1)
      if (!stack.length) document.body.style.overflow = previousOverflow
      if (wasTop && previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [active, panelRef, initialFocusRef])
}
