const CACHE_NAME = "festival-croffle-pwa-v5";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./customer.html",
  "./cashier.html",
  "./kitchen.html",
  "./handover.html",
  "./admin.html",
  "./display.html",
  "./style.css",
  "./script.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
  "./assets/product-croffle-sugar.svg",
  "./assets/product-croffle-choco.svg",
  "./assets/product-croffle-berry.svg",
  "./assets/product-croffle-set.svg",
  "./assets/product-kurungi.svg",
  "./assets/product-scc.svg",
  "./assets/product-variety.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const absoluteAssets = CORE_ASSETS.map((asset) => new URL(asset, self.location).toString());
      return cache.addAll(absoluteAssets);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
            return networkResponse;
          }

          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return networkResponse;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
