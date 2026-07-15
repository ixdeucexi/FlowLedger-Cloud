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
    for (const client of windows) {
      if ("navigate" in client) await client.navigate(destination);
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow(destination);
  })());
});
