// SubTracker local app server.
//
// Serves the built app and keeps the user's data in a real file on disk:
//
//   data/subtracker-data.json        the live data file (also a valid backup —
//                                    it can be imported through Settings anywhere)
//   data/subtracker-data.json.bak    the previous version, kept on every write
//   data/backups/subtracker-*.json   one snapshot per day, newest 30 kept
//
// Zero dependencies — plain Node built-ins — so a non-technical user only
// needs Node installed (which the app already required). Binds loopback only;
// nothing is ever exposed to the network.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.SUBTRACKER_PORT !== undefined ? Number(process.env.SUBTRACKER_PORT) : 5273
const DATA_DIR = process.env.SUBTRACKER_DATA_DIR || path.join(ROOT, 'data')
const DIST_DIR = path.join(ROOT, 'dist')
const DATA_FILE = path.join(DATA_DIR, 'subtracker-data.json')
const BAK_FILE = `${DATA_FILE}.bak`
// An intentional reset must not be mistaken for a lost primary file.
const RESET_FILE = path.join(DATA_DIR, 'last-reset.json')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const KEEP_DAILY_BACKUPS = 30
const MAX_BODY_BYTES = 20 * 1024 * 1024
// launch.bat has always opened http://localhost:5273/ — browser storage is
// scoped to that exact host string, so the app must keep living there.
const APP_URL = `http://localhost:${PORT || 5273}/`
const SHOULD_OPEN = process.argv.includes('--open')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
}

function dateStamp(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function listDailyBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(name => /^subtracker-\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

function looksLikeSubtrackerData(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value)
    && value.app === 'subtracker-pro'
    && Array.isArray(value.subs)
    && (value.settings === null || value.settings === undefined || (typeof value.settings === 'object' && !Array.isArray(value.settings)))
    && (value.dismissed === undefined || Array.isArray(value.dismissed))
  )
}

function revisionOf(payload) {
  return payload ? payload.revision || createHash('sha256').update(JSON.stringify(payload)).digest('hex') : null
}

function sameContent(a, b) {
  return b && ['subs', 'settings', 'dismissed'].every(key => JSON.stringify(a[key] ?? null) === JSON.stringify(b[key] ?? null))
}

function readResetAt() {
  try { return JSON.parse(fs.readFileSync(RESET_FILE, 'utf8')).resetAt || 0 } catch { return 0 }
}

function hasUnrecoveredFiles() {
  const resetAt = readResetAt()
  return [DATA_FILE, BAK_FILE, ...listDailyBackups().map(name => path.join(BACKUP_DIR, name))].some(file => {
    try { return !resetAt ? fs.existsSync(file) : fs.statSync(file).mtimeMs > resetAt } catch { return false }
  })
}

// Read the data file, falling back to .bak and then to daily backups if the
// primary is missing or corrupted. A successful fallback heals the primary.
function readDataResilient() {
  const resetAt = readResetAt()
  const candidates = [DATA_FILE, BAK_FILE, ...listDailyBackups().map(name => path.join(BACKUP_DIR, name))]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      if (!looksLikeSubtrackerData(parsed)) continue
      if (resetAt && (Date.parse(parsed.savedAt || '') || fs.statSync(candidate).mtimeMs) <= resetAt) continue
      if (candidate !== DATA_FILE) {
        console.warn(`[subtracker] Primary data file unreadable — recovered from ${path.basename(candidate)}`)
        try { writeDataFile(parsed) } catch { /* recovery still served from memory */ }
      }
      return parsed
    } catch { /* try the next candidate */ }
  }
  return null
}

// Atomic write: serialize first, snapshot the previous version, write to a
// temp file, then rename over the target. A crash mid-write can never
// truncate the last good file.
function writeDataFile(payload) {
  const serialized = JSON.stringify(payload, null, 2)
  ensureDirs()
  if (fs.existsSync(DATA_FILE)) {
    // Never replace the last good backup with the corrupt primary during recovery.
    let validPrevious = false
    try { validPrevious = looksLikeSubtrackerData(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))) } catch { /* corrupt */ }
    if (validPrevious) {
      try { fs.copyFileSync(DATA_FILE, BAK_FILE) } catch { /* best effort */ }
    }
  }
  const tmp = `${DATA_FILE}.tmp`
  fs.writeFileSync(tmp, serialized)
  fs.renameSync(tmp, DATA_FILE)

  // One snapshot per day (overwritten through the day so it always holds the
  // day's final state), then prune to the newest N.
  try {
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `subtracker-${dateStamp()}.json`))
    listDailyBackups().slice(KEEP_DAILY_BACKUPS).forEach(name => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, name)) } catch { /* best effort */ }
    })
  } catch { /* backups are best effort; the primary write already succeeded */ }
}

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

// The server only ever binds loopback, but any web page open in the same
// browser can still fire requests at http://localhost:5273. Two checks keep
// the data file private to the app itself:
//   Host    — must name this machine (defeats DNS-rebinding reads)
//   Origin  — when a browser sends one, it must be a loopback origin too
//             (defeats cross-site writes and resets from another tab)
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function hostnameOf(value) {
  try {
    const text = String(value || '')
    return new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isLocalRequest(req) {
  if (!LOCAL_HOSTNAMES.has(hostnameOf(req.headers.host))) return false
  const origin = req.headers.origin
  if (origin) {
    try {
      const parsed = new URL(origin)
      // Only the app and its documented Vite development origin may mutate data.
      const allowedPorts = new Set([String(req.socket.localPort), '5280'])
      if (parsed.protocol !== 'http:' || !LOCAL_HOSTNAMES.has(parsed.hostname) || !allowedPorts.has(parsed.port)) return false
    } catch { return false }
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  return true
}

function isJsonRequest(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('application/json')
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/status' && req.method === 'GET') {
    // Recover here too: clients use status.exists before requesting the data.
    const exists = Boolean(readDataResilient()) || hasUnrecoveredFiles()
    let lastSaved = null
    if (exists) {
      try { lastSaved = fs.statSync(DATA_FILE).mtime.toISOString() } catch { /* stat is cosmetic */ }
    }
    sendJson(res, 200, {
      ok: true,
      app: 'subtracker-pro',
      dataFile: DATA_FILE,
      exists,
      lastSaved,
      backups: listDailyBackups().length,
      resetAt: readResetAt(),
    })
    return
  }

  if (pathname === '/api/data' && req.method === 'GET') {
    const payload = readDataResilient()
    if (!payload) {
      if (hasUnrecoveredFiles()) sendJson(res, 503, { error: 'Data files are unreadable; existing files were preserved' })
      else sendJson(res, 404, { exists: false })
      return
    }
    sendJson(res, 200, { ...payload, revision: revisionOf(payload) })
    return
  }

  // PUT is the normal save; POST accepts the same body so the browser's
  // sendBeacon (POST-only) can flush unsaved changes as a tab closes.
  if (pathname === '/api/data' && (req.method === 'PUT' || req.method === 'POST')) {
    // A cross-site form or text/plain beacon can reach a loopback port
    // without a CORS preflight; only genuine JSON bodies are accepted.
    if (!isJsonRequest(req)) { sendJson(res, 415, { error: 'Body must be application/json' }); return }
    let payload
    try { payload = JSON.parse(await readBody(req)) } catch { sendJson(res, 400, { error: 'Body must be JSON' }); return }
    if (!looksLikeSubtrackerData(payload)) { sendJson(res, 400, { error: 'Not SubTracker data' }); return }
    const current = readDataResilient()
    if (Object.hasOwn(payload, 'baseRevision') && payload.baseRevision !== revisionOf(current)) {
      // Identical cross-tab storage events are harmless. Different stale
      // content must never erase another browser's edits.
      if (sameContent(payload, current)) {
        sendJson(res, 200, { ok: true, savedAt: current.savedAt, revision: revisionOf(current) })
      } else sendJson(res, 409, { conflict: true, error: 'Data changed in another browser' })
      return
    }
    const resetAt = readResetAt()
    const savedAt = new Date(Math.max(Date.now(), resetAt + 1)).toISOString()
    try {
      const revision = randomUUID()
      const { baseRevision: _baseRevision, ...data } = payload
      writeDataFile({ ...data, savedAt, revision })
      sendJson(res, 200, { ok: true, savedAt, revision })
    } catch (error) {
      console.error('[subtracker] Write failed', error)
      sendJson(res, 500, { error: 'Could not write the data file' })
    }
    return
  }

  // Factory reset. The current file is moved into backups first, so even a
  // reset leaves a dated rescue copy behind.
  if (pathname === '/api/data' && req.method === 'DELETE') {
    try {
      if (fs.existsSync(DATA_FILE)) {
        ensureDirs()
        const rescue = path.join(BACKUP_DIR, `rescue-${dateStamp()}-${Date.now().toString(36)}.json`)
        fs.copyFileSync(DATA_FILE, rescue)
      }
      // Commit the reset before removing files; even a crash here cannot revive
      // pre-reset daily snapshots. Rescue copies remain available for manual import.
      const marker = `${RESET_FILE}.tmp`
      fs.writeFileSync(marker, JSON.stringify({ resetAt: Date.now() }))
      fs.renameSync(marker, RESET_FILE)
      if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE)
      try { fs.unlinkSync(BAK_FILE) } catch { /* may not exist */ }
      sendJson(res, 200, { ok: true })
    } catch (error) {
      console.error('[subtracker] Reset failed', error)
      sendJson(res, 500, { error: 'Could not reset the data file' })
    }
    return
  }

  // Opens the data folder in the file manager. Fixed path, no parameters —
  // nothing request-controlled reaches the shell.
  if (pathname === '/api/open-folder' && req.method === 'POST') {
    ensureDirs()
    if (process.platform === 'win32') exec(`explorer "${DATA_DIR}"`)
    else if (process.platform === 'darwin') exec(`open "${DATA_DIR}"`)
    else exec(`xdg-open "${DATA_DIR}"`)
    sendJson(res, 200, { ok: true })
    return
  }

  sendJson(res, 404, { error: 'Unknown API route' })
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return
  }

  let relative
  try { relative = decodeURIComponent(pathname) } catch { res.writeHead(400); res.end(); return }
  relative = path.normalize(relative).replace(/^([/\\])+/, '')
  let filePath = relative ? path.join(DIST_DIR, relative) : path.join(DIST_DIR, 'index.html')

  // Path traversal guard + SPA fallback for client-side routes.
  const withinDist = filePath === DIST_DIR || filePath.startsWith(DIST_DIR + path.sep)
  if (!withinDist || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // Only extension-less paths are app routes. A missing *file* — typically
    // a hashed chunk from a previous build that a cached page still asks for —
    // must be a real 404: answering it with index.html handed the browser
    // HTML where it expected JavaScript, and the service worker then cached
    // that wrong answer under the script's URL.
    if (path.extname(relative)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('Not found')
      return
    }
    filePath = path.join(DIST_DIR, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('SubTracker has not been built yet. Run launch.bat (or: npm run build).')
    return
  }

  const ext = path.extname(filePath).toLowerCase()
  // Hashed assets are immutable; everything else (index.html, sw.js,
  // manifest, icons) must always revalidate so updates land instantly.
  const immutable = filePath.startsWith(path.join(DIST_DIR, 'assets') + path.sep)
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') { res.end(); return }
  fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res)
}

function handler(req, res) {
  let pathname
  try { pathname = new URL(req.url, 'http://localhost').pathname } catch { res.writeHead(400); res.end(); return }
  if (pathname.startsWith('/api/')) {
    if (!isLocalRequest(req)) { sendJson(res, 403, { error: 'Local requests only' }); return }
    handleApi(req, res, pathname).catch(error => {
      console.error('[subtracker] API error', error)
      try { sendJson(res, 500, { error: 'Internal error' }) } catch { /* response already gone */ }
    })
    return
  }
  serveStatic(req, res, pathname)
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`
  exec(command)
}

function listen(host, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.on('error', reject)
    server.listen(port, host, () => resolve(server))
  })
}

async function main() {
  ensureDirs()
  let primary
  try {
    primary = await listen('127.0.0.1', PORT)
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') {
      console.log('SubTracker is already running.')
      if (SHOULD_OPEN) openBrowser(APP_URL)
      process.exit(0)
    }
    throw error
  }

  const port = primary.address().port
  // "localhost" can resolve to IPv6 — listen there too so the one address the
  // user has always used keeps working regardless of how it resolves.
  try { await listen('::1', port) } catch { /* IPv6 loopback unavailable — fine */ }

  console.log(`LISTENING ${port}`)
  console.log('')
  console.log('  SubTracker is running.')
  console.log(`  App:        http://localhost:${port}/`)
  console.log(`  Data file:  ${DATA_FILE}`)
  console.log(`  Backups:    ${BACKUP_DIR} (last ${KEEP_DAILY_BACKUPS} days)`)
  console.log('')
  console.log('  Keep this window open while using SubTracker (minimized is fine).')
  if (SHOULD_OPEN) openBrowser(`http://localhost:${port}/`)
}

main().catch(error => {
  console.error('[subtracker] Failed to start', error)
  process.exit(1)
})
