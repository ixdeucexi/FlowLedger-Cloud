const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferencePatch,
  normalizeNotificationPreferences,
} = require("./notificationPreferences");

test("new accounts receive every built notification type by default", () => {
  assert.deepEqual(normalizeNotificationPreferences(null), DEFAULT_NOTIFICATION_PREFERENCES);
});

test("stored notification choices preserve explicit off values", () => {
  const preferences = normalizeNotificationPreferences({ overdue_bills: false, pending_transactions: false });
  assert.equal(preferences.overdue_bills, false);
  assert.equal(preferences.pending_transactions, false);
  assert.equal(preferences.posted_transactions, true);
});

test("notification preference updates accept only booleans and known fields", () => {
  assert.deepEqual(normalizeNotificationPreferencePatch({ overdue_bills: false, ignored: true }), { overdue_bills: false });
  assert.throws(
    () => normalizeNotificationPreferencePatch({ posted_transactions: "no" }),
    error => error.code === "NOTIFICATION_PREFERENCE_INVALID",
  );
});
