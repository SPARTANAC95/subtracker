// SubTracker service worker: keeps the app shell available when the local
// server is not running, without ever getting between the app and its data.
//
//   /api/*      never touched — data always goes straight to the server
//   the page    network first, the cached copy when the server is unreachable
//   /assets/*   cache first — content-hashed, so a cached file never changes
//   the rest    (icon, manifest) cached copy now, refreshed in the background

const CACHE_PREFIX = 'subtracker-'
const CACHE = 'subtracker-v7'
const scoped = path => new URL(path, self.registration.scope).href
const PRECACHE = [scoped('./'), scoped('index.html'), scoped('manifest.json'), scoped('icon.svg')]
const ASSETS_PATH = new URL('assets/', self.registration.scope).pathname

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

const cacheable = resp => resp && resp.status === 200 && resp.type === 'basic'

async function store(req, resp) {
  try { await (await caches.open(CACHE)).put(req, resp) } catch {}
}

// A rebuild gives every asset a new name and the old ones are never asked
// for again. When the page that just arrived points at an entry script the
// cache has not seen, a new build is live: drop the previous build's code
// instead of letting it pile up. Fonts stay — they keep their name from one
// build to the next, and the browser would not ask for them again.
async function pruneOldBuild(html) {
  try {
    const entry = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1]
    if (!entry) return
    const cache = await caches.open(CACHE)
    if (await cache.match(scoped(entry.replace(/^\//, '')))) return
    const stale = req => {
      const { pathname } = new URL(req.url)
      return pathname.startsWith(ASSETS_PATH) && /\.(js|css)$/.test(pathname)
    }
    await Promise.all((await cache.keys()).filter(stale).map(req => cache.delete(req)))
  } catch {}
}

async function freshPage(req) {
  const resp = await fetch(req)
  if (cacheable(resp)) {
    // Finished before the page is handed over, so it cannot race the page's
    // own requests for the new build's files.
    await pruneOldBuild(await resp.clone().text())
    await store(req, resp.clone())
  }
  return resp
}

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Data sync must always hit the local server directly — a cached /api
  // response would hand the app stale data or fake a successful save.
  if (url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      freshPage(req).catch(() => caches.match(req).then(cached => cached || caches.match(scoped('index.html'))))
    )
    return
  }

  const update = () => fetch(req).then(resp => {
    if (cacheable(resp)) e.waitUntil(store(req, resp.clone()))
    return resp
  })

  // Hashed build files never change under the same name: once cached there
  // is nothing to check with the server.
  if (url.pathname.startsWith(ASSETS_PATH)) {
    e.respondWith(caches.match(req).then(cached => cached || update()))
    return
  }

  const refreshed = update()
  e.respondWith(caches.match(req).then(cached => cached || refreshed.catch(() => cached)))
  e.waitUntil(refreshed.catch(() => undefined))
})
