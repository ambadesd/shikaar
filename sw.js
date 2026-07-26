/* Shikaar service worker — FR-10 (installable), FR-12 (light caching).
   Shell is cached for offline launch. Searches are never cached here;
   freshness matters more than offline results. */
const SHELL = 'shikaar-shell-v1';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;            // always hit the network
  if (url.origin !== location.origin) return;              // never cache third-party images
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
