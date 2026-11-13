const CACHE_NAME = "japan-tokyo-pwa-v12";
const APP_SHELL = [
  "./index.html",
  "./manifest.webmanifest",
  "./firebase-config.js?v=2",
  "./firebase-adapter.js?v=4",
  "./api-config.js",
  "./assets/app-icon.svg",
  "./assets/app-icon-192.png",
  "./assets/app-icon-512.png",
  "./assets/fuji-winter-watercolor.jpg"
];
const shellUrls = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => cache.addAll(APP_SHELL.map(path => new Request(path, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys
      .filter(key => key.startsWith("japan-tokyo-pwa-") && key !== CACHE_NAME)
      .map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const navigation = event.request.mode === "navigate";
  if (!navigation && !shellUrls.has(event.request.url)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(navigation ? "./index.html" : event.request)) || Response.error();
  }));
});

