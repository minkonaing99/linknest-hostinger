importScripts('/js/offline-store.js');
const CACHE = 'linknest-v35';
const PRIVACY_CACHE = 'linknest-offline-privacy';

// Only public assets and the public offline library shell are cached.
const PRECACHE = [
  '/login.html',
  '/offline.html',
  '/offline-library.html',
  '/js/offline-store.js',
  '/js/offline-library.js',
  '/js/settings.js',
  '/css/styles.css',
  '/js/shared.js',
  '/js/undo.js',
  '/js/offline-queue.js',
  '/js/home.js',
  '/js/browse.js',
  '/js/editor.js',
  '/js/editor-import.js',
  '/js/editor-related.js',
  '/js/editor-history.js',
  '/js/login.js',
  '/img/logo-mark.png',
  '/img/icon-192.png',
  '/img/apple-touch-icon.png',
  '/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('sync', event => {
  if (event.tag !== 'linknest-captures') return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    clients.forEach(client => client.postMessage('linknest-sync-captures'));
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== PRIVACY_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

async function purgeProtectedCaches() {
  for (const name of await caches.keys()) {
    if (name === PRIVACY_CACHE) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (!PRECACHE.includes(new URL(request.url).pathname)) await cache.delete(request);
    }
  }
}

async function clearPrivateData(reason) {
  try { await self.LinkNestOfflineStore.invalidate(reason); } catch {}
  try { await purgeProtectedCaches(); } catch {}
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(client => client.postMessage('linknest-offline-invalidated'));
}

self.addEventListener('message', event => {
  if (event.data === 'linknest-clear-private-data') event.waitUntil(clearPrivateData('logout'));

});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const logout = ['/logout', '/api/logout', '/api/v1/logout'].includes(url.pathname);
  if (logout || url.pathname.startsWith('/api/')) {
    event.respondWith((async () => {
      if (logout) await clearPrivateData('logout').catch(() => {});
      try {
        const response = await fetch(request);
        if (response.status === 401) await clearPrivateData('unauthorized');
        return response;
      } catch {
        return new Response(JSON.stringify({ error: 'You are offline. Please check your connection.' }), {
          status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    })());
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      let owner = { userId: null, generation: 0 };
      try { owner = await self.LinkNestOfflineStore.getIdentity(); } catch {}
      let response;
      try { response = await fetch(request); } catch {
        try {
          if (PRECACHE.includes(url.pathname)) {
            const cached = await caches.match(request, { ignoreSearch: true });
            if (cached) return cached;
          } else {
            const current = await self.LinkNestOfflineStore.getIdentity();
            const cachedOwner = await self.LinkNestOfflineStore.request('meta', 'readonly', store => store.get('navigation-owner'));
            if (current.userId && self.LinkNestOfflineStore.sameIdentity(current, cachedOwner)) {
              const cached = await caches.match(request, { ignoreSearch: true });
              if (cached && self.LinkNestOfflineStore.sameIdentity(current, await self.LinkNestOfflineStore.getIdentity())) return cached;
              if (url.pathname === '/editor.html') {
                const editor = await caches.match('/editor.html', { ignoreSearch: true });
                if (editor && self.LinkNestOfflineStore.sameIdentity(current, await self.LinkNestOfflineStore.getIdentity())) return editor;
              }
            }
          }
        } catch {}
        return await caches.match('/offline-library.html') || await caches.match('/offline.html');
      }
      try {
        if (response.status === 401 || (response.redirected && new URL(response.url).pathname === '/login.html')) await clearPrivateData('unauthorized');
        if (response.ok && !response.redirected) {
          if (PRECACHE.includes(url.pathname)) {
            await (await caches.open(CACHE)).put(request, response.clone());
          } else if (owner.userId && self.LinkNestOfflineStore.sameIdentity(owner, await self.LinkNestOfflineStore.getIdentity())) {
            const previous = await self.LinkNestOfflineStore.request('meta', 'readonly', store => store.get('navigation-owner'));
            if (!self.LinkNestOfflineStore.sameIdentity(owner, previous)) await purgeProtectedCaches();
            await self.LinkNestOfflineStore.request('meta', 'readwrite', store => store.put({ id: 'navigation-owner', ...owner }), owner);
            await (await caches.open(CACHE)).put(request, response.clone());
            if (!self.LinkNestOfflineStore.sameIdentity(owner, await self.LinkNestOfflineStore.getIdentity())) await (await caches.open(CACHE)).delete(request);
          }
        }
      } catch {}
      return response;
    })());
    return;
  }
  if (request.method !== 'GET' || !PRECACHE.includes(url.pathname)) return;
  event.respondWith(caches.match(request).catch(() => null).then(cached => cached || fetch(request).then(async response => {
    try { if (response.ok) await (await caches.open(CACHE)).put(request, response.clone()); } catch {}
    return response;
  })));
});
