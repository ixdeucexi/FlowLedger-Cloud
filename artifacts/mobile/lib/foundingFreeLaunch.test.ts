import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  FREE_CORE_FEATURES,
  FOUNDING_PLANNING_FEATURES,
  canUseFeature,
} from "./membership";

test("tier eligibility is server-owned and checkout remains independently disabled by default", () => {
  const launchMode = readFileSync("lib/launchMode.ts", "utf8");
  const membership = readFileSync("context/MembershipContext.tsx", "utf8");
  const panel = readFileSync("components/MembershipPanel.tsx", "utf8");
  assert.match(launchMode, /EXPO_PUBLIC_BILLING_CHECKOUT_ENABLED === "true"/);
  assert.match(launchMode, /EXPO_PUBLIC_LAUNCH_MODE !== "paid"/);
  assert.match(membership, /requestHouseholdFeatureAccess/);
  assert.match(membership, /FREE_CORE_FEATURES.includes/);
  assert.doesNotMatch(membership, /if \(FOUNDING_FREE_LAUNCH\) return false/);
  assert.match(panel, /Pro subscriptions are not open yet/);
  assert.match(panel, /Your existing planning and Flo tools are protected/);
  assert.match(panel, /No purchase is available from this screen yet/);
});

test("a transient admin lookup failure retries instead of permanently hiding tester tools", () => {
  const membership = readFileSync("context/MembershipContext.tsx", "utf8");

  assert.match(membership, /const retryDelays = \[0, 300, 1_200\]/);
  assert.match(membership, /const \{ data, error \} = await supabase/);
  assert.match(membership, /if \(error\) throw error/);
  assert.doesNotMatch(
    membership,
    /catch \{\s*if \(!cancelled\) setIsAdmin\(false\)/,
  );
});

test("account deletion only shows store subscription controls for a billing plan", () => {
  const deletion = readFileSync("app/delete-account.tsx", "utf8");

  assert.match(deletion, /actualPlan\.source === "billing"/);
  assert.match(deletion, /Manage store subscription/);
});

test("public v1 replaces unavailable bank linking with honest launch copy", () => {
  const more = readFileSync("app\/(tabs)\/more.tsx", "utf8");
  const desktop = readFileSync(
    "components/desktop/DesktopSettingsPage.tsx",
    "utf8",
  );
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

  assert.match(login, /EXPO_PUBLIC_APPLE_AUTH_ENABLED === "true"/);
  assert.match(login, /Platform\.OS === "ios" && appleAuthEnabled/);
  assert.match(
    login,
    /socialAuthEnabled\s*=\s*Platform\.OS !== "ios" \|\| appleAuthEnabled/,
  );
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
  assert.match(
    login,
    /accessibilityLabel=\{showPass \? "Hide password" : "Show password"\}/,
  );
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
  assert.match(
    authContext,
    /shouldCleanWebAuthUrl[\s\S]+supabase\.auth\.getSession\(\)[\s\S]+window\.history\.replaceState/,
  );
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

test("Free manual matching and basic planning are not whole-screen paid features", () => {
  for (const feature of FREE_CORE_FEATURES)
    assert.equal(canUseFeature("free", feature), true);
  assert.equal(canUseFeature("free", "transaction_matching"), true);
  assert.equal(canUseFeature("free", "debt_payoff"), true);
  assert.equal(canUseFeature("free", "plan_simulator"), true);
  assert.equal(canUseFeature("free", "flo_creation"), false);
});

test("admin Pro remains account-scoped and keeps Plaid available during Founding Free", () => {
  const launchMode = readFileSync("lib/launchMode.ts", "utf8");
  const more = readFileSync("app\/(tabs)\/more.tsx", "utf8");
  const desktop = readFileSync(
    "components/desktop/DesktopSettingsPage.tsx",
    "utf8",
  );
  const panel = readFileSync("components/MembershipPanel.tsx", "utf8");
  const adminTools = readFileSync(
    "components/AdminMembershipTools.tsx",
    "utf8",
  );

  assert.match(
    launchMode,
    /plan\?\.tier === "pro" && plan\.source === "admin"/,
  );
  assert.match(more, /FOUNDING_FREE_LAUNCH && !adminProAccess/);
  assert.match(desktop, /FOUNDING_FREE_LAUNCH && !adminProAccess/);
  assert.match(panel, /ADMIN HOUSEHOLD PLAN/);
  assert.match(panel, /Pro subscriptions are not open yet/);
  assert.match(adminTools, /Manage Pro by email/);
  assert.match(adminTools, /Upgrade to Pro/);
});

test("the explicit founding feature version preserves planning without unlocking bank or cloud", () => {
  for (const feature of [
    "debt_strategies",
    "saved_scenarios",
    "scenario_comparison",
    "long_term_reports",
    "flo_creation",
  ] as const)
    assert.ok(FOUNDING_PLANNING_FEATURES.includes(feature));
  assert.equal(FOUNDING_PLANNING_FEATURES.includes("plaid_sync"), false);
  assert.equal(FOUNDING_PLANNING_FEATURES.includes("cloud_scenarios"), false);
  const membership = readFileSync("context/MembershipContext.tsx", "utf8");
  assert.match(membership, /resolvedAccess\?\.foundingPlanning === true/);
  assert.doesNotMatch(membership, /household_plans[\s\S]+upsert/);
});
