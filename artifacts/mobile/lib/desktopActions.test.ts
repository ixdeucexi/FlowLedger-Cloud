import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_ADD_ACTIONS,
  desktopActivityDestination,
  desktopAddDestination,
  desktopPlannerDestination,
  isDesktopAddAction,
} from "./desktopActions";

test("desktop add actions share the dashboard modal entry points", () => {
  assert.deepEqual(DESKTOP_ADD_ACTIONS, ["income", "bill", "debt", "goal"]);
  assert.deepEqual(desktopAddDestination("debt"), {
    pathname: "/(tabs)",
    params: { action: "debt" },
  });
  assert.equal(isDesktopAddAction("goal"), true);
  assert.equal(isDesktopAddAction("unknown"), false);
});

test("desktop activity rows open the shared Activity editor flow", () => {
  assert.deepEqual(desktopActivityDestination("transaction-42", "open-1"), {
    pathname: "/(tabs)/transactions",
    params: { activityId: "transaction-42", activityAt: "open-1" },
  });
});

test("desktop-only summaries enter planner mode for detailed PWA settings", () => {
  assert.deepEqual(desktopPlannerDestination("plaid"), {
    pathname: "/(tabs)/more",
    params: { section: "plaid", mode: "planner" },
  });
  assert.deepEqual(desktopPlannerDestination("notifications"), {
    pathname: "/(tabs)/more",
    params: { section: "notifications", mode: "planner" },
  });
});
