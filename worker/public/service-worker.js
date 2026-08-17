const CACHE_NAME = 'token-m-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/token-m.svg',
  '/icons/token-m-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/v1/')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && !url.pathname.startsWith('/v1/')) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('/index.html');
      return Response.error();
    }
  })());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {}

  const title = safeString(payload.title, 80) || 'Token M';
  const body = safeString(payload.body, 240) || 'A Codex task completed.';
  const tag = safeString(payload.tag, 160) || safeString(payload.eventId, 160) || 'token-m-completion';
  const url = sameOriginPath(payload.url);

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    data: { url },
    icon: '/icons/token-m.svg',
    badge: '/icons/token-m.svg',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(sameOriginPath(event.notification.data?.url), self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      if ('navigate' in existing) await existing.navigate(targetUrl);
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});

function safeString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function sameOriginPath(value) {
  if (typeof value !== 'string') return '/';
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
