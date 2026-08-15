import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { tabBarDisplayLabel, tabBarLabelSize } from "./mobileLayout";

test("tab labels shrink under enlarged-text viewport pressure", () => {
  assert.equal(tabBarLabelSize(240), 8);
  assert.equal(tabBarLabelSize(260), 8);
  assert.equal(tabBarLabelSize(275), 8);
  assert.equal(tabBarLabelSize(300), 8);
  assert.equal(tabBarLabelSize(312), 8);
  assert.equal(tabBarLabelSize(330), 8);
  assert.equal(tabBarLabelSize(340), 10);
  assert.equal(tabBarLabelSize(360), 10);
});

test("long tab labels use readable compact names under zoom pressure", () => {
  assert.equal(tabBarDisplayLabel("Dashboard", 260), "Home");
  assert.equal(tabBarDisplayLabel("Forecast", 260), "Forecast");
  assert.equal(tabBarDisplayLabel("Activity", 260), "Activity");
  assert.equal(tabBarDisplayLabel("Dashboard", 312), "Home");
  assert.equal(tabBarDisplayLabel("Forecast", 330), "Forecast");
  assert.equal(tabBarDisplayLabel("Dashboard", 340), "Dashboard");
  assert.equal(tabBarDisplayLabel("Dashboard", 360), "Dashboard");
});

test("inactive routes detach so covered screens leave the web tab order", () => {
  const tabLayout = readFileSync("app/(tabs)/_layout.tsx", "utf8");

  assert.match(tabLayout, /<Tabs[\s\S]*?detachInactiveScreens(?:=\{true\})?/);
  assert.doesNotMatch(tabLayout, /detachInactiveScreens=\{false\}/);
});
