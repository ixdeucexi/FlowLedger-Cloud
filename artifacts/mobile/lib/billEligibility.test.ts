import assert from "node:assert/strict";
import test from "node:test";

import { isBillVisibleForPlanningMonth } from "./billEligibility";

test("closed debts are hidden from current and future planning but retained in history", () => {
  const closed = { is_debt: true, balance: 0 };
  assert.equal(isBillVisibleForPlanningMonth(closed, 9, 2026, 9, 2026), false);
  assert.equal(isBillVisibleForPlanningMonth(closed, 10, 2026, 9, 2026), false);
  assert.equal(isBillVisibleForPlanningMonth(closed, 8, 2026, 9, 2026), true);
});

test("planning eligibility uses the canonical closed-debt threshold", () => {
  assert.equal(isBillVisibleForPlanningMonth({ is_debt: true, balance: 0.009 }, 9, 2026, 9, 2026), false);
  assert.equal(isBillVisibleForPlanningMonth({ is_debt: true, balance: 0.0091 }, 9, 2026, 9, 2026), true);
  assert.equal(isBillVisibleForPlanningMonth({ is_debt: false, balance: 0 }, 9, 2026, 9, 2026), true);
});

test("an explicit household month wins at a device-timezone month boundary", () => {
  const closed = { is_debt: true, balance: 0 };
  // The device may already be November while the household is still October.
  assert.equal(isBillVisibleForPlanningMonth(closed, 9, 2026, 9, 2026), false);
  // The device may still be October while the household has reached November.
  assert.equal(isBillVisibleForPlanningMonth(closed, 9, 2026, 10, 2026), true);
});
