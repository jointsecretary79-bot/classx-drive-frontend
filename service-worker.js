// Runs in the background — this is what lets a notification arrive even when
// the app tab (or the phone screen) is closed.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Build links relative to where the app lives (works inside /classx-drive-frontend/ on GitHub Pages)
const SCOPE = self.registration.scope;
const ICON = new URL('icon-192.png', SCOPE).href;
function resolveUrl(u) {
  if (!u || u === '/') return SCOPE;
  try { return new URL(u, SCOPE).href; } catch { return SCOPE; }
}

self.addEventListener('push', (event) => {
  let data = { title: 'Class X Drive', body: 'New update posted.', url: '' };
  try {
    data = Object.assign(data, event.data.json());
  } catch {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil((async () => {
    const isAlarm = data.type === 'alarm';

    // The app is open and on screen → it already rings by itself, so skip the duplicate notification.
    if (isAlarm) {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (wins.some((w) => w.visibilityState === 'visible')) return;
    }

    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: ICON,
      badge: ICON,
      data: { url: resolveUrl(data.url) },
      tag: data.tag || undefined,
      renotify: !!data.tag,
      // alarms: longer vibration and stay on screen until tapped; normal updates: same as before
      vibrate: isAlarm ? [300, 150, 300, 150, 300, 150, 300] : [100, 50, 100],
      requireInteraction: isAlarm,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || SCOPE;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
