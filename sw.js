const CACHE_PREFIX = "thespia-blueprint-help-";
const CACHE_NAME = `${CACHE_PREFIX}v15`;
const APP_SHELL = [
  new URL("./", self.registration.scope).href,
  new URL("./index.html", self.registration.scope).href,
  new URL("./styles.css", self.registration.scope).href,
  new URL("./app.js", self.registration.scope).href,
  new URL("./major-transport.js", self.registration.scope).href,
  new URL("./scale.js", self.registration.scope).href,
  new URL("./tasks.js", self.registration.scope).href,
  new URL("./funds.js", self.registration.scope).href,
  new URL("./prompter.js", self.registration.scope).href,
  new URL("./focus-nav.js", self.registration.scope).href,
  new URL("./theme.js", self.registration.scope).href,
  new URL("./fonts/rajdhani/Rajdhani-Regular.woff2", self.registration.scope).href,
  new URL("./fonts/rajdhani/Rajdhani-SemiBold.woff2", self.registration.scope).href,
  new URL("./fonts/rajdhani/Rajdhani-Bold.woff2", self.registration.scope).href,
  new URL("./fonts/inter/Inter-Regular.woff2", self.registration.scope).href,
  new URL("./fonts/inter/Inter-SemiBold.woff2", self.registration.scope).href,
  new URL("./fonts/jetbrains-mono/JetBrainsMono-Regular.woff2", self.registration.scope).href,
  new URL("./fonts/jetbrains-mono/JetBrainsMono-SemiBold.woff2", self.registration.scope).href,
  new URL("./library.json", self.registration.scope).href,
  new URL("./scale-library.json", self.registration.scope).href,
  new URL("./manifest.webmanifest", self.registration.scope).href,
  new URL("./icons/logo.svg", self.registration.scope).href,
  new URL("./icons/hud-bg.png", self.registration.scope).href,
  new URL("./icons/avatar-major.svg", self.registration.scope).href,
  new URL("./icons/avatar-c2.svg", self.registration.scope).href,
  new URL("./icons/favicon-64.png", self.registration.scope).href,
  new URL("./icons/icon-128.png", self.registration.scope).href,
  new URL("./icons/icon-192.png", self.registration.scope).href,
  new URL("./icons/icon-512.png", self.registration.scope).href,
  new URL("./icons/icon-512-mono.png", self.registration.scope).href,
  new URL("./.well-known/meta-wearables-manifest.json", self.registration.scope).href,
];

function isNetworkFirst(request, url) {
  if (request.mode === "navigate") return true;
  const path = url.pathname || "";
  return (
    path.endsWith("/") ||
    path.endsWith(".html") ||
    path.endsWith(".js") ||
    path.endsWith(".css")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Fragments are not sent to fetch() and must never be written to the cache.
  url.hash = "";
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url.href);
      if (isNetworkFirst(request, url)) {
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            try {
              await cache.put(url.href, response.clone());
            } catch (_err) {
              /* ignore quota */
            }
          }
          return response;
        } catch (error) {
          if (cached) return cached;
          if (request.mode === "navigate") {
            const shell = await cache.match(APP_SHELL[0]);
            if (shell) return shell;
          }
          throw error;
        }
      }
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          try {
            await cache.put(url.href, response.clone());
          } catch (_err) {
            /* ignore quota */
          }
        }
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
