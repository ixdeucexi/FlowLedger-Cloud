const assert = require("node:assert/strict");
const test = require("node:test");

const { notificationRouteAction } = require("../notifications");

test("notification router uses the Vercel rewrite action", () => {
  assert.equal(notificationRouteAction({ query: { notificationAction: "preferences" } }), "preferences");
});

test("notification router falls back to the requested path", () => {
  assert.equal(notificationRouteAction({ query: {}, url: "/api/notifications/overdue-bills" }), "overdue-bills");
});
