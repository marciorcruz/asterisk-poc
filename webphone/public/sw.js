self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("webphone-shell-v1").then((cache) => {
      return cache.addAll(["/", "/manifest.webmanifest"]);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});

