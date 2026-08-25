import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public v1 is Founding Free without starting native billing", () => {
  const launchMode = readFileSync("lib/launchMode.ts", "utf8");
  const membership = readFileSync("context/MembershipContext.tsx", "utf8");
  const panel = readFileSync("components/MembershipPanel.tsx", "utf8");

  assert.match(launchMode, /EXPO_PUBLIC_LAUNCH_MODE !== "paid"/);
  assert.match(launchMode, /Founding Free/);
  assert.match(membership, /FOUNDING_FREE_LAUNCH \|\| !user\?\.id/);
  assert.match(membership, /if \(!FOUNDING_FREE_LAUNCH && user\?\.id && activeHousehold\.role === "owner"\)/);
  assert.match(membership, /if \(FOUNDING_FREE_LAUNCH\) return false/);
  assert.match(panel, /No subscription or trial required/);
  assert.match(panel, /Bank sync and advanced automation/);
});

test("account deletion only shows store subscription controls for a billing plan", () => {
  const deletion = readFileSync("app/delete-account.tsx", "utf8");

  assert.match(deletion, /actualPlan\.source === "billing"/);
  assert.match(deletion, /Manage store subscription/);
});

test("public v1 replaces unavailable bank linking with honest launch copy", () => {
  const more = readFileSync("app\/(tabs)\/more.tsx", "utf8");
  const desktop = readFileSync("components/desktop/DesktopSettingsPage.tsx", "utf8");

  assert.match(more, /FOUNDING_FREE_LAUNCH && !adminProAccess \? \(/);
  assert.match(more, /Bank sync is planned for Pro/);
  assert.match(desktop, /FOUNDING_FREE_LAUNCH && !adminProAccess \? \(/);
  assert.match(desktop, /Manual accounts and activity are available/);
});

test("public matching and Flo copy does not send Founding Free users to a missing upgrade", () => {
  const activity = readFileSync("app\/(tabs)\/transactions.tsx", "utf8");
  const flo = readFileSync("app\/(tabs)\/flo.tsx", "utf8");

  assert.doesNotMatch(activity, /Upgrade to Pro/i);
  assert.match(activity, /stay available in Activity during Founding Free/);
  assert.match(activity, /Pending charges stay visible during Founding Free/);
  assert.doesNotMatch(flo, /Pro membership is required/i);
  assert.match(flo, /Confirming Flo changes is planned for Pro/);
});

test("admin Pro remains account-scoped and keeps Plaid available during Founding Free", () => {
  const launchMode = readFileSync("lib/launchMode.ts", "utf8");
  const more = readFileSync("app\/(tabs)\/more.tsx", "utf8");
  const desktop = readFileSync("components/desktop/DesktopSettingsPage.tsx", "utf8");
  const panel = readFileSync("components/MembershipPanel.tsx", "utf8");
  const adminTools = readFileSync("components/AdminMembershipTools.tsx", "utf8");

  assert.match(launchMode, /plan\?\.tier === "pro" && plan\.source === "admin"/);
  assert.match(more, /FOUNDING_FREE_LAUNCH && !adminProAccess/);
  assert.match(desktop, /FOUNDING_FREE_LAUNCH && !adminProAccess/);
  assert.match(panel, /ADMIN HOUSEHOLD PLAN/);
  assert.match(panel, /does not expose purchase controls/);
  assert.match(adminTools, /Manage Pro by email/);
  assert.match(adminTools, /Upgrade to Pro/);
});

test("founding free unlocked workspaces are not mislabeled as paid-only", () => {
  const simulator = readFileSync("app/plan-simulator.tsx", "utf8");
  const reviewCenter = readFileSync("components/ReviewCenter.tsx", "utf8");

  assert.match(simulator, /foundingFreeLocalOnly \? "FOUNDING FREE PLAN SIMULATOR" : "PRO PLAN SIMULATOR"/);
  assert.match(reviewCenter, /FOUNDING_FREE_LAUNCH \? "FOUNDING FREE REVIEW CENTER" : "PRO REVIEW CENTER"/);
});

test("Founding Free Plan Simulator keeps calculations local while admin Pro retains household scenarios", () => {
  const simulator = readFileSync("app/plan-simulator.tsx", "utf8");

  assert.match(simulator, /canPersistPlanSimulations\(actualPlan\)/);
  assert.match(simulator, /!canPersistScenarios \|\| demoMode \|\| householdId === "local" \? Promise\.resolve\(\[\]\) : loadPlanSimulations/);
  assert.match(simulator, /keepsLocalDraft && draftStorageKey \? AsyncStorage\.getItem/);
  assert.match(simulator, /Founding Free keeps this draft on this device and does not sync it to your household/);
  assert.match(simulator, /foundingFreeLocalOnly \? <Button label=\{draft\.invalidDefinition/);
  assert.match(simulator, /foundingFreeLocalOnly \? "New local draft" : "New"/);
  assert.match(simulator, /foundingFreeLocalOnly \? "Compare your real Forecast with a private draft kept on this device[^:]+: "Compare your real Forecast with a saved what-if scenario/);
});
