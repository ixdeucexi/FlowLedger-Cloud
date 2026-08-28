import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("startup stays constant until the destination screen is ready", () => {
  const layout = readFileSync("app/_layout.tsx", "utf8");
  const brand = readFileSync("components/AppLoadingIntro.tsx", "utf8");
  const index = readFileSync("app/index.tsx", "utf8");
  const appConfig = readFileSync("app.config.js", "utf8");
  const webDocument = readFileSync("public/index.html", "utf8");
  const webCover = readFileSync("lib/webStartupCover.ts", "utf8");

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
    /const readyToReveal =\s*navigationReady && \(!effectivePrivacyShielded \|\| !!privacyRefreshError\)/,
  );
  assert.doesNotMatch(layout, /const initialPlanReady/);
  assert.doesNotMatch(
    layout,
    /if \(budgetLoading\) \{[\s\S]{0,120}setPrivacyShielded\(true\)/,
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

  const coverPosition = webDocument.indexOf('id="flowledger-web-startup-cover"');
  const rootPosition = webDocument.indexOf('id="root"');
  assert.ok(coverPosition > 0 && coverPosition < rootPosition);
  assert.match(webDocument, /#flowledger-web-startup-cover \{[\s\S]+position: fixed;[\s\S]+inset: 0;[\s\S]+z-index: 2147483647;[\s\S]+background: #050816/);
  assert.match(webDocument, /data-state="visible"[\s\S]+data-reason="initial"/);
  assert.match(webDocument, /role="progressbar"[\s\S]+aria-label="Loading your FlowLedger plan"/);
  assert.match(webDocument, /Loading Plan\.\.\./);
  assert.match(webDocument, /<div id="root" inert aria-hidden="true"><\/div>/);
  assert.match(webDocument, /visibilitychange[\s\S]+document\.visibilityState === "hidden"[\s\S]+arm\("resume"\)/);
  assert.match(webDocument, /pagehide[\s\S]+arm\("resume"\)/);
  assert.doesNotMatch(webDocument, /pageshow[\s\S]+data\.state\s*=\s*"hidden"/);
  assert.match(webDocument, /<noscript>[\s\S]+#flowledger-web-startup-cover \{ display: none; \}/);
  assert.match(webCover, /root\.removeAttribute\("inert"\)/);
  assert.match(webCover, /cover\.dataset\.state = "hidden"/);
  assert.doesNotMatch(webCover, /\.remove\(\)/);
  assert.match(webCover, /WEB_WORKSPACE_READY_EVENT = "flowledger:workspace-ready"/);
  assert.match(webCover, /currentWorkspaceReadyScopeKey = scopeKey/);
  assert.match(webCover, /workspaceReadyScopeKey === currentScopeKey/);
  assert.match(webCover, /verifiedScopeKey === currentScopeKey/);
  assert.match(layout, /visible: document\.visibilityState === "visible"/);
  assert.match(layout, /shouldReleaseWebStartupCover\(/);
  assert.match(layout, /<ErrorBoundary onError=\{\(\) => releaseWebStartupCover\(\)\}>/);
});

test("cold-start uses a verified saved plan instead of a navigation-only loading shell", () => {
  const tabs = readFileSync("app/(tabs)/_layout.tsx", "utf8");
  const setup = readFileSync("app/setup.tsx", "utf8");
  const simulator = readFileSync("app/plan-simulator.tsx", "utf8");
  const callback = readFileSync("app/auth/callback.tsx", "utf8");

  assert.doesNotMatch(tabs, /PlanRestoreOverlay|phase="plan"/);
  assert.match(tabs, /!dataUpdatedAt \|\| !startupCoreReady \|\| !workspaceMounted/);
  assert.match(tabs, /requestAnimationFrame\(\(\) => \{[\s\S]+requestAnimationFrame/);
  assert.match(tabs, /onLayout=\{\(\) => setWorkspaceMounted\(true\)\}/);
  assert.match(tabs, /!workspaceReadyToReveal \? \(/);
  assert.match(tabs, /workspaceLoadingOverlay/);
  assert.match(tabs, /publishWebWorkspaceReadiness\(workspaceScopeKey, workspaceReadyToReveal\)/);
  assert.doesNotMatch(tabs, /releaseWebStartupCover/);
  assert.match(tabs, /<AppLoadingIntro[\s\S]+phase="workspace"/);
  assert.doesNotMatch(tabs, /WorkspaceLoadingMobileNavigation/);
  assert.doesNotMatch(tabs, /You can choose another page while it loads/);
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
    /withLoadTimeout\(\s*resolveHouseholds\(uid, false\),\s*8000,\s*"Load households"/,
  );
  assert.match(budgetContext, /finally \{[\s\S]*?shouldReleaseBudgetLoading\(\{[\s\S]*?setLoading\(false\)/);
  assert.match(budgetContext, /const startupCoreReady = demoMode \|\| Boolean\(/);
  assert.match(
    budgetContext,
    /hydrateBudgetPlanCache[\s\S]+setStartupCoreReadyScopeKey\(`\$\{cache\.userId\}:\$\{nextHousehold\.householdId\}`\)/,
  );
  assert.match(
    budgetContext,
    /setStartupCoreReadyScopeKey\([\s\S]+`\$\{uid\}:\$\{scope\.householdId\}`/,
  );
  assert.match(budgetContext, /clearScopedFinancialData[\s\S]+setStartupCoreReadyScopeKey\(null\)/);
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
  assert.match(
    layout,
    /if \(ownsLegacyPersonalRows\(scope\)\)/,
  );
  assert.doesNotMatch(
    layout,
    /verificationIsFresh|SHARED_HOUSEHOLD_PRIVACY_TTL_MS/,
  );
  assert.match(
    layout,
    /if \(ownsLegacyPersonalRows\(scope\)\)[\s\S]*?verifySharedHousehold\(true\)/,
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
    /webWasHiddenRef\.current = false;[\s\S]+setWebRevealEpoch\(value => value \+ 1\)/,
  );
  assert.match(layout, /webRevealEpoch,[\s\S]+webWorkspaceReadyScopeKey/);
  assert.match(
    layout,
    /if \(\s*document\.visibilityState !== "visible" \|\|\s*!webWasHiddenRef\.current\s*\)\s*return/,
  );
  assert.match(layout, /document\.visibilityState === "hidden"\) markHidden\(\)/);
  assert.match(layout, /if \(scope\.userId && hasRevealedPlanRef\.current\) \{\s*setPrivacyShielded\(true\)/);
  assert.doesNotMatch(
    layout,
    /if \(budgetLoading\) \{\s*if \(!hasRevealedPlanRef\.current\) setPrivacyShielded\(true\)/,
  );
  assert.doesNotMatch(layout, /setPrivacyShielded\(false\);\s*\}, 120\)/);
  assert.match(layout, /setPrivacyRefreshRetry\(\(?value\)? => value \+ 1\)/);
  assert.match(
    layout,
    /withStartupTimeout\([\s\S]*?readLastAppRoute[\s\S]*?1_500/,
  );
  assert.match(layout, /prefetchRestorableRoute\(/);
  assert.match(layout, /verifiedPrivacyScopeKey === currentPrivacyScopeKey/);
  assert.match(layout, /restorableRouteApplyReady/);
  assert.match(layout, /restorableRouteCanApply\(\{/);
  assert.match(layout, /currentScopeKey: routeScopeKeyRef\.current/);
  assert.match(layout, /currentEntry: routePrefetchRef\.current/);
  assert.match(layout, /if \(loading \|\| \(session && budgetLoading\)\) return/);
  assert.match(layout, /if \(!requestedSetup && settings\.onboarding_completed\)/);
  assert.match(budgetContext, /if \(ownsLegacyPersonalRows\(priorScope\)\) return/);
});

test("scope and user transitions stay shielded, retryable, and remount route-local private state", () => {
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const membership = readFileSync("context/MembershipContext.tsx", "utf8");
  const layout = readFileSync("app/_layout.tsx", "utf8");
  const flo = readFileSync("app/(tabs)/flo.tsx", "utf8");

  assert.match(budgetContext, /useLayoutEffect\(\(\) => \{[\s\S]+financialDataUserIdRef\.current === userId/);
  assert.match(budgetContext, /clearScopedFinancialData\(\)[\s\S]+replaceActiveHouseholdScope\(null\)/);
  const resolveStart = budgetContext.indexOf("const resolveHouseholds");
  const resolveEnd = budgetContext.indexOf("const markSaveStarted", resolveStart);
  const resolution = budgetContext.slice(resolveStart, resolveEnd);
  assert.ok(resolution.indexOf("clearScopedFinancialData()") < resolution.indexOf("replaceActiveHouseholdScope(next)"));
  assert.match(resolution, /scopeTransitionPendingRef\.current/);
  assert.match(budgetContext, /waitForScopeCoreLoad\(next\.householdId\)[\s\S]+setLoadRetryNonce/);
  assert.match(budgetContext, /scopedRequestIsCurrent\(\{/);

  assert.match(layout, /verifiedPrivacyScopeKey !== currentPrivacyScopeKey/);
  assert.match(layout, /if \(budgetLoading \|\| budgetLoadError\) \{[\s\S]+return;/);
  assert.match(
    layout,
    /accessibilityElementsHidden=\{\s*biometricLocked \|\| effectivePrivacyShielded \|\| !readyToReveal/,
  );
  assert.match(layout, /key=\{navigatorPrivacyKey\}/);
  assert.match(layout, /currentPrivacyScopeKey \?\? `pending:\$\{session\.user\.id\}`/);
  assert.match(layout, /Your previous plan remains hidden\./);
  assert.match(layout, /onPress=\{retryBudgetLoad\}/);
  assert.match(layout, /const webWasHiddenRef = useRef\([\s\S]+document\.visibilityState === "hidden"/);

  assert.match(membership, /adminState\.userId === \(user\?\.id \?\? null\) && adminState\.value/);
  assert.match(membership, /requestId === adminRequestRef\.current/);
  assert.match(membership, /planState\.scopeKey === planScopeKey[\s\S]+mapHouseholdPlan\(null, householdId\)/);
  assert.match(membership, /setPlanState\(\{[\s\S]+scopeKey: planScopeKey/);

  assert.match(flo, /const floDataScopeKey = `\$\{user\?\.id/);
  assert.match(flo, /requestGeneration === requestGenerationRef\.current/);
  assert.match(flo, /requestScopeKey === floDataScopeKeyRef\.current/);
  assert.match(flo, /\[activeConversationId, floDataScopeKey, floProLocked\]/);
  const olderMessagesStart = flo.indexOf("const loadOlderMessages");
  const olderMessagesEnd = flo.indexOf("const stopStreaming", olderMessagesStart);
  const olderMessages = flo.slice(olderMessagesStart, olderMessagesEnd);
  assert.match(olderMessages, /const requestConversationId = activeConversationId/);
  assert.match(olderMessages, /const requestScopeKey = floDataScopeKey/);
  assert.match(olderMessages, /requestGeneration === requestGenerationRef\.current/);
  assert.match(olderMessages, /requestScopeKey === floDataScopeKeyRef\.current/);
  assert.match(olderMessages, /requestConversationId === activeConversationIdRef\.current/);
  assert.match(olderMessages, /if \(!requestIsCurrent\(\)\) return;[\s\S]+dispatch\(\{ type: "prepend"/);
  assert.match(olderMessages, /await Promise\.all[\s\S]+if \(!requestIsCurrent\(\)\) return;[\s\S]+setProposalByMessageId/);
  assert.match(olderMessages, /catch \{[\s\S]+if \(requestIsCurrent\(\)\) setChatError/);
});
