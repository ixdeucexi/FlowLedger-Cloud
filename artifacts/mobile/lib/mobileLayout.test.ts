import assert from "node:assert/strict";
import test from "node:test";

import { tabBarDisplayLabel, tabBarLabelSize } from "./mobileLayout";

test("tab labels shrink under enlarged-text viewport pressure", () => {
  assert.equal(tabBarLabelSize(240), 8);
  assert.equal(tabBarLabelSize(260), 8);
  assert.equal(tabBarLabelSize(275), 8);
  assert.equal(tabBarLabelSize(300), 10);
  assert.equal(tabBarLabelSize(360), 10);
});

test("long tab labels use readable compact names under zoom pressure", () => {
  assert.equal(tabBarDisplayLabel("Dashboard", 260), "Home");
  assert.equal(tabBarDisplayLabel("Monthly", 260), "Month");
  assert.equal(tabBarDisplayLabel("Activity", 260), "Activity");
  assert.equal(tabBarDisplayLabel("Dashboard", 360), "Dashboard");
});
