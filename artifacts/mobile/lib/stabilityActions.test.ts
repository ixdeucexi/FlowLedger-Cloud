import assert from "node:assert/strict";
import test from "node:test";
import { stabilityPlanAction } from "./stabilityActions";

test("an incomplete required-bill plan opens Bills, not extra debt payments", () => {
  assert.deepEqual(stabilityPlanAction({ reserveTarget: 0, safeUntilPayday: null }), {
    label: "Review required bills", pathname: "/(tabs)/bills", params: { view: "bills" },
  });
});
test("an unknown payday opens existing Income settings", () => {
  assert.deepEqual(stabilityPlanAction({ reserveTarget: 900, safeUntilPayday: null }), {
    label: "Confirm next paycheck", pathname: "/(tabs)/more", params: { section: "money" },
  });
});
test("both a shortfall and a covered payday open the dated forecast for review", () => {
  for (const safeUntilPayday of [true, false]) {
    assert.equal(stabilityPlanAction({ reserveTarget: 900, safeUntilPayday }).pathname, "/(tabs)/monthly");
  }
});
