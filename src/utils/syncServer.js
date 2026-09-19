// Client for the local data server (server.mjs). Every helper resolves to
// null/false instead of throwing when the server is not there, so the app
// degrades cleanly to browser-only storage (e.g. dev mode without the server,
// or the user closed the server window mid-session).
//
// This module must stay import-safe under plain Node — the decision logic is
// unit-tested — so no top-level references to window/localStorage.

const STATUS_TIMEOUT_MS = 1500
const DATA_TIMEOUT_MS = 8000

async function request(path, { timeout, ...options } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout || DATA_TIMEOUT_MS)
  try {
    return await fetch(path, { cache: 'no-store', signal: controller.signal, ...options })
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchServerStatus() {
  try {
    const res = await request('/api/status', { timeout: STATUS_TIMEOUT_MS })
    if (!res.ok) return null
    const status = await res.json()
    // The dev server answers unknown paths with index.html, so insist on the
    // real signature before treating the endpoint as our server.
    return status && status.ok === true && status.app === 'subtracker-pro' ? status : null
  } catch {
    return null
  }
}

// Three outcomes, because the boot reconciliation must tell them apart:
//   payload — the disk file, parsed
//   false   — the server answered and definitely has no readable data file
//   null    — the server could not be reached or errored; state unknown
// Treating "unknown" as "empty" would let a browser push its own copy over a
// newer file it merely failed to read for a moment.
export async function fetchServerData() {
  try {
    const res = await request('/api/data')
    if (res.status === 404) return false
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function pushServerData(payload) {
  try {
    const res = await request('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.status === 409) return { conflict: true }
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function deleteServerData() {
  try {
    const res = await request('/api/data', { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

export async function openDataFolder() {
  try {
    const res = await request('/api/open-folder', { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}

export function buildSyncPayload({ subs, settings, dismissed }) {
  return {
    app: 'subtracker-pro',
    version: 2,
    exportedAt: new Date().toISOString(),
    updatedAt: Date.now(),
    settings: settings || null,
    subs: subs || [],
    dismissed: dismissed || [],
  }
}

export function isServerPayloadEmpty(payload) {
  if (!payload || typeof payload !== 'object') return true
  const hasSubs = Array.isArray(payload.subs) && payload.subs.length > 0
  const hasSettings = payload.settings && typeof payload.settings === 'object'
  return !hasSubs && !hasSettings
}

// First-boot reconciliation between what this browser holds and what the disk
// file holds. Single-user, one machine: last writer wins, with a small slack
// window so "same data, both stamped moments apart" resolves to a harmless
// re-push instead of a pointless apply.
export function resolveSyncAction({ localEmpty, localUpdatedAt, server, resetAt = 0 }) {
  if (!localEmpty && isServerPayloadEmpty(server) && resetAt > (Number(localUpdatedAt) || 0)) return 'reset'
  if (isServerPayloadEmpty(server)) return localEmpty ? 'none' : 'push'
  if (localEmpty) return 'apply'
  const serverAt = Math.max(Number(server.updatedAt) || 0, Date.parse(server.savedAt || '') || 0)
  const localAt = Number(localUpdatedAt) || 0
  return serverAt > localAt + 2000 ? 'apply' : 'push'
}
