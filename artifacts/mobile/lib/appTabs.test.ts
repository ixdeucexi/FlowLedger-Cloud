import assert from "node:assert/strict";
import test from "node:test";

import { APP_TABS, appTabsForPlanning, desktopTabsForPlanning, isAppTabActive, isDesktopPlanningTabActive } from "./appTabs";

test("desktop sidebar keeps the primary planning routes", () => {
  assert.deepEqual(APP_TABS.map(({ title }) => title), [
    "Dashboard",
    "Bills",
    "Activity",
    "Monthly",
    "Reports",
    "Settings",
  ]);
});

test("every shared tab has a unique working route", () => {
  assert.deepEqual(APP_TABS.map(({ pathname }) => pathname), [
    "/(tabs)",
    "/(tabs)/bills",
    "/(tabs)/transactions",
    "/(tabs)/monthly",
    "/(tabs)/reports",
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

test("desktop adds a dedicated Debt destination beside Bills", () => {
  assert.deepEqual(desktopTabsForPlanning(false).map(tab => tab.title), [
    "Dashboard",
    "Bills",
    "Debt",
    "Activity",
    "Monthly",
    "Reports",
    "Settings",
  ]);
  assert.deepEqual(desktopTabsForPlanning(false).find(tab => tab.name === "debt"), {
    name: "debt",
    title: "Debt",
    icon: "credit-card",
    pathname: "/(tabs)/bills",
    view: "debt",
  });
  assert.equal(isDesktopPlanningTabActive("debt", "/bills", "debt"), true);
  assert.equal(isDesktopPlanningTabActive("bills", "/bills", "debt"), false);
  assert.equal(isDesktopPlanningTabActive("bills", "/bills", "bills"), true);
});

test("active tab paths work with or without the Expo route group", () => {
  assert.equal(isAppTabActive("index", "/"), true);
  assert.equal(isAppTabActive("index", "/(tabs)"), true);
  assert.equal(isAppTabActive("bills", "/bills"), true);
  assert.equal(isAppTabActive("bills", "/(tabs)/bills?mode=planner"), true);
  assert.equal(isAppTabActive("more", "/monthly"), false);
});
