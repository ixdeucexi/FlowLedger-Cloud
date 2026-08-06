import assert from "node:assert/strict";
import test from "node:test";

import { APP_TABS, appTabsForPlanning, isAppTabActive } from "./appTabs";

test("desktop sidebar keeps the primary planning routes", () => {
  assert.deepEqual(APP_TABS.map(({ title }) => title), [
    "Dashboard",
    "Bills",
    "Activity",
    "Monthly",
    "More",
  ]);
});

test("every shared tab has a unique working route", () => {
  assert.deepEqual(APP_TABS.map(({ pathname }) => pathname), [
    "/(tabs)",
    "/(tabs)/bills",
    "/(tabs)/transactions",
    "/(tabs)/monthly",
    "/(tabs)/more",
  ]);
  assert.equal(new Set(APP_TABS.map(({ pathname }) => pathname)).size, APP_TABS.length);
});

test("desktop and PWA share the same Activity or Budget presentation", () => {
  assert.equal(appTabsForPlanning(false)[2]?.title, "Activity");
  assert.equal(appTabsForPlanning(false)[2]?.icon, "repeat");
  assert.equal(appTabsForPlanning(true)[2]?.title, "Budget");
  assert.equal(appTabsForPlanning(true)[2]?.icon, "pie-chart");
});

test("active tab paths work with or without the Expo route group", () => {
  assert.equal(isAppTabActive("index", "/"), true);
  assert.equal(isAppTabActive("index", "/(tabs)"), true);
  assert.equal(isAppTabActive("bills", "/bills"), true);
  assert.equal(isAppTabActive("bills", "/(tabs)/bills?mode=planner"), true);
  assert.equal(isAppTabActive("more", "/monthly"), false);
});
