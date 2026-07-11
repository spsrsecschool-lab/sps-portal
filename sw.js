// Service Worker for SPS Portal Push Notifications
// Handles background push messages and notification clicks

self.addEventListener('install', event => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

// Receive push message and show notification
self.addEventListener('push', event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'New Message', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Shiv Public School'
  const options = {
    body: data.body || 'You have a new notification',
    icon: data.icon || '/icon-192.png',
    badge: '/badge-72.png',
    tag: data.tag || 'sps-message',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    requireInteraction: false
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// Handle notification click — focus or open the portal
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus()
        }
      }
      // Otherwise open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})
