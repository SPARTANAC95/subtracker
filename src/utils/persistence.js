// Layered persistence for SubTracker.
//
// Layer 1: localStorage  — primary, synchronous (handled in useLocalStorage)
// Layer 2: IndexedDB     — mirror of every key; survives many cases where
//                          localStorage is cleared, and is used for recovery
// Layer 3: Disk file     — optional auto-backup via the File System Access API;
//                          a real .json file the user owns, independent of the
//                          browser profile entirely

const DB_NAME = 'subtracker-db'
const DB_VERSION = 1
const STORE = 'kv'
const HANDLE_KEY = 'backup-file-handle'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

function tx(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    const req = fn(store)
    // Requests can succeed and still roll back at commit (quota/disk errors).
    t.oncomplete = () => resolve(req.result)
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'))
    t.onerror = () => reject(t.error || req.error)
  }))
}

export function idbGet(key) {
  return tx('readonly', store => store.get(key))
}

export function idbSet(key, value) {
  return tx('readwrite', store => store.put(value, key))
}

export function idbSetEntries(entries) {
  return tx('readwrite', store => {
    let request
    for (const [key, value] of entries) request = store.put(value, key)
    return request
  })
}

export function idbDel(key) {
  return tx('readwrite', store => store.delete(key))
}

export function idbClear() {
  return tx('readwrite', store => store.clear())
}

// ── Persistent storage grant ──
// Asks the browser to exempt this origin's storage from automatic eviction.

export async function ensurePersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function isStoragePersisted() {
  try {
    if (!navigator.storage || !navigator.storage.persisted) return false
    return await navigator.storage.persisted()
  } catch {
    return false
  }
}

// ── File System Access auto-backup ──

export function isFileBackupSupported() {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

export async function pickBackupFile() {
  const handle = await window.showSaveFilePicker({
    suggestedName: 'subtracker-backup.json',
    types: [{ description: 'SubTracker backup', accept: { 'application/json': ['.json'] } }],
  })
  await idbSet(HANDLE_KEY, handle)
  return handle
}

export async function getStoredBackupHandle() {
  try { return (await idbGet(HANDLE_KEY)) || null } catch { return null }
}

export async function clearBackupHandle() {
  try { await idbDel(HANDLE_KEY) } catch { /* non-fatal */ }
}

export async function queryHandlePermission(handle) {
  try { return await handle.queryPermission({ mode: 'readwrite' }) } catch { return 'denied' }
}

// Must be called from a user gesture (button click) to show the prompt.
export async function requestHandlePermission(handle) {
  try { return await handle.requestPermission({ mode: 'readwrite' }) } catch { return 'denied' }
}

export async function writeBackupFile(handle, payload) {
  // Serialize before opening the destination so a serialization failure can
  // never truncate the last known-good backup.
  const serialized = JSON.stringify(payload, null, 2)
  const writable = await handle.createWritable()
  try {
    await writable.write(serialized)
    await writable.close()
  } catch (error) {
    try { await writable.abort?.() } catch { /* best effort */ }
    throw error
  }
}

export async function readBackupFile(handle) {
  const file = await handle.getFile()
  return JSON.parse(await file.text())
}

export function buildBackupPayload({ subs, settings, dismissed }) {
  return {
    app: 'subtracker-pro',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: settings || null,
    subs: subs || [],
    dismissed: dismissed || [],
  }
}

function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return fallback }
}

// Accept both normal v2 backups and the recovery format created by older
// crash screens. Validation/normalization of individual subscriptions remains
// the caller's responsibility so import can show an accurate report.
export function parseBackupPayload(input) {
  if (Array.isArray(input)) return { app: 'subtracker-pro', version: 1, subs: input, settings: null, dismissed: [] }
  if (!input || typeof input !== 'object') {
    throw new Error('Backup must be a JSON object')
  }

  if (Array.isArray(input.subs)) {
    if (input.app && input.app !== 'subtracker-pro') throw new Error('This backup belongs to a different app')
    if (Number(input.version) > 2) throw new Error('This backup was created by a newer SubTracker version')
    return {
      app: input.app || 'subtracker-pro',
      version: Number(input.version) || 1,
      exportedAt: input.exportedAt || null,
      subs: input.subs,
      settings: input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings) ? input.settings : null,
      dismissed: Array.isArray(input.dismissed) ? input.dismissed : [],
    }
  }

  const recovery = input.data && typeof input.data === 'object' ? input.data : null
  if (recovery) {
    const subs = parseMaybeJson(recovery['st-subs'], [])
    if (!Array.isArray(subs)) throw new Error('Recovery backup has no subscriptions')
    return {
      app: 'subtracker-pro',
      version: 1,
      exportedAt: input.exportedAt || null,
      subs,
      settings: parseMaybeJson(recovery['st-settings'], null),
      dismissed: parseMaybeJson(recovery['st-dismissed'], []),
    }
  }

  throw new Error('Unrecognized SubTracker backup')
}

export function parseBackupText(text) {
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error('Backup is not valid JSON') }
  if (Array.isArray(parsed)) return { app: 'subtracker-pro', version: 1, subs: parsed, settings: null, dismissed: [] }
  return parseBackupPayload(parsed)
}

export async function clearAllAppData() {
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('st-')) localStorage.removeItem(key)
    })
  } catch { /* storage may be unavailable */ }
  try { await idbClear() } catch { /* best effort; local data is already gone */ }
}
