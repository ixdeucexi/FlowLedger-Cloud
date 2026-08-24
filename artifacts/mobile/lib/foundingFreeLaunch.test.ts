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

test("public v1 replaces unavailable bank linking with honest launch copy", () => {
  const more = readFileSync("app\/(tabs)\/more.tsx", "utf8");
  const desktop = readFileSync("components/desktop/DesktopSettingsPage.tsx", "utf8");

  assert.match(more, /FOUNDING_FREE_LAUNCH && !adminProAccess \? \(/);
  assert.match(more, /Bank sync is planned for Pro/);
  assert.match(desktop, /FOUNDING_FREE_LAUNCH && !adminProAccess \? \(/);
  assert.match(desktop, /Manual accounts and activity are available/);
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
