/* Shell first for offline launches, network first for catalogue updates, bounded photo LRU. */
const VERSION = 'aym-v1';
const SHELL = VERSION + '-shell';
const PHOTOS = VERSION + '-photos';
const DATA = VERSION + '-data';
const base = new URL('./', self.location.href);
const local = (p) => new URL(p, base).href;
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const response = await fetch(local('index.html'), { cache: 'reload' });
      if (!response.ok) throw new Error('Shell unavailable');
      const html = await response.clone().text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
        .map((match) => new URL(match[1], base).href)
        .filter((url) => new URL(url).origin === base.origin);
      await cache.put(local('index.html'), response);
      await cache.addAll([local('manifest.webmanifest'), local('icon.svg'), ...assets]);
      await (await caches.open(DATA)).add(local('catalogue.json'));
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('aym-') && ![SHELL, PHOTOS, DATA].includes(key))
          await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
async function bounded(cache, request, response, limit) {
  // Assets are same-origin and content-addressed. Preview servers can add Vary: Origin,
  // while module/image requests send different Origin headers than install-time fetches.
  await cache.delete(request, { ignoreVary: true });
  await cache.put(request, response);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== base.origin || request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(SHELL);
            await cache.put(local('index.html'), response.clone());
          }
          return response;
        })
        .catch(() => caches.match(local('index.html'), { ignoreVary: true })),
    );
  } else if (url.pathname.endsWith('/catalogue.json')) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) await (await caches.open(DATA)).put(request, response.clone());
          return response;
        })
        .catch(() => caches.open(DATA).then((cache) => cache.match(request, { ignoreVary: true }))),
    );
  } else if (url.pathname.includes('/media/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PHOTOS);
        const hit = await cache.match(request, { ignoreVary: true });
        if (hit) {
          event.waitUntil(bounded(cache, request, hit.clone(), 80));
          return hit;
        }
        const response = await fetch(request);
        if (response.ok) event.waitUntil(bounded(cache, request, response.clone(), 80));
        return response;
      })(),
    );
  } else if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        return (
          (await cache.match(request, { ignoreVary: true })) ||
          (await fetch(request).then((response) => {
            if (response.ok) event.waitUntil(bounded(cache, request, response.clone(), 32));
            return response;
          }))
        );
      })(),
    );
  }
});
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_VIEWED' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PHOTOS);
      for (const path of event.data.urls.slice(0, 3)) {
        const url = new URL(path, base);
        if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname + 'media/'))
          continue;
        try {
          if (await cache.match(url.href, { ignoreVary: true })) continue;
          const response = await fetch(url.href);
          if (response.ok) await bounded(cache, url.href, response, 80);
        } catch {
          /* Offline cache warm-up is best effort. */
        }
      }
    })(),
  );
});
