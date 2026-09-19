import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function payload(overrides = {}) {
  return {
    app: 'subtracker-pro',
    version: 2,
    updatedAt: Date.now(),
    settings: { currency: 'USD', budget: 50 },
    subs: [{ id: 's1', name: 'Netflix', amount: 15, cycle: 'monthly', category: 'streaming' }],
    dismissed: [],
    ...overrides,
  }
}

// Boots server.mjs on an ephemeral port with an isolated temp data dir.
// Returns { base, dataDir } and registers cleanup on the test context.
async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtracker-test-'))
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, SUBTRACKER_PORT: '0', SUBTRACKER_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const port = await new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 8000)
    proc.stdout.on('data', chunk => {
      out += String(chunk)
      const match = /LISTENING (\d+)/.exec(out)
      if (match) { clearTimeout(timer); resolve(Number(match[1])) }
    })
    proc.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited early (${code}): ${out}`)) })
  })

  t.after(() => {
    proc.kill()
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch { /* temp dir */ }
  })

  return { base: `http://127.0.0.1:${port}`, dataDir }
}

test('data round-trips through the server onto disk', async t => {
  const { base, dataDir } = await startServer(t)

  // Empty at first.
  let status = await (await fetch(`${base}/api/status`)).json()
  assert.equal(status.ok, true)
  assert.equal(status.exists, false)

  // Save.
  const saved = await (await fetch(`${base}/api/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload()),
  })).json()
  assert.equal(saved.ok, true)
  assert.ok(saved.savedAt)

  // The file really exists on disk and is a valid backup shape.
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'subtracker-data.json'), 'utf8'))
  assert.equal(onDisk.app, 'subtracker-pro')
  assert.equal(onDisk.subs[0].name, 'Netflix')
  assert.ok(onDisk.savedAt)

  // Load returns the same data, and a daily backup was written.
  const loaded = await (await fetch(`${base}/api/data`)).json()
  assert.equal(loaded.subs[0].name, 'Netflix')
  status = await (await fetch(`${base}/api/status`)).json()
  assert.equal(status.exists, true)
  assert.ok(status.backups >= 1)
})

test('a corrupted data file recovers from the previous version', async t => {
  const { base, dataDir } = await startServer(t)
  const put = body => fetch(`${base}/api/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  await put(payload({ subs: [{ id: 's1', name: 'First', amount: 1, cycle: 'monthly', category: 'other' }] }))
  await put(payload({ subs: [{ id: 's1', name: 'Second', amount: 2, cycle: 'monthly', category: 'other' }] }))

  // Simulate a crash mid-write / disk corruption.
  fs.writeFileSync(path.join(dataDir, 'subtracker-data.json'), '{ this is not json')

  const recovered = await (await fetch(`${base}/api/data`)).json()
  // .bak holds the state before the last write — "First".
  assert.equal(recovered.subs[0].name, 'First')

  // Recovery healed the primary file on disk.
  const healed = JSON.parse(fs.readFileSync(path.join(dataDir, 'subtracker-data.json'), 'utf8'))
  assert.equal(healed.subs[0].name, 'First')
})

test('factory reset deletes the file but keeps a rescue backup', async t => {
  const { base, dataDir } = await startServer(t)
  await fetch(`${base}/api/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) })

  const reset = await (await fetch(`${base}/api/data`, { method: 'DELETE' })).json()
  assert.equal(reset.ok, true)

  const status = await (await fetch(`${base}/api/status`)).json()
  assert.equal(status.exists, false)

  const rescues = fs.readdirSync(path.join(dataDir, 'backups')).filter(name => name.startsWith('rescue-'))
  assert.equal(rescues.length, 1)
  const rescued = JSON.parse(fs.readFileSync(path.join(dataDir, 'backups', rescues[0]), 'utf8'))
  assert.equal(rescued.subs[0].name, 'Netflix')
})

test('foreign or malformed payloads are rejected', async t => {
  const { base } = await startServer(t)
  const put = body => fetch(`${base}/api/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })

  assert.equal((await put('not json at all')).status, 400)
  assert.equal((await put(JSON.stringify({ app: 'other-app', subs: [] }))).status, 400)
  assert.equal((await put(JSON.stringify({ app: 'subtracker-pro', subs: 'nope' }))).status, 400)

  const status = await (await fetch(`${base}/api/status`)).json()
  assert.equal(status.exists, false)
})

test('sendBeacon-style POST saves exactly like PUT', async t => {
  const { base } = await startServer(t)
  const res = await fetch(`${base}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload({ subs: [{ id: 'b1', name: 'Beacon', amount: 5, cycle: 'monthly', category: 'other' }] })),
  })
  assert.equal((await res.json()).ok, true)
  const loaded = await (await fetch(`${base}/api/data`)).json()
  assert.equal(loaded.subs[0].name, 'Beacon')
})

test('the server serves the built app shell', async t => {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    t.skip('dist/ not built')
    return
  }
  const { base } = await startServer(t)
  const res = await fetch(`${base}/`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
  assert.match(await res.text(), /SubTracker/)
  // Unknown app routes fall back to the shell (SPA), API routes do not.
  assert.equal((await fetch(`${base}/some/app/route`)).status, 200)
  assert.equal((await fetch(`${base}/api/nope`)).status, 404)
})

test('requests that do not come from the app itself are refused', async t => {
  const { base } = await startServer(t)
  const body = JSON.stringify(payload())

  // A page on another site (cross-site POST without a preflight).
  const foreign = await fetch(`${base}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body,
  })
  assert.equal(foreign.status, 403)

  // A DNS-rebinding style request: the browser thinks it is talking to
  // some public hostname that resolved to 127.0.0.1. (fetch() refuses to
  // send a custom Host header, so this one goes through node:http.)
  const rebound = await new Promise((resolve, reject) => {
    const { hostname, port } = new URL(base)
    http.get({ hostname, port, path: '/api/status', headers: { Host: 'attacker.example' } }, res => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    }).on('error', reject)
  })
  assert.equal(rebound, 403)

  // A "simple" cross-site request smuggled as text/plain.
  const plain = await fetch(`${base}/api/data`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })
  assert.equal(plain.status, 415)

  // Nothing above touched the disk.
  const status = await (await fetch(`${base}/api/status`)).json()
  assert.equal(status.exists, false)

  // The app's own origins are fine, on every loopback spelling.
  const port = new URL(base).port
  for (const origin of [`http://localhost:${port}`, base, `http://[::1]:${port}`, 'http://127.0.0.1:5280']) {
    const ok = await fetch(`${base}/api/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin }, body })
    assert.equal(ok.status, 200, origin)
  }
})

test('a missing primary is recovered during the status handshake', async t => {
  const { base, dataDir } = await startServer(t)
  const body = JSON.stringify(payload())
  await fetch(`${base}/api/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
  fs.unlinkSync(path.join(dataDir, 'subtracker-data.json'))
  assert.equal((await (await fetch(`${base}/api/status`)).json()).exists, true)
  assert.equal((await (await fetch(`${base}/api/data`)).json()).subs[0].name, 'Netflix')
})

test('reset cannot resurrect daily backups, including after subsequent corruption', async t => {
  const { base, dataDir } = await startServer(t)
  const put = body => fetch(`${base}/api/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  await put(payload())
  await fetch(`${base}/api/data`, { method: 'DELETE' })
  assert.equal((await fetch(`${base}/api/data`)).status, 404)
  assert.equal((await (await fetch(`${base}/api/status`)).json()).exists, false)
  const newer = payload({ subs: [] })
  await put(newer)
  fs.writeFileSync(path.join(dataDir, 'subtracker-data.json'), 'corrupted')
  const recovered = await (await fetch(`${base}/api/data`)).json()
  assert.deepEqual(recovered.subs, [])
  assert.ok(fs.readdirSync(path.join(dataDir, 'backups')).some(name => name.startsWith('rescue-')))
})

test('recovery preserves the last good .bak if the primary corrupts again', async t => {
  const { base, dataDir } = await startServer(t)
  const put = body => fetch(`${base}/api/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  await put(payload())
  await put(payload({ subs: [] }))
  fs.writeFileSync(path.join(dataDir, 'subtracker-data.json'), 'corrupted')
  await fetch(`${base}/api/data`)
  const backup = JSON.parse(fs.readFileSync(path.join(dataDir, 'subtracker-data.json.bak'), 'utf8'))
  assert.equal(backup.subs[0].name, 'Netflix')
})

test('opaque and unrelated loopback origins cannot write or reset', async t => {
  const { base } = await startServer(t)
  for (const origin of ['null', 'http://localhost:65534', 'https://localhost:5280', 'file://']) {
    for (const method of ['POST', 'DELETE']) {
      const res = await fetch(`${base}/api/data`, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(payload()) } : {}) })
      assert.equal(res.status, 403, `${method} ${origin}`)
    }
  }
})

test('stale browser saves cannot overwrite newer disk content', async t => {
  const { base } = await startServer(t)
  const put = body => fetch(`${base}/api/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const first = await (await put(payload({ baseRevision: null }))).json()
  const secondPayload = payload({ baseRevision: first.revision, settings: { currency: 'USD', budget: 250 } })
  const second = await (await put(secondPayload)).json()
  assert.notEqual(second.revision, first.revision)
  assert.equal((await put(payload({ baseRevision: first.revision }))).status, 409)
  assert.equal((await (await fetch(`${base}/api/data`)).json()).settings.budget, 250)
  // The same state from a second tab is acknowledged without an extra write.
  const repeated = await (await put(secondPayload)).json()
  assert.equal(repeated.revision, second.revision)
  assert.equal((await put(payload({ baseRevision: second.revision }))).status, 200)
})

test('unrecoverable files are reported as unavailable rather than empty', async t => {
  const { base, dataDir } = await startServer(t)
  fs.writeFileSync(path.join(dataDir, 'subtracker-data.json'), '{corrupt')
  assert.equal((await (await fetch(`${base}/api/status`)).json()).exists, true)
  assert.equal((await fetch(`${base}/api/data`)).status, 503)
  assert.equal(fs.readFileSync(path.join(dataDir, 'subtracker-data.json'), 'utf8'), '{corrupt')
})
