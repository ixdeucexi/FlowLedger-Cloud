const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const billing = fs.readFileSync(path.join(__dirname, "../../artifacts/mobile/lib/nativeBilling.native.ts"), "utf8");
const push = fs.readFileSync(path.join(__dirname, "../../artifacts/mobile/lib/pushNotifications.native.ts"), "utf8");
const panel = fs.readFileSync(path.join(__dirname, "../../artifacts/mobile/components/MembershipPanel.tsx"), "utf8");

test("RevenueCat activation is serialized, generation guarded, and purchases verify the live expected UUID", () => {
  assert.match(billing, /identityGeneration/);
  assert.match(billing, /identityQueue\.catch\(\(\) => undefined\)\.then/);
  assert.match(billing, /desiredUserId = null/);
  assert.match(billing, /await Purchases\.getAppUserID\(\)/);
  assert.match(billing, /requireCurrentIdentity\(attributes\.expectedUserId\)/g);
  assert.match(billing, /openBillingManagement\(expectedUserId: string\)[\s\S]*?await requireCurrentIdentity\(expectedUserId\)/);
  assert.match(panel, /expectedUserId: user!\.id/);
  assert.match(panel, /openBillingManagement\(user!\.id\)/);
});

test("RevenueCat deletion reset never creates or aliases an anonymous purchaser", () => {
  const resetBody = billing.match(/export async function resetBillingIdentityAfterDeletion[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(resetBody, /deactivateBillingIdentity\(\)/);
  assert.match(resetBody, /invalidateCustomerInfoCache\(\)/);
  assert.doesNotMatch(resetBody, /Purchases\.logOut\(/);
  assert.match(billing, /Purchases\.configure\(\{ apiKey: publicSdkKey\(\), appUserID: verifiedUserId \}\)/);
  assert.match(billing, /Purchases\.logIn\(verifiedUserId\)/);
});

test("a completed store purchase keeps its purchasing intent available for a delayed webhook", () => {
  assert.match(panel, /storePurchaseCompleted = true/);
  assert.match(panel, /!storePurchaseCompleted && isBillingCancellation\(error\)/);
  assert.match(panel, /storeRestoreCompleted = true/);
  assert.match(panel, /!storeRestoreCompleted && isBillingCancellation\(error\)/);
});

test("native registration is latest-wins and signout cleanup is serialized behind an in-flight POST", () => {
  assert.match(push, /new SerializedLatestOperation\(\)/);
  assert.match(push, /registrationGate\.schedule/);
  assert.match(push, /if \(!isCurrent\(\)\) return/);
  assert.match(push, /registrationGate\.invalidateAndWait/);
  assert.match(push, /registrationGate\.invalidate\(\)/);
});
