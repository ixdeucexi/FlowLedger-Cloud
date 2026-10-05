import assert from "node:assert/strict";
import test from "node:test";
import { stabilityPlanAction } from "./stabilityActions";

test("an incomplete plan still opens the read-only payday review", () => {
  assert.deepEqual(stabilityPlanAction({ reserveTarget: 0, safeUntilPayday: null }), {
    label: "Review my payday plan", mode: "payday",
  });
});
test("an unknown payday opens the local review, which explains missing data", () => {
  assert.deepEqual(stabilityPlanAction({ reserveTarget: 900, safeUntilPayday: null }), {
    label: "Review my payday plan", mode: "payday",
  });
});
test("both a shortfall and a covered payday open an overlay, not Flo AI", () => {
  for (const safeUntilPayday of [true, false]) {
    const action = stabilityPlanAction({ reserveTarget: 900, safeUntilPayday });
    assert.deepEqual(action, { label: "Review my payday plan", mode: "payday" });
  }
});
