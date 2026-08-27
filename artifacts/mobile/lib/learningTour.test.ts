import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LEARNING_TOUR_STEPS } from "./learningTourCatalog";

test("learning tour teaches the main FlowLedger surfaces in order", () => {
  assert.deepEqual(
    LEARNING_TOUR_STEPS.map(step => step.route),
    ["index", "monthly", "bills", "transactions", "flo", "more"],
  );
  assert.ok(LEARNING_TOUR_STEPS.every(step => step.floSays.includes("I ")));
  assert.ok(LEARNING_TOUR_STEPS.every(step => step.tryThis.length > 20));
  assert.ok(LEARNING_TOUR_STEPS.every(step => !step.tryThis.includes("July")));
});

test("Flo tour keeps its target visible for Basic and Pro members", () => {
  const tabLayout = readFileSync("app/(tabs)/_layout.tsx", "utf8");
  const basicFlo = readFileSync("components/BasicFlo.tsx", "utf8");
  const proFlo = readFileSync("app/(tabs)/flo.tsx", "utf8");

  assert.match(tabLayout, /activeStep\.route === "flo"[\s\S]*?top:/);
  assert.match(basicFlo, /prompt\.id === "afford" \? "guided-tour-flo"/);
  assert.match(proFlo, /nativeID="guided-tour-flo"/);
});

test("guided tour starts and resumes on native as well as web", () => {
  const controller = readFileSync("lib/learningTour.ts", "utf8");
  const tabLayout = readFileSync("app/(tabs)/_layout.tsx", "utf8");

  assert.match(controller, /AsyncStorage\.multiGet/);
  assert.match(controller, /subscribeToLearningTour/);
  assert.match(controller, /notifyLearningTour\(next\)/);
  assert.match(tabLayout, /hydrateLearningTourState\(\)\.then\(openTour\)/);
  assert.match(tabLayout, /AccessibilityInfo\.announceForAccessibility/);
  assert.doesNotMatch(
    controller,
    /startLearningTour\(\)[\s\S]{0,180}Platform\.OS === "web"/,
  );
});

test("Activity and Settings expose real tour targets and sign-out clears progress", () => {
  const activity = readFileSync("app/(tabs)/transactions.tsx", "utf8");
  const desktopActivity = readFileSync("components/desktop/DesktopActivityPage.tsx", "utf8");
  const settings = readFileSync("app/(tabs)/more.tsx", "utf8");
  const settingsHub = readFileSync("components/settings/MoreHub.tsx", "utf8");
  const auth = readFileSync("context/AuthContext.tsx", "utf8");
  const controller = readFileSync("lib/learningTour.ts", "utf8");

  assert.match(activity, /nativeID="guided-tour-transactions"[\s\S]{0,180}accessibilityLabel="Filter activity"/);
  assert.match(desktopActivity, /nativeID="guided-tour-transactions" style=\{styles\.filters\}/);
  assert.doesNotMatch(activity, /<View\s+nativeID="guided-tour-transactions"/);
  assert.match(settingsHub, /section\.id === "setup" \? "guided-tour-more"/);
  assert.doesNotMatch(settings, /<View\s+nativeID="guided-tour-more"/);
  assert.match(settings, /accessibilityHint="Opens the illustrated in-app user guide"/);
  assert.match(auth, /SIGNED_OUT[\s\S]*?clearLearningTourForAccountChange/);
  assert.match(auth, /await clearLearningTourForAccountChange\(\)/);
  assert.match(controller, /clearLearningTourForAccountChange[\s\S]*?AsyncStorage\.multiRemove/);
  assert.match(readFileSync("app/(tabs)/_layout.tsx", "utf8"), /scrollIntoView\(\{ block: "center"/);
});

test("Forecast and debt tour targets match the actions described", () => {
  const forecast = readFileSync("app/(tabs)/monthly.tsx", "utf8");
  const desktopForecast = readFileSync("components/desktop/DesktopCalendarPage.tsx", "utf8");
  const desktopDebt = readFileSync("components/desktop/DesktopBillsDebtsPage.tsx", "utf8");

  assert.match(forecast, /nativeID="guided-tour-monthly"[\s\S]{0,180}router\.push\("\/plan-simulator"\)/);
  assert.match(desktopForecast, /nativeID="guided-tour-monthly"[\s\S]{0,220}Plan Simulator/);
  assert.match(desktopDebt, /DesktopCard nativeID="guided-tour-bills"/);
  assert.match(LEARNING_TOUR_STEPS[1].tryThis, /Plan Simulator/);
  assert.match(LEARNING_TOUR_STEPS[2].tryThis, /Debt Payoff Progress/);
});
