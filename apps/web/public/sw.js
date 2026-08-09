const BUILD = '__SL_BUILD__'
const VERSION = `soundclear-${BUILD.startsWith('__SL') ? 'dev' : BUILD}`
const ASSET_CACHE = 'sl-assets'
const KEEP = [VERSION, ASSET_CACHE]
const ASSET_LIMIT = 200
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-512.png', '/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => Promise.all(APP_SHELL.map((path) => cache.add(path).catch(() => {}))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !KEEP.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

function offline(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function isStorable(response) {
  if (!response) return false
  if (response.status === 200) return true
  return response.status === 0 && response.type === 'opaque'
}

async function trim(cache) {
  const keys = await cache.keys()
  const excess = keys.length - ASSET_LIMIT
  if (excess <= 0) return
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)))
}

async function store(cacheName, key, response) {
  try {
    const cache = await caches.open(cacheName)
    await cache.put(key, response)
    return cache
  } catch {
    return null
  }
}

async function storeAsset(key, response) {
  const cache = await store(ASSET_CACHE, key, response)
  if (!cache) return
  try {
    await trim(cache)
  } catch {}
}

async function navigation(event, request) {
  try {
    const response = await fetch(request)
    if (response.status === 200) event.waitUntil(store(VERSION, '/index.html', response.clone()))
    return response
  } catch {
    const cache = await caches.open(VERSION)
    const cached = (await cache.match('/index.html')) || (await cache.match('/'))
    return cached || offline('sin conexión')
  }
}

async function cacheFirst(event, request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.status === 200) event.waitUntil(store(cacheName, request, response.clone()))
    return response
  } catch {
    return offline('sin conexión')
  }
}

async function assetFirst(event, request) {
  const key = request.url
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(key, { ignoreVary: true })
  if (cached) {
    event.waitUntil(store(ASSET_CACHE, key, cached.clone()))
    return cached
  }
  try {
    const response = await fetch(request)
    if (isStorable(response)) event.waitUntil(storeAsset(key, response.clone()))
    return response
  } catch {
    return offline('sin conexión')
  }
}

async function networkOnly(request) {
  try {
    return await fetch(request)
  } catch {
    return offline('sin conexión')
  }
}

function isCacheableAsset(url, request) {
  if (request.headers.has('range')) return false
  if (request.destination === 'audio' || request.destination === 'video') return false
  if (url.hostname === 'wave.sndcdn.com') return true
  return /^i\d*\.sndcdn\.com$/.test(url.hostname)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(navigation(event, request))
      return
    }
    if (url.pathname === '/sl-proxy' || url.pathname === '/sl-client-id') {
      event.respondWith(networkOnly(request))
      return
    }
    event.respondWith(cacheFirst(event, request, VERSION))
    return
  }

  if (isCacheableAsset(url, request)) event.respondWith(assetFirst(event, request))
})
