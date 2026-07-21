import assert from "node:assert/strict";
import test from "node:test";

import { buildPaycheckPlan } from "./paycheckPlanning";

test("builds a paycheck window through the day before the next paycheck", () => {
  const plan = buildPaycheckPlan(
    [
      { id: "pay-1", name: "Main Paycheck", amount: 1000, date: "2026-07-05" },
      { id: "pay-2", name: "Main Paycheck", amount: 1000, date: "2026-07-19" },
    ],
    [
      { id: "rent", name: "Rent", amount: 300, dueDate: "2026-07-02" },
      { id: "phone", name: "Phone", amount: 100, dueDate: "2026-07-04" },
      { id: "car", name: "Car", amount: 250, dueDate: "2026-07-06" },
    ],
    [
      { date: "2026-07-01", balance: 700 },
      { date: "2026-07-02", balance: 400 },
      { date: "2026-07-04", balance: 450 },
      { date: "2026-07-05", balance: 1450 },
    ],
    200,
    "2026-07-01"
  );

  assert.equal(plan.nextPaycheck?.date, "2026-07-05");
  assert.equal(plan.windowEnd, "2026-07-04");
  assert.deepEqual(plan.billsDue.map(bill => bill.name), ["Rent", "Phone"]);
  assert.equal(plan.billsTotal, 400);
  assert.equal(plan.lowestBalance, 400);
  assert.equal(plan.safeToSpend, 200);
  assert.equal(plan.status, "safe");
});

test("marks the paycheck plan risky when the window falls below the safety floor", () => {
  const plan = buildPaycheckPlan(
    [{ name: "Main Paycheck", amount: 800, date: "2026-07-10" }],
    [{ name: "Utilities", amount: 220, dueDate: "2026-07-03" }],
    [{ date: "2026-07-03", balance: 125 }],
    200,
    "2026-07-01"
  );

  assert.equal(plan.status, "risk");
  assert.equal(plan.safeToSpend, 0);
});

test("returns an empty plan when there is no upcoming paycheck", () => {
  const plan = buildPaycheckPlan(
    [{ name: "Old Paycheck", amount: 800, date: "2026-06-28" }],
    [{ name: "Utilities", amount: 220, dueDate: "2026-07-03" }],
    [{ date: "2026-07-01", balance: 600 }],
    200,
    "2026-07-01"
  );

  assert.equal(plan.status, "empty");
  assert.equal(plan.nextPaycheck, null);
  assert.equal(plan.billsDue.length, 0);
});

test("keeps the paycheck window on date-only month boundaries", () => {
  const plan = buildPaycheckPlan(
    [{ name: "Main Paycheck", amount: 800, date: "2026-08-01" }],
    [{ name: "Rent", amount: 300, dueDate: "2026-07-31" }],
    [{ date: "2026-07-31", balance: 500 }],
    200,
    "2026-07-31",
  );

  assert.equal(plan.windowEnd, "2026-07-31");
  assert.deepEqual(plan.billsDue.map(bill => bill.name), ["Rent"]);
});
