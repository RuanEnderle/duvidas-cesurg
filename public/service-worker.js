const CACHE_NAME = "duvidas-cesurg-v1";

const ARQUIVOS_CACHE = [
  "/",
  "/index.html",
  "/aluno.html",
  "/professor.html",
  "/style.css",
  "/manifest.json",
  "/logo-cesurg.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ARQUIVOS_CACHE);
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (nomesCaches) {
      return Promise.all(
        nomesCaches.map(function (nomeCache) {
          if (nomeCache !== CACHE_NAME) {
            return caches.delete(nomeCache);
          }
        })
      );
    })
  );

  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/socket.io")) {
    return;
  }

  if (url.pathname.startsWith("/qrcode")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        const copia = response.clone();

        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, copia);
        });

        return response;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});
