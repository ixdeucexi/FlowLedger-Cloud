const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { transpileModule, ModuleKind } = require("typescript");
const { allowlistedNativeRoute, sendExpoNotification } = require("./push");
const { feedbackNotificationPayload, feedbackStatusNotificationPayload } = require("./feedback");
const { NOTIFICATION_TEST_PAYLOADS } = require("./notificationTest");

const native = {};
const source = fs.readFileSync(path.join(__dirname, "../../artifacts/mobile/lib/nativeNotificationRoute.ts"), "utf8");
new Function("exports", transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText)(native);
const feedbackId = "123e4567-e89b-42d3-a456-426614174000";
const householdId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("actual feedback and test payloads survive native delivery and tap routing", async () => {
  const payloads = [
    feedbackNotificationPayload(feedbackId, "bug", "Fixture tester"),
    ...["updated", "not_planned", "reply"].map(outcome => feedbackStatusNotificationPayload(feedbackId, outcome)),
    ...Object.values(NOTIFICATION_TEST_PAYLOADS),
  ];
  const originalFetch = global.fetch;
  const requests = [];
  const db = { from(table) {
    if (table === "native_push_receipts") return { upsert: async () => ({ error: null }) };
    if (table === "native_push_devices") return { update: () => ({ eq: async () => ({ error: null }) }) };
    throw new Error(`Unexpected table: ${table}`);
  } };
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ data: { status: "ok", id: `ticket-${requests.length}` } }) };
  };
  try {
    for (const payload of payloads) {
      const result = await sendExpoNotification(db, { id: "device", expo_push_token: "ExponentPushToken[fixture]" }, payload, householdId);
      assert.equal(result.accepted, true);
      const delivered = requests.at(-1).data;
      assert.equal(delivered.route, payload.url);
      assert.deepEqual(native.notificationDestination(delivered), { route: payload.url, householdId });
    }
  } finally { global.fetch = originalFetch; }
});

test("server fallback remains tappable while arbitrary paths and query parameters stay blocked", () => {
  for (const route of [
    "https://attacker.invalid/more?section=admin", "//attacker.invalid", "/delete-account",
    "/more?section=help&feedback=invalid", `/more?section=help&feedback=${feedbackId}&redirect=/delete-account`,
    `/more?section=admin&feedback=${feedbackId}`, "/more?section=review&section=admin",
    "/more?section=help#admin", { toString: () => "/more?section=admin" }, null,
  ]) {
    assert.equal(native.notificationRoute(route), null);
    assert.equal(allowlistedNativeRoute(route), "/(tabs)");
    assert.deepEqual(native.notificationDestination({ route: allowlistedNativeRoute(route) }), { route: "/(tabs)", householdId: null });
  }
  assert.equal(allowlistedNativeRoute("/more?section=feedback"), "/more?section=help");
  assert.equal(native.notificationRoute("/more?section=feedback"), "/more?section=help");
  assert.equal(native.notificationDestination({ route: "/more?section=admin", householdId: "invalid" }), null);
});
