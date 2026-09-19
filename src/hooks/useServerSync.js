import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildSyncPayload, deleteServerData, fetchServerData, fetchServerStatus,
  pushServerData, resolveSyncAction,
} from '../utils/syncServer'

const PUSH_DEBOUNCE_MS = 1200
const RETRY_MS = 12000

function snapshotOf({ subs, settings, dismissed }) {
  return JSON.stringify({ subs, settings, dismissed })
}

// The browser's own copies carry an updatedAt stamp per key (written by
// useLocalStorage). The newest of them is "when this browser last changed
// anything" — what first-boot reconciliation compares against the disk file.
function readLocalUpdatedAt() {
  try {
    return Math.max(...['st-subs', 'st-settings', 'st-dismissed']
      .map(key => Number(localStorage.getItem(`${key}:updatedAt`)) || 0))
  } catch {
    return 0
  }
}

// Keeps the local data server's disk file in sync with app state.
//
// Boot:    ask the server which side is newer; apply or push accordingly.
//          `ready` stays false until that is settled so the UI never flashes
//          the setup wizard when the disk file already has data.
// Running: every change is debounced and PUT to the server; a failed push
//          flips to 'offline' and retries.
// Closing: pending changes are flushed with sendBeacon on pagehide.
export default function useServerSync({ subs, settings, dismissed, hydrated, onApply }) {
  const [ready, setReady] = useState(false)
  const [available, setAvailable] = useState(false)
  const [status, setStatus] = useState('idle') // idle | saving | synced | offline
  const [info, setInfo] = useState({ dataFile: '', backups: 0, lastSavedAt: null })

  const dataRef = useRef({ subs, settings, dismissed })
  dataRef.current = { subs, settings, dismissed }
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply

  const availableRef = useRef(false)
  const lastPushedRef = useRef(null)
  const applyGraceRef = useRef(false)
  const resettingRef = useRef(false)
  const pushTimerRef = useRef(null)
  const retryTimerRef = useRef(null)
  const inFlightRef = useRef(null)
  const revisionRef = useRef(null)
  const conflictRef = useRef(false)

  const doPush = useCallback(async () => {
    if (!availableRef.current || resettingRef.current || conflictRef.current) return false
    if (inFlightRef.current) return inFlightRef.current
    window.clearTimeout(retryTimerRef.current)
    async function saveLatest() {
      // Serialize requests and drain edits made while a request was pending.
      // A slow old save must never land after a newer save or a factory reset.
      do {
        const payload = { ...buildSyncPayload(dataRef.current), baseRevision: revisionRef.current }
        const snapshot = snapshotOf(dataRef.current)
        setStatus('saving')
        const result = await pushServerData(payload)
        if (result?.conflict) {
          conflictRef.current = true
          setStatus('conflict')
          return false
        }
        if (!result?.ok) {
          setStatus('offline')
          if (!resettingRef.current) retryTimerRef.current = window.setTimeout(() => { doPush() }, RETRY_MS)
          return false
        }
        lastPushedRef.current = snapshot
        revisionRef.current = result.revision ?? null
        setInfo(prev => ({ ...prev, lastSavedAt: result.savedAt }))
      } while (!resettingRef.current && snapshotOf(dataRef.current) !== lastPushedRef.current)
      setStatus('synced')
      return true
    }
    inFlightRef.current = saveLatest().finally(() => { inFlightRef.current = null })
    return inFlightRef.current
  }, [])

  // ── Boot reconciliation (runs once, after browser storage has hydrated) ──
  useEffect(() => {
    if (!hydrated) return undefined
    let cancelled = false
    let bootRetry = null

    async function reconcile() {
      const serverStatus = await fetchServerStatus()
      if (cancelled) return
      if (!serverStatus) {
        setReady(true)
        bootRetry = window.setTimeout(reconcile, RETRY_MS)
        return
      }

      const server = serverStatus.exists ? await fetchServerData() : false
      if (cancelled) return

      // The file exists but could not be read just now (timeout, transient
      // error). Pushing would overwrite it with whatever this browser holds —
      // possibly older — so stay in browser-only mode and try again shortly.
      // The app is usable meanwhile; disk sync switches on once it succeeds.
      if (server === null) {
        setStatus('offline')
        setReady(true)
        bootRetry = window.setTimeout(reconcile, RETRY_MS)
        return
      }

      availableRef.current = true
      revisionRef.current = server?.revision ?? null
      setAvailable(true)
      setInfo({
        dataFile: serverStatus.dataFile || '',
        backups: serverStatus.backups || 0,
        lastSavedAt: serverStatus.lastSaved || null,
      })

      const local = dataRef.current
      const localEmpty = !local.settings && (!local.subs || local.subs.length === 0)
      const action = resolveSyncAction({ localEmpty, localUpdatedAt: readLocalUpdatedAt(), server: server || null, resetAt: serverStatus.resetAt })

      if (action === 'reset') {
        applyGraceRef.current = true
        onApplyRef.current?.({ app: 'subtracker-pro', version: 2, subs: [], settings: null, dismissed: [] })
        setStatus('synced')
      } else if (action === 'apply') {
        applyGraceRef.current = true
        const applied = onApplyRef.current?.(server)
        if (applied) setStatus('synced')
        else {
          // A newer/unreadable format is not permission to overwrite it.
          applyGraceRef.current = false
          availableRef.current = false
          setAvailable(false)
          setStatus('offline')
          bootRetry = window.setTimeout(reconcile, RETRY_MS)
        }
      } else if (action === 'push') {
        await doPush()
      } else {
        lastPushedRef.current = snapshotOf(local)
        setStatus('synced')
      }
      if (!cancelled) setReady(true)
    }

    reconcile().catch(() => { if (!cancelled) setReady(true) })

    return () => {
      cancelled = true
      window.clearTimeout(bootRetry)
    }
  }, [hydrated, doPush])

  // ── Debounced push on every change ──
  useEffect(() => {
    if (!ready || !available) return undefined
    const snapshot = snapshotOf(dataRef.current)

    // The change that immediately follows applying server data is the apply
    // itself round-tripping through state — record it as already pushed.
    if (applyGraceRef.current) {
      applyGraceRef.current = false
      lastPushedRef.current = snapshot
      return undefined
    }
    if (snapshot === lastPushedRef.current) return undefined

    window.clearTimeout(pushTimerRef.current)
    pushTimerRef.current = window.setTimeout(() => { doPush() }, PUSH_DEBOUNCE_MS)
    return () => window.clearTimeout(pushTimerRef.current)
  }, [subs, settings, dismissed, ready, available, doPush])

  // ── Flush on tab close: sendBeacon survives page teardown ──
  useEffect(() => {
    if (!available) return undefined
    function flush() {
      if (resettingRef.current || conflictRef.current) return
      const snapshot = snapshotOf(dataRef.current)
      if (snapshot === lastPushedRef.current) return
      try {
        const body = new Blob([JSON.stringify({ ...buildSyncPayload(dataRef.current), baseRevision: revisionRef.current })], { type: 'application/json' })
        navigator.sendBeacon('/api/data', body)
      } catch { /* the debounced push already covered most of it */ }
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [available])

  useEffect(() => () => {
    window.clearTimeout(pushTimerRef.current)
    window.clearTimeout(retryTimerRef.current)
  }, [])

  // Factory reset: stop pushing (including the pagehide beacon — it must not
  // resurrect the file), then delete server-side. A rescue copy stays in backups.
  const reset = useCallback(async () => {
    if (!availableRef.current) return true
    resettingRef.current = true
    window.clearTimeout(pushTimerRef.current)
    window.clearTimeout(retryTimerRef.current)
    await inFlightRef.current
    const ok = await deleteServerData()
    if (!ok) {
      resettingRef.current = false
      setStatus('offline')
      retryTimerRef.current = window.setTimeout(() => { doPush() }, RETRY_MS)
    }
    return ok
  }, [doPush])

  const loadDiskCopy = useCallback(async () => {
    const server = await fetchServerData()
    if (!server) return false
    applyGraceRef.current = true
    if (!onApplyRef.current?.(server)) { applyGraceRef.current = false; return false }
    revisionRef.current = server.revision ?? null
    conflictRef.current = false
    setInfo(prev => ({ ...prev, lastSavedAt: server.savedAt || null }))
    setStatus('synced')
    return true
  }, [])

  return { ready, available, status, info, pushNow: doPush, reset, loadDiskCopy }
}
