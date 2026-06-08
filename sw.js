/* The offline service worker was removed.
   This stub only exists to retire any previously-installed worker: a 404 does NOT
   unregister an existing registration, so we keep serving sw.js here, but all it
   does now is wipe the old caches, unregister itself, and reload controlled tabs
   with fresh network content. Safe to delete once all clients have updated. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => client.navigate(client.url));
  })());
});
