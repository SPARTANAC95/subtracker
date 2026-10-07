const CACHE_PREFIX = 'subtracker-'
const CACHE = 'subtracker-v6'
const scoped = path => new URL(path, self.registration.scope).href
const PRECACHE = [scoped('./'), scoped('index.html'), scoped('manifest.json'), scoped('icon.svg')]

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
      fetch(req).then(async resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          try { await (await caches.open(CACHE)).put(req, resp.clone()) } catch {}
        }
        return resp
      }).catch(() => caches.match(req).then(cached => cached || caches.match(scoped('index.html'))))
    )
    return
  }

  const update = fetch(req).then(async resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          try { await (await caches.open(CACHE)).put(req, resp.clone()) } catch {}
        }
        return resp
      })

  e.respondWith(caches.match(req).then(cached => cached || update.catch(() => cached)))
  e.waitUntil(update.catch(() => undefined))
})
