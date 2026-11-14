// Service Worker cho PWA Điểm Danh LH-TECH
const CACHE_NAME = 'lhtech-pwa-v5';
const STATIC_ASSETS = [
  './',
  './index.html',
  './checkin.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request) || caches.match('./checkin.html'))
    );
    return;
  }
  if (event.request.url.includes('/icons/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});

// ==============================================================
// WEB PUSH NOTIFICATION (PWA)
// ==============================================================
self.addEventListener('push', (event) => {
  let data = {
    title: 'LH-TECH Điểm Danh',
    body: 'Bạn có thông báo mới.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: './app.html' }
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = Object.assign(data, parsed);
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || './icons/icon-192.png',
    badge: data.badge || './icons/icon-192.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'lhtech-push-' + Date.now(),
    renotify: true,
    data: data.data || { url: './app.html' }
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './app.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('app.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});


