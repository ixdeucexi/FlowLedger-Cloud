self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

// Deliberately not an offline app cache: never retain sessions, financial data,
// API responses, auth redirects, old app HTML, or hashed application bundles.
const OFFLINE_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlowLedger — Offline</title><style>body{margin:0;background:#070919;color:#fff;font:18px system-ui;min-height:100vh;display:grid;place-items:center}main{max-width:28rem;padding:2rem}h1{font-size:1.6rem}p{line-height:1.5;color:#cbd0df}a{display:inline-block;padding:14px 20px;background:#9b4dff;border-radius:12px;color:#fff;text-decoration:none}</style></head><body><main><h1>You’re offline</h1><p>Reconnect to open FlowLedger. Your account balances and changes are not available on this offline page.</p><a href="/">Try again</a></main></body></html>`;
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== self.location.origin || /^\/(?:api|_expo)(?:\/|$)/.test(url.pathname)) return;
  event.respondWith(fetch(request).catch(() => new Response(OFFLINE_DOCUMENT, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  })));
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const badgeCount = Number.isFinite(Number(payload.badgeCount))
    ? Math.max(1, Math.trunc(Number(payload.badgeCount)))
    : 1;
  const updateBadge = self.navigator?.setAppBadge
    ? self.navigator.setAppBadge(badgeCount).catch(() => undefined)
    : Promise.resolve();
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title || "FlowLedger", {
      body: payload.body || "New activity is ready to review.",
      icon: "/notification-icon.png",
      badge: "/notification-icon.png",
      tag: payload.tag || "flowledger-review",
      renotify: false,
      data: { url: payload.url || "/more?section=review" },
    }),
    updateBadge,
  ]));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "/more?section=review", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    let focusFallback = null;
    for (const client of windows) {
      if (!client.url || new URL(client.url).origin !== self.location.origin) continue;
      if ("focus" in client && !focusFallback) focusFallback = client;
      try {
        const target = "navigate" in client
          ? await client.navigate(destination)
          : client;
        if (target && "focus" in target) {
          await target.focus();
          return;
        }
      } catch {
        // Some Android browsers reject navigate() for a background PWA client.
        // Keep looking, then open a fresh in-scope app window below.
      }
    }
    if ("openWindow" in self.clients) {
      try {
        const opened = await self.clients.openWindow(destination);
        if (opened) return;
      } catch {
        // Fall back to the existing FlowLedger window if opening is blocked.
      }
    }
    if (focusFallback) await focusFallback.focus();
  })());
});
