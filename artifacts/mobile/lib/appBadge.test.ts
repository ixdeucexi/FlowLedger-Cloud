import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { appNotificationCount } from "./appBadge";
import { syncNativeAppBadge } from "./appBadgeCore";

test("app badge combines every actionable notification group", () => {
  assert.equal(appNotificationCount(2, 3, 1), 6);
});

test("app badge ignores invalid and negative counts", () => {
  assert.equal(appNotificationCount(-4, Number.NaN, 2.9), 2);
});

test("native app badge sets sanitized counts and clears with zero", async () => {
  const received: number[] = [];
  const badgeApi = {
    setBadgeCountAsync: async (count: number) => {
      received.push(count);
      return true;
    },
  };

  await syncNativeAppBadge(3.9, badgeApi);
  await syncNativeAppBadge(0, badgeApi);

  assert.deepEqual(received, [3, 0]);
});

test("native app badge support and failures remain optional", async () => {
  await assert.doesNotReject(syncNativeAppBadge(2, {}));
  await assert.doesNotReject(syncNativeAppBadge(2, {
    setBadgeCountAsync: async () => {
      throw new Error("Badge permission unavailable");
    },
  }));
});

test("native app badge adapter uses Expo Notifications for set and clear", () => {
  const source = readFileSync("lib/appBadge.native.ts", "utf8");
  assert.match(source, /import \* as Notifications from "expo-notifications"/);
  assert.match(source, /syncNativeAppBadge\(count, Notifications\)/);
  assert.match(source, /syncNativeAppBadge\(0, Notifications\)/);
});
