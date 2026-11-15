import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

self.skipWaiting()
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }))

self.addEventListener('push', (event) => {
  let d = { title: 'Chase 300', body: "Today's wheel is ready!", url: '/' }
  try { d = { ...d, ...event.data.json() } } catch {}
  event.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url }, tag: 'daily-reminder',
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (all.length) return all[0].focus()
    return self.clients.openWindow(event.notification.data?.url || '/')
  })())
})
