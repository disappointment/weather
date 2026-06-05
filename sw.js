/* Offline app shell + resilient data caching.
   Bump CACHE_VERSION whenever the precached assets change. */
const CACHE_VERSION = 'weather-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './weather.js',
  './favicon.svg',
  './manifest.webmanifest',
];

// Forecast/geocoding hosts: try the network first, fall back to cache when offline.
const DATA_HOSTS = [
  'api.open-meteo.com',
  'geocoding-api.open-meteo.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Navigation: serve the cached shell when the network is unavailable.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Weather/geocoding data: network-first, cache fallback.
  if (DATA_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Same-origin static assets: cache-first with a background refresh.
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Anything else (e.g. reverse-geocode): default to the network.
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}
