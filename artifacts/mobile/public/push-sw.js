self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  event.waitUntil(self.registration.showNotification(payload.title || "FlowLedger", {
    body: payload.body || "New activity is ready to review.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "flowledger-review",
    renotify: false,
    data: { url: payload.url || "/more?section=review" },
  }));
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
