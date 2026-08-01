const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const workerSource = fs.readFileSync(
  path.resolve(__dirname, "../../artifacts/mobile/public/push-sw.js"),
  "utf8",
);

function loadWorker(clients, overrides = {}) {
  const handlers = {};
  const self = {
    clients,
    navigator: overrides.navigator,
    location: { origin: "https://flowledger-algo.com" },
    registration: { showNotification: overrides.showNotification || (async () => undefined) },
    skipWaiting: async () => undefined,
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
  };
  vm.runInNewContext(workerSource, { self, URL });
  return handlers;
}

test("a push updates the app badge with the supplied notification count", async () => {
  let badgeCount = null;
  let shown = null;
  let completion;
  const handler = loadWorker({}, {
    navigator: {
      async setAppBadge(count) {
        badgeCount = count;
      },
    },
    async showNotification(title, options) {
      shown = { title, options };
    },
  }).push;

  handler({
    data: { json: () => ({ title: "3 new transactions", badgeCount: 3 }) },
    waitUntil(promise) {
      completion = promise;
    },
  });
  await completion;

  assert.equal(badgeCount, 3);
  assert.equal(shown.title, "3 new transactions");
});

async function clickNotification(handler) {
  let completion;
  handler({
    notification: {
      close() {},
      data: { url: "/more?section=review" },
    },
    waitUntil(promise) {
      completion = promise;
    },
  });
  await completion;
}

test("a rejected Android client navigation falls back to opening Review Center", async () => {
  let openedUrl = null;
  const handler = loadWorker({
    async matchAll() {
      return [{
        url: "https://flowledger-algo.com/",
        async focus() {},
        async navigate() {
          throw new Error("background client cannot navigate");
        },
      }];
    },
    async openWindow(url) {
      openedUrl = url;
      return { url };
    },
  }).notificationclick;

  await clickNotification(handler);
  assert.equal(openedUrl, "https://flowledger-algo.com/more?section=review");
});

test("notification taps focus a successfully navigated FlowLedger window", async () => {
  let focused = false;
  let opened = false;
  const navigatedClient = {
    async focus() {
      focused = true;
    },
  };
  const handler = loadWorker({
    async matchAll() {
      return [{
        url: "https://flowledger-algo.com/",
        async navigate() {
          return navigatedClient;
        },
      }];
    },
    async openWindow() {
      opened = true;
    },
  }).notificationclick;

  await clickNotification(handler);
  assert.equal(focused, true);
  assert.equal(opened, false);
});
