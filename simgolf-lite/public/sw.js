const VERSION = "coursecraft-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/coursecraft-192.svg", "/icons/coursecraft-512.svg", "/atlases/props.json", "/atlases/props.png", "/atlases/golfers.json", "/atlases/golfers.png"];
const PRECACHE = []; // __COURSECRAFT_PRECACHE__
self.addEventListener("install", (event) => event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll([...new Set([...SHELL, ...PRECACHE])]))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION && key.startsWith("coursecraft-")).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("message", (event) => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(VERSION).then((cache) => cache.put("/", copy)); return response; }).catch(() => caches.match("/")));
    return;
  }
  const cacheFirst = url.pathname.startsWith("/audio/") || url.pathname.startsWith("/atlases/") || url.pathname.startsWith("/icons/") || url.origin !== location.origin;
  if (cacheFirst) event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => { if (response.ok || response.type === "opaque") caches.open(VERSION).then((cache) => cache.put(event.request, response.clone())); return response; })));
  else event.respondWith(fetch(event.request).then((response) => { if (response.ok) caches.open(VERSION).then((cache) => cache.put(event.request, response.clone())); return response; }).catch(() => caches.match(event.request)));
});
