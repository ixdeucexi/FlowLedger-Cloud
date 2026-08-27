import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  dismissNotification,
  isBillEligibleForDueNotification,
  markAllNotificationsRead,
  markNotificationRead,
  normalizeNotificationState,
  unreadNotificationCount,
  visibleNotifications,
  type InAppNotification,
} from "./notificationCenter";

test("closed debts never produce due notifications", () => {
  assert.equal(isBillEligibleForDueNotification({ is_debt: true, balance: 0 }), false);
  assert.equal(isBillEligibleForDueNotification({ is_debt: true, balance: 0.009 }), false);
  assert.equal(isBillEligibleForDueNotification({ is_debt: true, balance: 25 }), true);
  assert.equal(isBillEligibleForDueNotification({ is_debt: false, balance: 0 }), true);
});

const notifications: InAppNotification[] = [
  { id: "review:1", type: "review", title: "Review", body: "One item", timestamp: "2026-08-05T12:00:00.000Z", route: "/review", tone: "watch" },
  { id: "bill:1", type: "bill", title: "Bill", body: "Due", timestamp: "2026-08-06T12:00:00.000Z", route: "/bills", tone: "risk" },
  { id: "bill:1", type: "bill", title: "Duplicate", body: "Due", timestamp: "2026-08-06T12:00:00.000Z", route: "/bills", tone: "risk" },
];

test("notification state normalizes ids and limits unsafe values", () => {
  assert.deepEqual(normalizeNotificationState({ readIds: ["a", "a", 2], dismissedIds: ["b"] }), { readIds: ["a"], dismissedIds: ["b"] });
});

test("notification center deduplicates events and preserves dismissed ids", () => {
  const read = markNotificationRead({ readIds: [], dismissedIds: [] }, "bill:1");
  assert.equal(unreadNotificationCount(notifications, read), 1);
  const dismissed = dismissNotification(read, "bill:1");
  assert.equal(visibleNotifications(notifications, dismissed).length, 1);
  assert.equal(visibleNotifications(notifications, dismissed)[0].id, "review:1");
});

test("mark all reads every currently visible notification", () => {
  const next = markAllNotificationsRead({ readIds: [], dismissedIds: [] }, notifications);
  assert.equal(unreadNotificationCount(notifications, next), 0);
});

test("notification state persistence retries transient server failures", () => {
  const discovery = readFileSync("context/AppDiscoveryContext.tsx", "utf8");

  assert.match(discovery, /const delays = \[0, 250, 1_000\]/);
  assert.match(discovery, /saveNotificationCenterStateWithRetry\(householdId, next\)/);
  assert.match(discovery, /Notification state will remain on this device until server sync recovers/);
});
