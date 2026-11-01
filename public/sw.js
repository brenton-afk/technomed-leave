// ─── The service worker: notifications, and opening on a weak signal ─────────
// It began as notifications only, with a warning against ever adding a fetch
// handler: a worker that serves the app from its own cache is the usual reason
// a phone keeps running last week's build, and this app lost an afternoon to
// exactly that.
//
// That warning still governs how this is written. What changed is the cost of
// having nothing: "the portal not loading in the Calvary corridor and theatre
// 6". With no worker in the way, one bar of signal meant a navy screen for most
// of a minute, or for ever.
//
// So the rules are narrow, and each one is about not pinning an old build:
//
//   · The page itself (index.html) is NETWORK FIRST. Online, it always comes
//     from the server, so a deploy is seen exactly as it was before. The saved
//     copy is used only when the network fails or has not answered in
//     NAV_TIMEOUT_MS — and appVersion.js still offers the reload as soon as a
//     newer build is reachable.
//   · Built files under /assets/ are content-hashed, so a name is one version
//     for ever and caching them can never serve a stale one. Cache first.
//   · Nothing under /api/ is touched. Bookings carry patient surnames, and
//     whether those are kept on a phone is a decision for a person, not a
//     side effect of a cache. See PORTAL_FIXES.md, Task 7.
//   · /vendor/ (the 11MB scanner engine) is left to the HTTP cache, which
//     already keeps it for a year; a second copy here would double it.

const SHELL_CACHE = 'tm-shell-v1'
const ASSET_CACHE = 'tm-assets-v1'
const KEEP_ASSETS = 80
const NAV_TIMEOUT_MS = 5000

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TechnoMed</title></head>
<body style="margin:0;background:#042746;color:#fff;font:16px/1.4 -apple-system,system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;box-sizing:border-box">
<div><p style="font-size:20px;font-weight:700;margin:0 0 8px">No signal</p>
<p style="margin:0 0 20px;opacity:.85">The portal will open as soon as this phone is back in range.</p>
<button onclick="location.reload()" style="font:inherit;font-weight:700;padding:12px 28px;border:0;border-radius:10px;background:#189a85;color:#fff">Try again</button></div>
</body></html>`

// Take over straight away rather than waiting for every tab to close. There is
// nothing here for an old worker to be in the middle of.
self.addEventListener('install', event => {
  self.skipWaiting()
  // The first visit is loaded before this worker is in charge, so nothing it
  // fetched passed through here to be kept. Without this, a phone that opened
  // the portal once and then walked into theatre 6 would get "No signal". Best
  // effort: a failure here only means the copy is saved on the next visit.
  event.waitUntil(saveShell().catch(() => {}))
})

/** Saves the current page and the built files it names. */
async function saveShell() {
  const response = await fetch('/', { cache: 'no-store' })
  if (!response.ok) return
  const body = await response.clone().text()
  await (await caches.open(SHELL_CACHE)).put('/', response)
  const assets = await caches.open(ASSET_CACHE)
  const named = [...body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1])
  for (const path of [...named, '/logo.png', '/icon-192.png', '/manifest.json']) {
    if (!(await assets.match(path))) {
      const file = await fetch(path)
      if (file.ok) await assets.put(path, file)
    }
  }
}
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Only this worker's caches survive a change of version.
  const keep = new Set([SHELL_CACHE, ASSET_CACHE])
  for (const name of await caches.keys()) if (!keep.has(name)) await caches.delete(name)
  await self.clients.claim()
})()))

/** Keeps the asset cache to its newest KEEP_ASSETS entries. */
async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE)
  const keys = await cache.keys()
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_ASSETS))) await cache.delete(old)
}

/** The page: network first, the saved copy only on failure or a stall. */
async function page(request) {
  const cache = await caches.open(SHELL_CACHE)
  const network = fetch(request).then(async response => {
    // Only a real copy of the app is kept — never an error page.
    if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
      await cache.put('/', response.clone())
    }
    return response
  })

  const saved = await cache.match('/')
  if (!saved) {
    return network.catch(() => new Response(OFFLINE_PAGE, {
      status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    }))
  }

  // A stall is not a failure — a weak signal can hold a request open for a
  // minute. After NAV_TIMEOUT_MS the saved copy is shown, and the network
  // answer, if it comes, refreshes the copy for next time.
  let timer
  const stalled = new Promise(resolve => { timer = setTimeout(() => resolve(saved), NAV_TIMEOUT_MS) })
  try {
    return await Promise.race([network, stalled])
  } catch {
    return saved
  } finally {
    clearTimeout(timer)
  }
}

/** A content-hashed file: the name is the version, so cache first. */
async function asset(request) {
  const cache = await caches.open(ASSET_CACHE)
  // ignoreVary: a module script is requested with an Origin header and served
  // with "Vary: Origin", so the copy saved at install (no Origin) would never
  // match it. A hashed file is the same bytes whoever asks.
  const saved = await cache.match(request, { ignoreVary: true })
  if (saved) return saved
  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    trimAssets().catch(() => {})
  }
  return response
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Never the API. See the note at the top.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(page(request))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(asset(request))
    return
  }
  // Icons and the manifest keep their names across deploys, so they are not
  // safe to serve cache-first: online they come from the server, and the saved
  // copy is only for when there is no answer at all.
  if (/^\/(icon-192|icon-512|apple-touch-icon|favicon|logo)\.png$/.test(url.pathname)
    || url.pathname === '/manifest.json') {
    event.respondWith(fresh(request))
  }
})

/** Network first, the saved copy when there is no network. */
async function fresh(request) {
  const cache = await caches.open(ASSET_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return (await cache.match(request, { ignoreVary: true })) || Response.error()
  }
}

self.addEventListener('push', event => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // A push that is not JSON is not one of ours. Showing something is still
    // better than silence: iOS revokes the permission of a site that receives a
    // push and displays no notification.
    payload = {}
  }

  const title = payload.title || 'TechnoMed'
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || '',
    // One per channel, replaced rather than stacked. Six messages in the spine
    // channel is one conversation, not six things to dismiss on a lock screen.
    tag: payload.tag || 'technomed',
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: payload.url || '/' }
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = event.notification.data?.url || '/'

  // Focus the app if it is already open — on a phone it usually is, sitting
  // behind the lock screen — and only open a window when it is not.
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of open) {
      if ('focus' in client) {
        if ('navigate' in client && target !== '/') await client.navigate(target).catch(() => {})
        return client.focus()
      }
    }
    return self.clients.openWindow(target)
  })())
})
