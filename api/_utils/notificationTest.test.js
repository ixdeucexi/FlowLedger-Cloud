const assert = require("node:assert/strict");
const test = require("node:test");

const { NOTIFICATION_TEST_PAYLOADS, notificationTestPayload } = require("./notificationTest");

test("every notification test has a unique tag and expected destination", () => {
  const payloads = Object.values(NOTIFICATION_TEST_PAYLOADS);
  assert.equal(new Set(payloads.map(payload => payload.tag)).size, payloads.length);
  assert.equal(notificationTestPayload("pending_transactions").url, "/transactions");
  assert.equal(notificationTestPayload("posted_transactions").url, "/more?section=review");
  assert.equal(notificationTestPayload("overdue_bills").url, "/bills?attention=overdue");
});

test("unknown notification test types are rejected", () => {
  assert.throws(
    () => notificationTestPayload("unknown"),
    error => error.code === "NOTIFICATION_TEST_TYPE_INVALID",
  );
});
