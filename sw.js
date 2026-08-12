self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Service worker active for PWA support
});

// PostMessage Event (Local Trigger via Service Worker)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    self.registration.showNotification(title, options);
  }
});

// Push Notification Event Listener for Cloud Push
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'GasTracker Alert';
  const options = {
    body: data.body || 'Gas status updated.',
    icon: 'https://cdn-icons-png.flaticon.com/512/785/785116.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/785/785116.png',
    vibrate: [200, 100, 200],
    tag: 'gas-tracker-alert',
    renotify: true
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// Notification Click Event Handler
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('/dashboard.html');
    })
  );
});