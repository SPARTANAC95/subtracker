import { useEffect, useState } from 'react'
import { formatDateOnly } from '../utils/dates'

// The app is a long-lived tab: it is normal for it to stay open overnight or
// to be brought back from a sleeping laptop days later. Every "due in N days",
// "overdue" and "Today" label is computed from the wall clock at render time,
// so nothing would move until the user happened to change some state.
// This hook re-renders its owner at local midnight and whenever the tab comes
// back into view on a different calendar day.
export default function useDayTick() {
  const [today, setToday] = useState(() => formatDateOnly(new Date()))

  useEffect(() => {
    let timer = null

    function check() {
      const now = formatDateOnly(new Date())
      setToday(previous => (previous === now ? previous : now))
      schedule()
    }

    function schedule() {
      window.clearTimeout(timer)
      const now = new Date()
      // A few seconds past midnight, so clock drift cannot fire us a moment
      // before the date actually changes.
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
      timer = window.setTimeout(check, Math.max(1000, nextMidnight.getTime() - now.getTime()))
    }

    function onVisible() {
      if (document.visibilityState === 'visible') check()
    }

    schedule()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  return today
}
