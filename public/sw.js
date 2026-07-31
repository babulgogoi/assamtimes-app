// Service worker for Web Push. Registered from push.js with the default
// (root) scope, so it can receive push events for the whole site.
//
// Nothing sends a push yet — this app only captures/stores subscriptions
// for now (see src/routes/push.js) — but a push subscription can't be
// created at all without an active service worker, so this has to exist
// and be registered before the Subscribe button can do anything.

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Assam Times', body: event.data ? event.data.text() : '' };
  }

  var title = data.title || 'Assam Times';
  var options = {
    body: data.body || '',
    icon: '/uploads/branding/android-chrome-192x192.png',
    badge: '/uploads/branding/android-chrome-192x192.png',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].url === url && 'focus' in clients[i]) {
          return clients[i].focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
