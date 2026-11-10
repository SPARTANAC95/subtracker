/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState } from 'react'

// Enter and exit animations without an animation library. Elements animate in
// with a plain CSS animation when they mount; <Presence> keeps them mounted a
// moment longer after they are dismissed so a `[data-leaving]` rule in
// index.css can play the way out. Everything runs on the compositor — no
// JavaScript per frame — and it keeps working in a background tab.

const PresentContext = createContext(true)

// False once the surrounding <Presence> has been asked to hide: the element
// is only on screen to finish its exit animation. Overlays use it to release
// focus, stop intercepting clicks and hide from assistive tech.
export function useIsPresent() {
  return useContext(PresentContext)
}

// Spread onto an animated element: `{...leaving(isPresent)}`.
export function leaving(isPresent) {
  return isPresent ? undefined : { 'data-leaving': '', 'aria-hidden': true }
}

export default function Presence({ show, exitMs = 170, children }) {
  const [lingering, setLingering] = useState(false)
  // While leaving, render what was last shown: the state that produced it
  // (the open record, the dialog title) has usually been cleared already.
  const last = useRef(null)
  if (show) last.current = children

  useEffect(() => {
    if (show) {
      setLingering(true)
      return undefined
    }
    const timer = window.setTimeout(() => {
      setLingering(false)
      last.current = null
    }, exitMs)
    return () => window.clearTimeout(timer)
  }, [show, exitMs])

  if (!show && !(lingering && last.current)) return null
  return <PresentContext.Provider value={show}>{show ? children : last.current}</PresentContext.Provider>
}

// Opens and closes its content with a height + fade transition. Pure CSS: a
// one-row grid whose track animates between 0fr and 1fr, so the content can
// be any height.
export function Collapse({ open, className = '', innerRef, children }) {
  return (
    <Presence show={open} exitMs={190}>
      <CollapseBox className={className} innerRef={innerRef}>{children}</CollapseBox>
    </Presence>
  )
}

function CollapseBox({ className, innerRef, children }) {
  const isPresent = useIsPresent()
  return (
    <div ref={innerRef} className={`collapse-box ${className}`} inert={!isPresent} {...leaving(isPresent)}>
      <div>{children}</div>
    </div>
  )
}
