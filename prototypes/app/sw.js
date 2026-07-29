/* SugarLife PWA service worker — офлайн-кэш.
   Локальные ресурсы кэшируются заранее (precache), сторонние (Inter, Phosphor) — по мере запроса. */
const VERSION = 'sugarlife-v1';
const CORE = [
  './',
  'index.html',
  'app.js',
  'engine.js',
  'nocturne.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // локальное: сеть с падением в кэш (свежесть важнее), офлайн -> кэш
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('index.html')))
    );
  } else {
    // сторонние CDN (шрифты/иконки): кэш-сначала, затем сеть
    e.respondWith(
      caches.match(req).then((m) => m || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => m))
    );
  }
});
