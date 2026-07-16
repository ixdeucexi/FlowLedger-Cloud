import assert from "node:assert/strict";
import test from "node:test";

import { pushPreferenceStorageKey, shouldRestorePushNotifications } from "./pushNotificationPreference";

test("notification preferences are isolated by user", () => {
  assert.notEqual(pushPreferenceStorageKey("user-1"), pushPreferenceStorageKey("user-2"));
  assert.equal(pushPreferenceStorageKey("user-1"), "flowledger_push_notifications_enabled_v2:user-1");
});

test("notifications restore only when the saved preference and browser permission allow it", () => {
  assert.equal(shouldRestorePushNotifications(true, "granted"), true);
  assert.equal(shouldRestorePushNotifications(false, "granted"), false);
  assert.equal(shouldRestorePushNotifications(true, "denied"), false);
  assert.equal(shouldRestorePushNotifications(true, "default"), false);
});
