import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("a transient admin lookup failure retries instead of permanently hiding tester tools", () => {
  const membership = readFileSync("context/MembershipContext.tsx", "utf8");

  assert.match(membership, /const retryDelays = \[0, 300, 1_200\]/);
  assert.match(membership, /const \{ data, error \} = await supabase/);
  assert.match(membership, /if \(error\) throw error/);
  assert.doesNotMatch(membership, /catch \{\s*if \(!cancelled\) setIsAdmin\(false\)/);
});

test("account deletion only shows store subscription controls for a billing plan", () => {
  const deletion = readFileSync("app/delete-account.tsx", "utf8");

  assert.match(deletion, /actualPlan\.source === "billing"/);
  assert.match(deletion, /Manage store subscription/);
});

test("public v1 replaces unavailable bank linking with honest launch copy", () => {
  const more = readFileSync("app\/(tabs)\/more.tsx", "utf8");
  const desktop = readFileSync("components/desktop/DesktopSettingsPage.tsx", "utf8");
  const simulator = readFileSync("app/plan-simulator.tsx", "utf8");

  assert.match(more, /FOUNDING_FREE_LAUNCH && !adminProAccess \? \(/);
  assert.match(more, /Bank sync is planned for Pro/);
  assert.match(desktop, /FOUNDING_FREE_LAUNCH && !adminProAccess \? \(/);
  assert.match(desktop, /Manual accounts and activity are available/);
  assert.doesNotMatch(desktop, /MONTHLY OUTLOOK/);
  assert.doesNotMatch(simulator, /Monthly outlook/i);
  assert.match(simulator, /Scenario timeline/);
});

test("Apple sign-in is hidden unless the server capability is explicitly enabled", () => {
  const login = readFileSync("app/login.tsx", "utf8");
  const authContext = readFileSync("context/AuthContext.tsx", "utf8");

  assert.match(
    login,
    /EXPO_PUBLIC_APPLE_AUTH_ENABLED === "true"/,
  );
  assert.match(login, /Platform\.OS === "ios" && appleAuthEnabled/);
  assert.match(login, /socialAuthEnabled\s*=\s*Platform\.OS !== "ios" \|\| appleAuthEnabled/);
  assert.match(login, /\{socialAuthEnabled \? \(/);
  assert.match(authContext, /EXPO_PUBLIC_APPLE_AUTH_ENABLED !== "true"/);
  assert.match(authContext, /Crypto\.CryptoDigestAlgorithm\.SHA256/);
  assert.match(authContext, /nonce:\s*hashedNonce/);
  assert.match(authContext, /nonce,\s*\n\s*\}\);/);
  assert.doesNotMatch(login, /EXPO_PUBLIC_APPLE_AUTH_ENABLED !== "false"/);
});

test("login exposes labeled controls, selected modes, and live feedback", () => {
  const login = readFileSync("app/login.tsx", "utf8");

  assert.match(login, /accessibilityRole="tab"/);
  assert.match(login, /accessibilityState=\{\{ selected: mode === m \}\}/);
  assert.match(login, /accessibilityLabel="Email"/);
  assert.match(login, /autoComplete="email"/);
  assert.match(login, /accessibilityLabel="Password"/);
  assert.match(login, /current-password/);
  assert.match(login, /accessibilityLabel=\{showPass \? "Hide password" : "Show password"\}/);
  assert.match(login, /accessibilityRole="alert"/);
  assert.match(login, /accessibilityLiveRegion="assertive"/);
  assert.match(login, /accessibilityLiveRegion="polite"/);
  assert.match(login, /accessibilityLabel="Continue with Google"/);
  assert.match(login, /mode === "signup" && password\.length < 8/);
  assert.match(login, /Password must be at least 8 characters/);
});

test("native auth storage never falls back to plain AsyncStorage", () => {
  const storage = readFileSync("lib/secureAuthStorage.ts", "utf8");

  assert.match(storage, /selectAuthStorageBackend/);
  assert.match(storage, /backend === "unavailable"\) return null/);
  assert.match(storage, /Secure session storage is unavailable on this device/);
  assert.doesNotMatch(
    storage,
    /Platform\.OS === "web" \|\| !\(await nativeSecureStoreAvailable\(\)\)/,
  );
});

test("web OAuth lets auth-js exchange the callback code exactly once", () => {
  const authContext = readFileSync("context/AuthContext.tsx", "utf8");
  const supabaseClient = readFileSync("lib/supabase.ts", "utf8");

  assert.match(supabaseClient, /detectSessionInUrl: Platform\.OS === "web"/);
  assert.doesNotMatch(authContext, /exchangeCodeForSession/);
  assert.match(authContext, /shouldCleanWebAuthUrl[\s\S]+supabase\.auth\.getSession\(\)[\s\S]+window\.history\.replaceState/);
});

test("withdrawn Terms and Privacy surfaces are not shipped or required", () => {
  const layout = readFileSync("app/_layout.tsx", "utf8");
  const login = readFileSync("app/login.tsx", "utf8");
  const more = readFileSync("app/(tabs)/more.tsx", "utf8");
  const settings = readFileSync("lib/settingsHub.ts", "utf8");

  for (const source of [layout, login, more, settings]) {
    assert.doesNotMatch(
      source,
      /LegalAcceptanceGate|LegalDocument|Terms of Service|Privacy Policy/,
    );
  }
  assert.doesNotMatch(layout, /Stack\.Screen name="legal"/);
  assert.doesNotMatch(settings, /id: "legal"/);
  assert.equal(existsSync("app/legal.tsx"), false);
  assert.equal(existsSync("lib/legalDocuments.ts"), false);
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
