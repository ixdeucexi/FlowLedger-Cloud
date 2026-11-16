const assert = require("node:assert/strict");
const test = require("node:test");

const { NOTIFICATION_TEST_PAYLOADS, notificationTestPayload } = require("./notificationTest");
const { getWeeklyAccountTip } = require("../../artifacts/mobile/lib/accountTips");
const { allowlistedNativeRoute } = require("./push");

test("account tip test alerts resolve the current week on each call across Monday", () => {
  const sunday = new Date("2026-11-22T23:59:59.999Z");
  const monday = new Date("2026-11-23T00:00:00.000Z");
  for (const now of [sunday, monday]) {
    const tip = getWeeklyAccountTip(now);
    const payload = notificationTestPayload("account_tips", now);
    assert.equal(payload.url, `/(tabs)?accountTip=${tip.week}`);
    assert.equal(payload.title, `Test: ${tip.title}`);
    assert.equal(payload.body, tip.body);
    assert.equal(payload.quiet, true);
  }
  const current = notificationTestPayload("account_tips");
  assert.equal(allowlistedNativeRoute(current.url), current.url);
  assert.notEqual(notificationTestPayload("account_tips", sunday).url, notificationTestPayload("account_tips", monday).url);
  assert.equal(notificationTestPayload("posted_transactions", monday), NOTIFICATION_TEST_PAYLOADS.posted_transactions);
});

test("every notification test has a unique tag and expected destination", () => {
  const payloads = Object.values(NOTIFICATION_TEST_PAYLOADS);
  assert.equal(new Set(payloads.map(payload => payload.tag)).size, payloads.length);
  assert.equal(notificationTestPayload("pending_transactions").url, "/transactions");
  assert.equal(notificationTestPayload("posted_transactions").url, "/more?section=review");
  assert.equal(notificationTestPayload("overdue_bills").url, "/bills?attention=overdue");
  assert.equal(notificationTestPayload("admin_feedback").url, "/more?section=admin");
});

test("unknown notification test types are rejected", () => {
  assert.throws(
    () => notificationTestPayload("unknown"),
    error => error.code === "NOTIFICATION_TEST_TYPE_INVALID",
  );
});
