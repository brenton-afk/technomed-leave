// ─── The service worker, for notifications and nothing else ──────────────────
// A web push notification can only be delivered through a service worker. That
// is the entire reason this file exists.
//
// It deliberately does NOT handle `fetch`. A service worker that caches the app
// shell is the usual reason a phone keeps running a build from last week, and
// this app has already lost an afternoon to exactly that: a change was live on
// the server, verified in the bundle, and invisible on the phone that had the
// tab open. Adding a cache here would make that permanent rather than a reload
// away. Notifications are worth a service worker; offline support is not worth
// that risk, and nobody has asked for it.
//
// So: no fetch handler, no caches, no precache manifest. If this file ever
// grows one, read the paragraph above first.

// Take over straight away rather than waiting for every tab to close. There is
// nothing here for an old worker to be in the middle of.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

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
