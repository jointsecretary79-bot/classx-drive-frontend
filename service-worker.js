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
const STATUS_TAG = 'classx-upcoming';

// ---------- the "Upcoming" notification that stays in the notification bar ----------
function fmtWhen(at) {
  const d = new Date(at), now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today0) / 864e5);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (day === 0) return 'Today ' + time;
  if (day === 1) return 'Tomorrow ' + time;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + time;
}

async function showStatus(items, enabled, dedupe) {
  if (enabled === false) {                                   // person switched it off
    const open = await self.registration.getNotifications({ tag: STATUS_TAG });
    open.forEach((n) => n.close());
    return;
  }
  if (Notification.permission !== 'granted') return;
  items = (items || []).filter((i) => i && i.at > Date.now()).slice(0, 3);
  let title, body;
  if (!items.length) {
    title = 'Class X Drive';
    body = 'Nothing planned yet — open the app to plan your study.';
  } else {
    title = 'Next: ' + items[0].label + ' · ' + fmtWhen(items[0].at);
    body = items.slice(1).map((i) => i.label + ' · ' + fmtWhen(i.at)).join('\n') || 'Tap to open your planner';
  }
  if (dedupe) {                                              // same text already showing → leave it alone (do not pop it up again)
    const existing = await self.registration.getNotifications({ tag: STATUS_TAG });
    if (existing.some((n) => n.title === title && n.body === body)) return;
  }
  await self.registration.showNotification(title, {
    body,
    icon: ICON,
    badge: ICON,
    tag: STATUS_TAG,          // same tag = the notification is updated in place, not duplicated
    renotify: false,
    silent: true,             // quiet, like a status notification
    requireInteraction: true, // stays until the person dismisses it
    data: { url: SCOPE },
  });
}

// ---------- running timer / stopwatch shown in the notification bar ----------
// (a web notification cannot tick live seconds, so it shows the end time / start time)
function clock(ms) { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function span(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + x + 's';
}
async function closeByTag(tag) {
  const open = await self.registration.getNotifications({ tag });
  open.forEach((n) => n.close());
}
async function showTimerNote(d) {
  if (d.kind === 'none') { await closeByTag(d.tag); return; }
  if (Notification.permission !== 'granted') return;
  let title, body;
  if (d.kind === 'timer') { title = '⏱ Timer running'; body = 'Ends at ' + clock(d.endAt) + ' — you will be alerted.'; }
  else if (d.kind === 'timer-paused') { title = '⏸ Timer paused'; body = span(d.left) + ' left'; }
  else if (d.kind === 'stopwatch') { title = '⏱ Stopwatch running'; body = 'Started at ' + clock(d.startedAt) + ' · open the app to see the time'; }
  else { title = '⏸ Stopwatch stopped'; body = 'Elapsed ' + span(d.elapsed); }
  await self.registration.showNotification(title, {
    body, icon: ICON, badge: ICON, tag: d.tag, renotify: false, silent: true, requireInteraction: true, data: { url: SCOPE },
  });
}

// the open app tells the worker what is coming up / what is running
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'status') event.waitUntil(showStatus(d.upcoming, d.enabled, true));
  else if (d.type === 'timer') event.waitUntil(showTimerNote(d));
});

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
    // refresh of the always-there "Upcoming" notification (sent by the server)
    if (data.type === 'status') { await showStatus(data.upcoming, true); return; }

    const isAlarm = data.type === 'alarm';
    if (isAlarm && data.tag === 'alarm-timer') await closeByTag('classx-timer');   // timer finished → remove the "running" notification

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
      silent: false,          // play the notification sound
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
