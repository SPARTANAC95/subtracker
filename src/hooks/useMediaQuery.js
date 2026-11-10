import { useSyncExternalStore } from 'react'

const lists = new Map()

function listFor(query) {
  if (!lists.has(query)) lists.set(query, window.matchMedia(query))
  return lists.get(query)
}

// Tracks a CSS media query. Lets a page render only the layout that is on
// screen — the table or the cards — instead of building both and hiding one.
export default function useMediaQuery(query) {
  return useSyncExternalStore(
    notify => {
      const list = listFor(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => listFor(query).matches,
    () => false,
  )
}

// Tailwind's `md` breakpoint: the width at which lists become tables.
export const WIDE_LAYOUT = '(min-width: 48rem)'
