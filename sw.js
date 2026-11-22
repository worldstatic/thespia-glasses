const CACHE_PREFIX = "thespia-blueprint-help-";
const CACHE_NAME = `${CACHE_PREFIX}v4`;
const APP_SHELL = [
  new URL("./", self.registration.scope).href,
  new URL("./index.html", self.registration.scope).href,
  new URL("./styles.css", self.registration.scope).href,
  new URL("./app.js", self.registration.scope).href,
  new URL("./major-transport.js", self.registration.scope).href,
  new URL("./scale.js", self.registration.scope).href,
  new URL("./library.json", self.registration.scope).href,
  new URL("./scale-library.json", self.registration.scope).href,
  new URL("./icons/favicon-64.png", self.registration.scope).href,
  new URL("./icons/icon-128.png", self.registration.scope).href,
  new URL("./icons/icon-512.png", self.registration.scope).href,
  new URL("./.well-known/meta-wearables-manifest.json", self.registration.scope).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        return response;
      } catch (error) {
        if (request.mode === "navigate") {
          const shell = await cache.match(APP_SHELL[0]);
          if (shell) return shell;
        }
        throw error;
      }
    })()
  );
});
