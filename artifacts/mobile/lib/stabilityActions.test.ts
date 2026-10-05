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
test("both a shortfall and a covered payday open Flo with a grounded review", () => {
  for (const safeUntilPayday of [true, false]) {
    const action = stabilityPlanAction({ reserveTarget: 900, safeUntilPayday });
    assert.equal(action.pathname, "/(tabs)/flo");
    assert.match(action.params?.prompt ?? "", /bills and debt minimums/);
    assert.notEqual(action.params?.promptId, stabilityPlanAction({ reserveTarget: 900, safeUntilPayday }).params?.promptId);
  }
});
