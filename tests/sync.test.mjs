import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSyncPayload, isServerPayloadEmpty, resolveSyncAction } from '../src/utils/syncServer.js'

const SUB = { id: 's1', name: 'Netflix', amount: 15, cycle: 'monthly', category: 'streaming' }
const SETTINGS = { currency: 'USD', budget: 100 }

test('first-boot reconciliation picks the newer side', () => {
  // Nothing anywhere → nothing to do.
  assert.equal(resolveSyncAction({ localEmpty: true, localUpdatedAt: 0, server: null }), 'none')

  // Only this browser has data → seed the disk file.
  assert.equal(resolveSyncAction({ localEmpty: false, localUpdatedAt: 1000, server: null }), 'push')
  assert.equal(resolveSyncAction({ localEmpty: false, localUpdatedAt: 1000, server: { subs: [], settings: null } }), 'push')

  // Fresh browser, disk file has data → the file wins (new-browser restore).
  assert.equal(resolveSyncAction({ localEmpty: true, localUpdatedAt: 0, server: { subs: [SUB], settings: SETTINGS, updatedAt: 5000 } }), 'apply')

  // Both sides have data → last writer wins.
  assert.equal(resolveSyncAction({ localEmpty: false, localUpdatedAt: 10_000, server: { subs: [SUB], settings: SETTINGS, updatedAt: 99_000 } }), 'apply')
  assert.equal(resolveSyncAction({ localEmpty: false, localUpdatedAt: 99_000, server: { subs: [SUB], settings: SETTINGS, updatedAt: 10_000 } }), 'push')

  // Near-simultaneous stamps resolve to a harmless re-push, not an apply
  // that could clobber an in-flight local edit.
  assert.equal(resolveSyncAction({ localEmpty: false, localUpdatedAt: 10_000, server: { subs: [SUB], settings: SETTINGS, updatedAt: 11_000 } }), 'push')

  // A server savedAt stamp counts even when the payload updatedAt is missing.
  const savedAt = new Date(Date.now()).toISOString()
  assert.equal(resolveSyncAction({ localEmpty: false, localUpdatedAt: 10_000, server: { subs: [SUB], settings: SETTINGS, savedAt } }), 'apply')
})

test('payload emptiness ignores shape noise', () => {
  assert.equal(isServerPayloadEmpty(null), true)
  assert.equal(isServerPayloadEmpty({}), true)
  assert.equal(isServerPayloadEmpty({ subs: [], settings: null }), true)
  assert.equal(isServerPayloadEmpty({ subs: [SUB] }), false)
  assert.equal(isServerPayloadEmpty({ subs: [], settings: SETTINGS }), false)
})

test('sync payloads are valid SubTracker backups', () => {
  const payload = buildSyncPayload({ subs: [SUB], settings: SETTINGS, dismissed: ['x'] })
  assert.equal(payload.app, 'subtracker-pro')
  assert.equal(payload.version, 2)
  assert.deepEqual(payload.subs, [SUB])
  assert.deepEqual(payload.dismissed, ['x'])
  assert.ok(Number.isFinite(payload.updatedAt))
  // Defaults must be backup-shaped, not undefined.
  const empty = buildSyncPayload({})
  assert.deepEqual(empty.subs, [])
  assert.equal(empty.settings, null)
  assert.deepEqual(empty.dismissed, [])
})

test('a reset in another browser cannot be undone by an older browser copy', () => {
  assert.equal(resolveSyncAction({ localEmpty: false, localUpdatedAt: 1000, server: null, resetAt: 2000 }), 'reset')
  assert.equal(resolveSyncAction({ localEmpty: false, localUpdatedAt: 3000, server: null, resetAt: 2000 }), 'push')
  assert.equal(resolveSyncAction({ localEmpty: true, localUpdatedAt: 0, server: null, resetAt: 2000 }), 'none')
})
