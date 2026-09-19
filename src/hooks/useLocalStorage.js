import { useEffect, useRef, useState } from 'react'
import { idbGet, idbSetEntries } from '../utils/persistence'

function prepare(value, validate, transform) {
  try {
    if (validate && !validate(value)) return { ok: false }
    const next = transform ? transform(value) : value
    return { ok: !validate || validate(next), value: next }
  } catch { return { ok: false } }
}

function readLocal(key, defaultValue, validate, transform) {
  let stored = null
  try {
    stored = localStorage.getItem(key)
    if (stored !== null) {
      const prepared = prepare(JSON.parse(stored), validate, transform)
      if (prepared.ok) return { hasValue: true, value: prepared.value, updatedAt: Number(localStorage.getItem(`${key}:updatedAt`)) || 0 }
    }
  } catch { /* try the mirror */ }
  if (stored !== null) {
    try { localStorage.setItem(`${key}-corrupt-${Date.now()}`, stored) } catch { /* best effort */ }
  }
  return { hasValue: false, value: defaultValue, updatedAt: 0 }
}

export default function useLocalStorage(key, defaultValue, options = {}) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const initialRef = useRef(null)
  if (initialRef.current === null) initialRef.current = readLocal(key, defaultValue, options.validate, options.transform)
  const [value, setValue] = useState(initialRef.current.value)
  const [status, setStatus] = useState('saved')
  const [hydrated, setHydrated] = useState(false)
  const persistedRef = useRef(null)
  const metaKey = `${key}:updatedAt`

  useEffect(() => {
    let cancelled = false
    const local = initialRef.current
    async function hydrate() {
      let mirrored, mirrorUpdatedAt = 0
      try { [mirrored, mirrorUpdatedAt] = await Promise.all([idbGet(key), idbGet(metaKey)]) } catch { /* local copy */ }
      if (cancelled) return
      const prepared = prepare(mirrored, optionsRef.current.validate, optionsRef.current.transform)
      const hasMirror = mirrored !== undefined && prepared.ok
      const useMirror = hasMirror && (!local.hasValue || (Number(mirrorUpdatedAt) || 0) > local.updatedAt)
      const chosen = useMirror ? prepared.value : local.value
      const updatedAt = useMirror ? Number(mirrorUpdatedAt) || 0 : local.updatedAt
      const serialized = JSON.stringify(chosen)
      persistedRef.current = serialized
      setValue(chosen)
      let localSaved = false, mirrorSaved = false
      try {
        if (localStorage.getItem(key) !== serialized) localStorage.setItem(key, serialized)
        localStorage.setItem(metaKey, String(updatedAt))
        localSaved = true
      } catch { /* report the layer that survived */ }
      try {
        await idbSetEntries([[key, chosen], [metaKey, updatedAt]])
        mirrorSaved = true
      } catch { /* report the layer that survived */ }
      if (!cancelled) {
        setStatus(localSaved && mirrorSaved ? 'saved' : localSaved || mirrorSaved ? 'degraded' : 'error')
        setHydrated(true)
      }
    }
    hydrate()
    return () => { cancelled = true }
  }, [key, metaKey])

  useEffect(() => {
    function onStorage(event) {
      if (event.key !== key || event.newValue == null || event.storageArea !== localStorage) return
      try {
        const prepared = prepare(JSON.parse(event.newValue), optionsRef.current.validate, optionsRef.current.transform)
        if (prepared.ok) {
          // Do not echo external changes with fresh timestamps between tabs.
          persistedRef.current = JSON.stringify(prepared.value)
          setValue(prepared.value)
        }
      } catch { /* ignore malformed cross-tab writes */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key])

  useEffect(() => {
    if (!hydrated) return undefined
    const serialized = JSON.stringify(value)
    if (serialized === persistedRef.current) return undefined
    const updatedAt = Date.now()
    let cancelled = false
    let localSaved = false
    setStatus('saving')
    // Save synchronously before a tab can close; mirror value and timestamp
    // in one transaction. Hydration never counts as a new user edit.
    try {
      localStorage.setItem(key, serialized)
      localStorage.setItem(metaKey, String(updatedAt))
      localSaved = true
    } catch { /* IndexedDB can still save the change */ }
    persistedRef.current = serialized
    idbSetEntries([[key, value], [metaKey, updatedAt]]).then(() => {
      if (!cancelled) setStatus(localSaved ? 'saved' : 'degraded')
    }).catch(() => {
      if (!cancelled) setStatus(localSaved ? 'degraded' : 'error')
    })
    return () => { cancelled = true }
  }, [key, metaKey, value, hydrated])

  return [value, setValue, status, hydrated]
}
