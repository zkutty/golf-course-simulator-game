const VERSION = "coursecraft-__APP_VERSION__";
const scopeUrl = new URL("./", self.registration.scope);
const scoped = (path = "") => new URL(path, scopeUrl).href;
const SHELL = ["", "manifest.webmanifest", "icons/coursecraft-192.svg", "icons/coursecraft-512.svg", "atlases/biomes/manifest.json"].map(scoped);
const PRECACHE = []; // __COURSECRAFT_PRECACHE__
self.addEventListener("install", (event) => event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll([...new Set([...SHELL, ...PRECACHE])]))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION && key.startsWith("coursecraft-")).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("message", (event) => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(async (response) => {
      const cache = await caches.open(VERSION);
      await cache.put(scoped(), response.clone());
      return response;
    }).catch(() => caches.match(scoped())));
    return;
  }
  const relativePath = url.origin === location.origin && url.pathname.startsWith(scopeUrl.pathname) ? url.pathname.slice(scopeUrl.pathname.length) : url.pathname;
  // Runtime controls and report responses must always reach the Worker and
  // must never enter the offline cache.
  if (relativePath.startsWith("api/")) return;
  // Content-hashed base and seasonal atlas files are cached only after the
  // selected biome/tier/season requests them; no other biome is prefetched.
  // Vision artwork follows the same rule, so installation remains media-light.
  const cacheFirst = relativePath.startsWith("audio/") || relativePath.startsWith("atlases/") || relativePath.startsWith("icons/") || relativePath.startsWith("vision/") || url.origin !== location.origin;
  if (cacheFirst) {
    event.respondWith(caches.match(event.request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok || response.type === "opaque") {
        const cache = await caches.open(VERSION);
        await cache.put(event.request, response.clone());
      }
      return response;
    }));
  } else {
    event.respondWith(fetch(event.request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(VERSION);
        await cache.put(event.request, response.clone());
      }
      return response;
    }).catch(() => caches.match(event.request)));
  }
});
