/* VETO PARTY offline shell
 *
 * The game state already lives in the browser. This worker keeps the static
 * app shell available if a Vercel edge or the user's route to it times out.
 * It never caches API responses, room state, relay traffic, or game packets.
 */

const VERSION = 'veto-shell-v2'
const STATIC_CACHE = `${VERSION}-static`
const PAGE_CACHE = `${VERSION}-pages`
const SHELLS = ['/', '/room', '/icon.svg']

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(PAGE_CACHE)
    // One failed edge request must not abort installation of the other shells.
    await Promise.allSettled(SHELLS.map(async url => {
      const response = await fetch(url, { cache: 'reload' })
      if (response.ok) await cache.put(url, response)
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names
      .filter(name => name.startsWith('veto-shell-') && name !== STATIC_CACHE && name !== PAGE_CACHE)
      .map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

const withTimeout = (request, ms) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer))
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Content-hashed Next assets are immutable. Cache-first is safe across
  // deployments because a changed file always has a different URL.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/_next/image/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        const cache = await caches.open(STATIC_CACHE)
        await cache.put(request, response.clone())
      }
      return response
    })())
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Prefer a fresh deployment, but do not leave the browser spinning for
        // a minute when an edge path is dead.
        const response = await withTimeout(request, 4500)
        if (response.ok) {
          const cache = await caches.open(PAGE_CACHE)
          const shellKey = url.pathname.startsWith('/room/') ? '/room' : url.pathname
          await cache.put(shellKey, response.clone())
        }
        return response
      } catch {
        const cache = await caches.open(PAGE_CACHE)
        if (url.pathname.startsWith('/room/')) {
          const room = await cache.match('/room')
          if (room) return room
        }
        const exact = await cache.match(url.pathname)
        if (exact) return exact
        const home = await cache.match('/')
        if (home) return home
        return new Response('Veto Party is temporarily unreachable.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
    })())
  }
})
