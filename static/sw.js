/* ─── Conference Programme — Service Worker ─────────────────────────────────
   Handles Web Push notifications. Served from /sw.js via Flask route.
   ─────────────────────────────────────────────────────────────────────────── */

self.addEventListener('push', function (event) {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); }
    catch (e) { data = { title: 'Conference Update', body: event.data.text() }; }
  }

  const title = data.title || 'Conference Programme';
  const options = {
    body:  data.body  || '',
    icon:  data.icon  || '/static/favicon.ico',
    badge: data.badge || '/static/favicon.ico',
    tag:   data.tag   || 'conference-update',
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
