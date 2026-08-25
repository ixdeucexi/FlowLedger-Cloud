import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { reconcileNativePushStatus } from "./nativePushStatusPolicy";

test("native push is enabled only after the server confirms this household registration", () => {
  const base = {
    supported: true,
    permission: "granted" as const,
    preferenceEnabled: true,
  };
  assert.equal(
    reconcileNativePushStatus({ ...base, serverRegistered: true }),
    "enabled",
  );
  assert.equal(
    reconcileNativePushStatus({ ...base, serverRegistered: false }),
    "degraded",
  );
  assert.equal(
    reconcileNativePushStatus({ ...base, serverRegistered: null }),
    "degraded",
  );
});

test("permission and user preference fail closed without claiming registration", () => {
  assert.equal(
    reconcileNativePushStatus({
      supported: true,
      permission: "denied",
      preferenceEnabled: true,
      serverRegistered: true,
    }),
    "blocked",
  );
  assert.equal(
    reconcileNativePushStatus({
      supported: true,
      permission: "undetermined",
      preferenceEnabled: true,
      serverRegistered: true,
    }),
    "disabled",
  );
  assert.equal(
    reconcileNativePushStatus({
      supported: true,
      permission: "granted",
      preferenceEnabled: false,
      serverRegistered: true,
    }),
    "disabled",
  );
});

test("Android channel precedes permission request and token rotation is observed", () => {
  const source = readFileSync("lib/pushNotifications.native.ts", "utf8");
  const enableBody = source.slice(
    source.indexOf("export async function enablePushNotifications"),
    source.indexOf("export async function disablePushNotifications"),
  );
  assert.ok(
    enableBody.indexOf("ensureAndroidChannel") <
      enableBody.indexOf("requestPermissionsAsync"),
  );
  assert.match(source, /addPushTokenListener/);
  assert.match(
    source,
    /getExpoPushTokenAsync\(\{ projectId: projectId\(\), devicePushToken \}\)/,
  );
  assert.doesNotMatch(
    source,
    /registerDevice\(accessToken, userId, householdId, devicePushToken\.data\)/,
  );
  assert.match(source, /unregisterForNotificationsAsync/);
  assert.match(source, /clearLastNotificationResponseAsync/);
  assert.match(source, /dismissAllNotificationsAsync/);
  assert.doesNotMatch(source, /process\.env\.EAS_BUILD_PROFILE/);
  const layout = readFileSync("app/_layout.tsx", "utf8");
  assert.match(layout, /subscribeToPushTokenRotation/);
  assert.match(layout, /notificationHouseholdAction/);
  assert.match(
    layout,
    /await verifyCurrentHouseholdMembership\(\s*session\.user\.id,\s*destination\.householdId,?\s*\)/,
  );
  assert.match(layout, /await switchHousehold/);
  assert.match(
    layout,
    /withStartupTimeout\(\s*privacyRefreshRef\.current\(\),\s*PRIVACY_REFRESH_TIMEOUT_MS/,
  );
  assert.match(layout, /privacyRefreshGenerationRef/);
  assert.match(
    layout,
    /generation !== privacyRefreshGenerationRef\.current \|\|\s*!isPrivacySurfaceActive\(\)/,
  );
  assert.match(layout, /if \(previous === "active"\) return/);
  assert.doesNotMatch(
    layout,
    /verificationIsFresh|SHARED_HOUSEHOLD_PRIVACY_TTL_MS/,
  );
  assert.match(layout, /verifySharedHousehold\(true\)/);
  assert.match(layout, /window\.addEventListener\("pagehide", markHidden\)/);
  assert.match(
    layout,
    /window\.addEventListener\("pageshow", verifyAfterReturn\)/,
  );
  assert.match(
    layout,
    /if \(budgetLoading\) \{\s*if \(!hasRevealedPlanRef\.current\) setPrivacyShielded\(true\)/,
  );
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const privacyRefresh = budgetContext.slice(
    budgetContext.indexOf("const refreshHouseholdsForPrivacy"),
    budgetContext.indexOf("const refreshHouseholdActivity"),
  );
  assert.match(privacyRefresh, /verifyCurrentHouseholdMembership/);
  assert.match(privacyRefresh, /clearScopedFinancialData\(\)/);
  assert.match(privacyRefresh, /queryClient\.removeQueries/);
  assert.doesNotMatch(
    layout,
    /restorePushNotifications[\s\S]{0,180}catch\(\(\) => undefined\)/,
  );
});
