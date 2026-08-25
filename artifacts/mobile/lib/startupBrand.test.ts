import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("startup stays constant until the destination screen is ready", () => {
  const layout = readFileSync("app/_layout.tsx", "utf8");
  const brand = readFileSync("components/AppLoadingIntro.tsx", "utf8");
  const index = readFileSync("app/index.tsx", "utf8");
  const appConfig = readFileSync("app.config.js", "utf8");

  assert.match(layout, /SplashScreen\.preventAutoHideAsync\(\)/);
  assert.match(
    layout,
    /SplashScreen\.setOptions\(\{ duration: 0, fade: false \}\)/,
  );
  assert.match(layout, /const initialAppReady = coreReady/);
  assert.match(layout, /if \(initialAppReady\) setAppReady\(true\)/);
  assert.match(layout, /const navigationReady\s*=\s*appReady\s*&&/);
  assert.match(
    layout,
    /const readyToReveal =\s*navigationReady && \(!privacyShielded \|\| !!privacyRefreshError\)/,
  );
  assert.match(layout, /if \(appReady\) void hideSplash\(\)/);
  assert.match(layout, /\{!readyToReveal \? \(/);
  assert.doesNotMatch(layout, /setAppReady\(false\)/);
  assert.doesNotMatch(
    layout,
    /STARTUP_BRAND_FADE_MS|STARTUP_BRAND_HOLD_MS|APP_REVEAL_MS/,
  );
  assert.doesNotMatch(
    layout,
    /Animated\.(sequence|parallel|timing)|setShowStartupOverlay|setWebExitStarted/,
  );
  assert.match(
    appConfig,
    /image: "\.\/assets\/images\/startup_f_transparent\.png"/,
  );
  assert.match(appConfig, /backgroundColor: "#050816"/);

  assert.match(brand, /Loading your FlowLedger plan/);
  assert.match(brand, /accessibilityRole="progressbar"/);
  assert.match(brand, /<StartupPlanBrand \/>/);

  const originalBrand = readFileSync("components/StartupPlanBrand.tsx", "utf8");
  assert.match(originalBrand, /Loading Plan\.\.\./);
  assert.match(originalBrand, /const STARTUP_LOGO_SIZE = 200/);
  assert.doesNotMatch(brand, /Starting FlowLedger|PHASE_MESSAGES|orbitMarker/);

  assert.match(layout, /<AppLoadingIntro phase="app" \/>/);
  assert.doesNotMatch(layout, /<AppLoadingIntro[\s\S]{0,120}phase="privacy"/);
  assert.match(index, /<AppLoadingIntro phase="app" \/>/);
  assert.doesNotMatch(index, /Animated|timing|opacity/);
});

test("cold-start loading states share the FlowLedger loading experience without covering restored tabs", () => {
  const tabs = readFileSync("app/(tabs)/_layout.tsx", "utf8");
  const setup = readFileSync("app/setup.tsx", "utf8");
  const simulator = readFileSync("app/plan-simulator.tsx", "utf8");
  const callback = readFileSync("app/auth/callback.tsx", "utf8");

  assert.doesNotMatch(tabs, /PlanRestoreOverlay|phase="plan"/);
  assert.match(tabs, /<AppLoadingIntro phase="workspace"/);
  assert.match(tabs, /Welcome back/);
  assert.match(tabs, /We’re getting your plan ready/);
  assert.doesNotMatch(tabs, /Couldn’t load your plan|\{message\}/);
  assert.match(setup, /<AppLoadingIntro phase="setup"/);
  assert.match(simulator, /<AppLoadingIntro phase="simulator"/);
  assert.match(callback, /<AppLoadingIntro phase="privacy"/);
});

test("startup plan loading fails closed instead of hanging on household discovery", () => {
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const authContext = readFileSync("context/AuthContext.tsx", "utf8");
  const layout = readFileSync("app/_layout.tsx", "utf8");

  assert.match(
    budgetContext,
    /withLoadTimeout\(\s*resolveHouseholds\(uid\),\s*8000,\s*"Load households"/,
  );
  assert.match(budgetContext, /finally \{[\s\S]*?setLoading\(false\)/);
  assert.match(
    budgetContext,
    /withLoadTimeout\(\s*verifyCurrentHouseholdMembership[\s\S]*?8000/,
  );
  assert.match(
    authContext,
    /withTimeout\(Linking\.getInitialURL\(\), 3000, "Initial app link"\)/,
  );
  assert.match(
    layout,
    /withStartupTimeout\(\s*privacyRefreshRef\.current\(\),\s*PRIVACY_REFRESH_TIMEOUT_MS/,
  );
  assert.match(layout, /if \(previous === "active"\) return/);
  assert.match(layout, /if \(scope\.isPersonal\)/);
  assert.doesNotMatch(
    layout,
    /verificationIsFresh|SHARED_HOUSEHOLD_PRIVACY_TTL_MS/,
  );
  assert.match(
    layout,
    /if \(scope\.isPersonal\)[\s\S]*?verifySharedHousehold\(true\)/,
  );
  assert.match(
    layout,
    /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/,
  );
  assert.match(
    layout,
    /window\.addEventListener\("pageshow", verifyAfterReturn\)/,
  );
  assert.match(
    layout,
    /if \(\s*document\.visibilityState !== "visible" \|\|\s*!webWasHiddenRef\.current\s*\)\s*return/,
  );
  assert.match(
    layout,
    /if \(budgetLoading\) \{\s*if \(!hasRevealedPlanRef\.current\) setPrivacyShielded\(true\)/,
  );
  assert.doesNotMatch(layout, /setPrivacyShielded\(false\);\s*\}, 120\)/);
  assert.match(layout, /setPrivacyRefreshRetry\(\(?value\)? => value \+ 1\)/);
  assert.match(
    layout,
    /withStartupTimeout\([\s\S]*?readLastAppRoute[\s\S]*?1_500/,
  );
  assert.match(budgetContext, /if \(priorScope\.isPersonal\) return/);
});
