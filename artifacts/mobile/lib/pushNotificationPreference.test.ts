import assert from "node:assert/strict";
import test from "node:test";

import {
  parseNotificationJson,
  pushPreferenceStorageKey,
  shouldRestorePushNotifications,
} from "./pushNotificationPreference";

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

test("notification API parsing hides HTML and malformed response details", async () => {
  await assert.rejects(
    () => parseNotificationJson(
      new Response("<!DOCTYPE html>", { headers: { "content-type": "text/html" } }),
      "Could not load notification choices.",
    ),
    { message: "Could not load notification choices." },
  );
  await assert.rejects(
    () => parseNotificationJson(
      new Response("{broken", { headers: { "content-type": "application/json" } }),
      "Could not load notification choices.",
    ),
    { message: "Could not load notification choices." },
  );
});
