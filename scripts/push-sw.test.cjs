const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "artifacts", "mobile", "public", "push-sw.js"), "utf8");
function worker(fetchImpl) {
  const handlers = {};
  const context = vm.createContext({ URL, Response, Promise, fetch: fetchImpl, self: { location: { origin: "https://flowledger-algo.com" }, addEventListener: (type, fn) => { handlers[type] = fn; } } });
  vm.runInContext(source, context);
  return handlers;
}
function navigate(handlers, overrides = {}) {
  let result;
  handlers.fetch({ request: { method: "GET", mode: "navigate", url: "https://flowledger-algo.com/bills", ...overrides }, respondWith(value) { result = value; } });
  return result;
}
test("online navigation returns the live response unchanged; errors are not concealed", async () => {
  for (const status of [200, 404, 503]) {
    const original = new Response("live", { status });
    const result = await navigate(worker(async () => original));
    assert.equal(result, original);
  }
});
test("offline navigation shows a static retry page without any financial cache", async () => {
  const handlers = worker(async () => { throw new TypeError("offline"); });
  const response = await navigate(handlers);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(await response.text(), /You’re offline.*not available.*Try again/s);
  assert.doesNotMatch(source, /caches\.|cache\.put|localStorage|indexedDB/);
  assert.ok(handlers.push && handlers.notificationclick && handlers.activate && handlers.install);
});
test("API, cross-origin, mutations and static assets are never intercepted", () => {
  const handlers = worker(() => { throw new Error("must not fetch"); });
  for (const overrides of [{ url: "https://flowledger-algo.com/api/healthz" }, { url: "https://flowledger-algo.com/_expo/static/js/missing.js" }, { url: "https://other.example/app" }, { method: "POST" }, { mode: "cors" }, { mode: "no-cors", url: "https://flowledger-algo.com/assets/private.png" }]) assert.equal(navigate(handlers, overrides), undefined);
});
