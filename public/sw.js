/*
 * Chef & Serve service worker — app-shell caching + Web Push.
 *
 * Hand-rolled (no next-pwa/Serwist): the surface is narrow and a static file
 * served from origin satisfies the `worker-src 'self'` CSP with zero build
 * wiring. Bump CACHE_VERSION on a breaking deploy to purge old caches.
 *
 * Caching strategy:
 *   - cache-first  for /_next/static/* and /icons/* (immutable build assets)
 *   - network-first for /chef/* navigations + data (live shifts/hours/earnings,
 *     never stale), falling back to the cached shell when offline
 *   - never touch /api/* (auth + mutations always hit the network)
 *
 * Push: the `push`/`notificationclick` handlers are live so a Web Push payload
 * (PR-6) shows a system notification and deep-links on tap. Harmless until any
 * subscription exists.
 */
const CACHE_VERSION = "cs-chef-v1";
const APP_SHELL = ["/chef", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Cache-first: immutable build assets + app icons.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Network-first: chef navigations + data; offline → cached shell.
  if (url.pathname.startsWith("/chef")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/chef"))),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: "Chef & Serve", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Chef & Serve";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag || "cs-notify",
      data: { url: payload.url || "/chef" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || "/chef";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(target) && "focus" in client) return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
