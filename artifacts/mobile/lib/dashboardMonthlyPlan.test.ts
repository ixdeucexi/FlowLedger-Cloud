import assert from "node:assert/strict";
import test from "node:test";
import { dashboardMonthlyPlan } from "./dashboardMonthlyPlan";

test("monthly plan preserves the existing remaining-income minus commitments presentation", () => {
  const input = Object.freeze({ plannedIncome: 7800, incomeStillExpected: 6400, billsDue: 3800, bucketAllocations: 300 });
  assert.deepEqual(dashboardMonthlyPlan(input), {
    planned: 4100, remaining: 2300, noMoreIncomeExpected: false, isShort: false,
    commitmentPercent: 64, progress: 4100 / 6400,
  });
  assert.equal(input.incomeStillExpected, 6400);
});

test("monthly plan distinguishes no planned income from no further income expected", () => {
  const base = { incomeStillExpected: 0, billsDue: 500, bucketAllocations: 100 };
  assert.deepEqual(dashboardMonthlyPlan({ ...base, plannedIncome: 3000 }), {
    planned: 600, remaining: -600, noMoreIncomeExpected: true, isShort: true,
    commitmentPercent: 0, progress: 0,
  });
  assert.equal(dashboardMonthlyPlan({ ...base, plannedIncome: 0 }).noMoreIncomeExpected, false);
});

test("monthly plan preserves shortfall, progress bounds and nonnegative commitments", () => {
  const short = dashboardMonthlyPlan({ plannedIncome: 2000, incomeStillExpected: 400, billsDue: 500, bucketAllocations: 100 });
  assert.equal(short.remaining, -200);
  assert.equal(short.isShort, true);
  assert.equal(short.commitmentPercent, 150);
  assert.equal(short.progress, 1);
  const released = dashboardMonthlyPlan({ plannedIncome: 2000, incomeStillExpected: 800, billsDue: -200, bucketAllocations: 100 });
  assert.equal(released.planned, 0);
  assert.equal(released.remaining, 800);
  assert.equal(released.progress, 0);
});
