const CACHE = "irfan-cbt-v2";
const FILES = [
  "./index.html",
  "./app.js",
  "./questions.js",
  "./answers.js",
  "./courses.js",
  "./logo.png",
  "./manifest.json"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Network first, so updates show immediately; cache is only a fallback.
// Firebase and other sites are never touched.
self.addEventListener("fetch", function (event) {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then(function (response) {
        const copy = response.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put(req, copy);
        });
        return response;
      })
      .catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match("./index.html");
        });
      })
  );
});
