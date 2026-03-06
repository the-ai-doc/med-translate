// MedTranslate Service Worker — network-first for API, cache-first for static
const CACHE_NAME = 'medtranslate-v32';
const STATIC_ASSETS = [
  '/', '/index.html', '/styles/app.css?direct', '/js/app.js',
  '/manifest.json', '/icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Network-first for API calls and WebSockets
  if (e.request.url.includes('/api/') || e.request.url.includes('wss://')) return;

  // Stale-While-Revalidate pattern: 
  // It returns the cached version instantly (fast startup), but fetches the latest version in the background
  // CRITICAL FIX: Only puts into cache if resp.ok (HTTP 200). Avoids caching Cloudflare 502 error pages!
  e.respondWith(
    caches.match(e.request)
      .then(cached => {
        const fetchPromise = fetch(e.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return resp;
        }).catch(err => {
          console.warn('Background fetch failed:', err);
        });

        // Return cached if we have it immediately, otherwise wait for network fetch
        return cached || fetchPromise.then(resp => {
          return resp || caches.match('/index.html');
        }).catch(() => caches.match('/index.html'));
      })
  );
});
