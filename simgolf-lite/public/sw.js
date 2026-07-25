const VERSION = "coursecraft-__APP_VERSION__";
const scopeUrl = new URL("./", self.registration.scope);
const scoped = (path = "") => new URL(path, scopeUrl).href;
const SHELL = ["", "manifest.webmanifest", "icons/coursecraft-192.svg", "icons/coursecraft-512.svg", "atlases/terrain.json", "atlases/terrain.png", "atlases/natural-props.json", "atlases/natural-props.png", "atlases/buildings-decor.json", "atlases/buildings-decor.png", "atlases/golfers.json", "atlases/golfers.png"].map(scoped);
const PRECACHE = []; // __COURSECRAFT_PRECACHE__
self.addEventListener("install", (event) => event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll([...new Set([...SHELL, ...PRECACHE])]))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION && key.startsWith("coursecraft-")).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("message", (event) => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(VERSION).then((cache) => cache.put(scoped(), copy)); return response; }).catch(() => caches.match(scoped())));
    return;
  }
  const relativePath = url.origin === location.origin && url.pathname.startsWith(scopeUrl.pathname) ? url.pathname.slice(scopeUrl.pathname.length) : url.pathname;
  // Runtime controls and report responses must always reach the Worker and
  // must never enter the offline cache.
  if (relativePath.startsWith("api/")) return;
  const cacheFirst = relativePath.startsWith("audio/") || relativePath.startsWith("atlases/") || relativePath.startsWith("icons/") || url.origin !== location.origin;
  if (cacheFirst) event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => { if (response.ok || response.type === "opaque") caches.open(VERSION).then((cache) => cache.put(event.request, response.clone())); return response; })));
  else event.respondWith(fetch(event.request).then((response) => { if (response.ok) caches.open(VERSION).then((cache) => cache.put(event.request, response.clone())); return response; }).catch(() => caches.match(event.request)));
});
