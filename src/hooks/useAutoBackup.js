import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildBackupPayload, clearBackupHandle, getStoredBackupHandle,
  isFileBackupSupported, pickBackupFile, queryHandlePermission,
  readBackupFile, requestHandlePermission, writeBackupFile,
} from '../utils/persistence'

function dataSnapshot({ subs, settings, dismissed }) {
  return JSON.stringify({ subs, settings, dismissed })
}

// Keeps a user-chosen JSON file in sync after the app has fully hydrated.
// Existing files are never overwritten merely because the app launched.
export default function useAutoBackup({ subs, settings, dismissed, hydrated = false }) {
  const supported = isFileBackupSupported()
  const [handle, setHandle] = useState(null)
  const [status, setStatus] = useState('idle')
  const [lastBackupAt, setLastBackupAt] = useState(null)
  const dataRef = useRef({ subs, settings, dismissed })
  const timerRef = useRef(null)
  const queueRef = useRef(Promise.resolve())
  const lastSnapshotRef = useRef(null)
  dataRef.current = { subs, settings, dismissed }

  useEffect(() => {
    if (!supported) return undefined
    let cancelled = false
    getStoredBackupHandle().then(async storedHandle => {
      if (cancelled || !storedHandle) return
      setHandle(storedHandle)
      const permission = await queryHandlePermission(storedHandle)
      if (!cancelled) setStatus(permission === 'granted' ? 'ok' : 'needs-permission')
    }).catch(() => {})
    return () => { cancelled = true }
  }, [supported])

  const writeNow = useCallback((providedHandle) => {
    const target = providedHandle || handle
    if (!target || !hydrated) return Promise.resolve(false)

    const task = async () => {
      const permission = await queryHandlePermission(target)
      if (permission !== 'granted') {
        setStatus('needs-permission')
        return false
      }
      setStatus('pending')
      try {
        const payload = buildBackupPayload(dataRef.current)
        const snapshot = dataSnapshot(dataRef.current)
        await writeBackupFile(target, payload)
        lastSnapshotRef.current = snapshot
        setLastBackupAt(payload.exportedAt)
        setStatus('ok')
        return true
      } catch (error) {
        console.warn('[autoBackup] Write failed', error)
        setStatus('error')
        return false
      }
    }

    queueRef.current = queueRef.current.catch(() => {}).then(task)
    return queueRef.current
  }, [handle, hydrated])

  useEffect(() => {
    if (!hydrated || !handle || !settings) return undefined
    const snapshot = dataSnapshot({ subs, settings, dismissed })

    // Establish the launch baseline. A pre-existing disk file may be newer and
    // must only be replaced after an actual in-app change or explicit backup.
    if (lastSnapshotRef.current === null) {
      lastSnapshotRef.current = snapshot
      return undefined
    }
    if (lastSnapshotRef.current === snapshot) return undefined

    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => writeNow(), 1200)
    return () => window.clearTimeout(timerRef.current)
  }, [subs, settings, dismissed, handle, hydrated, writeNow])

  const connect = useCallback(async () => {
    const selected = await pickBackupFile()
    setHandle(selected)
    lastSnapshotRef.current = null
    if (!(await writeNow(selected))) throw new Error('Could not write backup file')
    return selected
  }, [writeNow])

  const disconnect = useCallback(async () => {
    window.clearTimeout(timerRef.current)
    await queueRef.current.catch(() => {})
    await clearBackupHandle()
    setHandle(null)
    setStatus('idle')
    setLastBackupAt(null)
    lastSnapshotRef.current = null
  }, [])

  const reauthorize = useCallback(async () => {
    if (!handle) return false
    const permission = await requestHandlePermission(handle)
    if (permission !== 'granted') return false
    return writeNow()
  }, [handle, writeNow])

  const restore = useCallback(async () => {
    if (!handle) throw new Error('No backup file connected')
    window.clearTimeout(timerRef.current)
    await queueRef.current.catch(() => {})
    const current = await queryHandlePermission(handle)
    if (current !== 'granted') {
      const permission = await requestHandlePermission(handle)
      if (permission !== 'granted') throw new Error('Permission denied')
    }
    const payload = await readBackupFile(handle)
    return payload
  }, [handle])

  return {
    supported,
    connected: Boolean(handle),
    fileName: handle?.name || '',
    status,
    lastBackupAt,
    connect,
    disconnect,
    reauthorize,
    restore,
    backupNow: () => writeNow(),
  }
}
