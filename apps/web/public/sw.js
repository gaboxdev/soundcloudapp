const VERSION = 'soundlite-v1'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request)
          .then((response) => {
            const copy = response.clone()
            caches.open(VERSION).then((cache) => cache.put('/index.html', copy))
            return response
          })
          .catch(() => caches.match('/index.html')),
      )
      return
    }
    if (url.pathname.startsWith('/assets/')) {
      event.respondWith(
        caches.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              const copy = response.clone()
              caches.open(VERSION).then((cache) => cache.put(request, copy))
              return response
            }),
        ),
      )
      return
    }
    if (url.pathname === '/sl-proxy' || url.pathname === '/sl-client-id') {
      event.respondWith(fetch(request).catch(() => new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } })))
      return
    }
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)))
    return
  }

  if (url.hostname.endsWith('sndcdn.com') || url.hostname === 'soundcloud.com') {
    const key = request.url.replace(/-t\d{3,4}x\d{3,4}/, '')
    const cacheRequest = new Request(key, { method: 'GET', mode: 'cors' })
    event.respondWith(
      caches.open('sl-media').then(async (cache) => {
        const cached = await cache.match(cacheRequest)
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(cacheRequest, response.clone())
            return response
          })
          .catch(() => null)
        if (cached) {
          network.then(() => {})
          return cached
        }
        return (await network) || cached
      }),
    )
  }
})
