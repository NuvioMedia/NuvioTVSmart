/* Nuvio mobile-web shell service worker.
 * Scope note: only browser (phone/tablet/desktop) tiers ever register this -
 * the registration in index.html skips Tizen/webOS user agents, and the TV
 * builds (Tizen widgets, webOS IPKs) load their own copy from the device
 * storage where a service worker does not exist. So TV update behaviour is
 * unaffected: browsers always get fresh code from the network, and this
 * worker only adds an offline fallback for app navigation and cache-friendly
 * static assets. Streams, playlists, manifests and any non-app-origin media
 * are never cached.
 */
const SHELL_CACHE = "nuvio-shell-v1";
const ASSET_CACHE = "nuvio-assets-v1";
const SHELL_URLS = [
  "/",
  "/index.html",
  "/css/bundle.css",
  "/assets/manifest.webmanifest",
  "/boot-guard.js",
  "/nuvio.env.js",
  "/core-js.bundle.js",
  "/app.bundle.js"
];
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => ![SHELL_CACHE, ASSET_CACHE].includes(k)).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

const isStaticAsset = (url) =>
  url.origin === self.location.origin &&
  (/^\/(css|js|assets|res)\//.test(url.pathname) ||
    /\.(css|js|woff2?|png|webp|svg|gif)$/.test(url.pathname));

// Never touch playback plumbing: media containers, segment playlists and the
// local media servers must always go straight to the network.
const isMediaOrStream = (url) =>
  url.origin !== self.location.origin ||
  /(\/(hls|dash|stream|media)\b)|(media-http)|(m3u8|mpd$)|(m3u8\?)|\.m3u8|\.mpd|\.mp4|\.mkv|\.ts(\?|$)|\.m4s/.test(
    url.pathname + url.search
  ) ||
  [2710, 2711, 2712, 2713, 2714].includes(Number(url.port));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isMediaOrStream(url)) return;

  if (request.mode === "navigate") {
    // The shell stays fresh when online; offline, reopen returns the cached
    // index so the app chrome (and its own error states) still render.
    event.respondWith(
      Promise.race([
        fetch(request),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("nav-timeout")), NAV_TIMEOUT_MS)
        )
      ])
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match("/index.html")) || (await cache.match("/")) || Response.error();
        })
    );
    return;
  }

  if (isStaticAsset(url)) {
    // Stale-while-revalidate: boot from cache, refresh in the background.
    // Query-stringed bundle URLs (app.bundle.js?v=...) also match the
    // query-less pre-cached entry so offline boots hit the shell cache.
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached =
          (await cache.match(request)) ||
          (url.search
            ? (await cache.match(url.pathname)) ||
              (await caches.match(url.pathname, { ignoreVary: true }))
            : null);
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
