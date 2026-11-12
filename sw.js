/* =========================================================================
   SOUTHEND VOTEWATCH — NETWORK-FIRST SERVICE WORKER (sw.js)
   Fetches live updates from GitHub Pages first; falls back to cache offline
   ========================================================================= */

const CACHE_NAME = "southend-votewatch-ota-v2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./data.js",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-First Strategy: Always grab latest votes/skins when online; use cache offline
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const cloned = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, cloned);
        });
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
