const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { transpileModule, ModuleKind } = require("typescript");

const billing = fs.readFileSync(path.join(__dirname, "../../artifacts/mobile/lib/nativeBilling.native.ts"), "utf8");
const push = fs.readFileSync(path.join(__dirname, "../../artifacts/mobile/lib/pushNotifications.native.ts"), "utf8");
const panel = fs.readFileSync(path.join(__dirname, "../../artifacts/mobile/components/MembershipPanel.tsx"), "utf8");

test("RevenueCat activation is serialized, generation guarded, and purchases verify the live expected UUID", () => {
  assert.match(billing, /identityGeneration/);
  assert.match(billing, /identityQueue\s*\.catch\(\(\) => undefined\)\s*\.then/);
  assert.match(billing, /desiredUserId = null/);
  assert.match(billing, /await Purchases\.getAppUserID\(\)/);
  assert.match(billing, /requireCurrentIdentity\(attributes\.expectedUserId\)/g);
  assert.match(billing, /openBillingManagement\(\s*expectedUserId: string,?\s*\)[\s\S]*?await requireCurrentIdentity\(expectedUserId\)/);
  assert.match(panel, /actorId = user\.id/);
  assert.match(panel, /expectedUserId: actorId/);
  assert.match(panel, /openBillingManagement\(user\.id\)/);
});

test("RevenueCat deletion reset never creates or aliases an anonymous purchaser", () => {
  const resetBody = billing.match(/export async function resetBillingIdentityAfterDeletion[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(resetBody, /deactivateBillingIdentity\(\)/);
  assert.match(resetBody, /invalidateCustomerInfoCache\(\)/);
  assert.doesNotMatch(resetBody, /Purchases\.logOut\(/);
  assert.match(billing, /Purchases\.configure\(\{\s*apiKey: publicSdkKey\(\),\s*appUserID: verifiedUserId,?\s*\}\)/);
  assert.match(billing, /Purchases\.logIn\(verifiedUserId\)/);
});

test("a completed store purchase keeps its purchasing intent available for a delayed webhook", () => {
  assert.match(panel, /storePurchaseCompleted = true/);
  assert.match(panel, /!storePurchaseCompleted && isBillingCancellation\(error\)/);
  assert.match(panel, /storeRestoreCompleted = true/);
  assert.match(panel, /!storeRestoreCompleted\s*&&\s*isBillingCancellation\(error\)/);
});

test("actual restore handler cancels only before store completion and keeps completed intents through verification failures", async () => {
  const start = panel.indexOf("  const restorePro =");
  const end = panel.indexOf("  const managePro =", start);
  assert.ok(start >= 0 && end > start);
  const script = transpileModule(panel.slice(start, end), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const cancellation = new Error("cancelled");
  for (const failure of ["restore", "reconcile", "status", "refresh", "scope", "none"]) {
    let current = true;
    const calls = [], cancelled = [], messages = [];
    const stage = async (name) => {
      calls.push(name);
      if (failure === name) throw cancellation;
    };
    const bindings = {
      activeHousehold: { householdId: "household-a", name: "Home", role: "owner" },
      user: { id: "actor-a" }, canManageBilling: true, billingBusy: null,
      currentScope: () => () => current, confirmBilling: async () => true,
      setBillingMessage: (message) => messages.push(message), setBillingBusy() {},
      createBillingRestoreIntent: async () => ({ appUserId: "actor-a", householdId: "household-a", intents: [{ id: "intent-a" }, { id: "intent-b" }] }),
      restoreBillingPurchases: async (attributes) => {
        assert.equal(attributes.expectedUserId, "actor-a");
        assert.equal(attributes.householdId, "household-a");
        assert.equal(attributes.intentId, "intent-a");
        assert.equal(attributes.isCurrent(), true);
        await stage("restore");
        if (failure === "scope") current = false;
      },
      reconcileBillingRestore: async (householdId, ids) => {
        assert.equal(householdId, "household-a");
        assert.deepEqual(ids, ["intent-a", "intent-b"]);
        await stage("reconcile");
      },
      waitForServerBillingStatus: async () => { await stage("status"); return { entitlement: {}, plan: { tier: "pro" } }; },
      setEntitlement() {}, refreshPlan: async () => stage("refresh"),
      isBillingCancellation: (error) => error === cancellation,
      cancelBillingIntents: async (householdId, ids) => cancelled.push({ householdId, ids }),
    };
    const restore = new Function(...Object.keys(bindings), `${script}; return restorePro;`)(...Object.values(bindings));
    await restore();
    assert.deepEqual(cancelled, failure === "restore" ? [{ householdId: "household-a", ids: ["intent-a", "intent-b"] }] : [], failure);
    if (failure === "scope") assert.deepEqual(calls, ["restore"], "no verification or refresh after a scope switch");
    if (failure === "none") assert.equal(messages.at(-1), "Pro was restored for Home.");
  }
});

test("native registration is latest-wins and signout cleanup is serialized behind an in-flight POST", () => {
  assert.match(push, /new SerializedLatestOperation\(\)/);
  assert.match(push, /registrationGate\.schedule/);
  assert.match(push, /if \(!isCurrent\(\)\) return/);
  assert.match(push, /registrationGate\.invalidateAndWait/);
  assert.match(push, /registrationGate\.invalidate\(\)/);
});
