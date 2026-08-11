import assert from "node:assert/strict";
import test from "node:test";

import { isValidExtraPaymentPlan, resolveDebtMonthSettlement } from "./debtPlanDomain";

test("settled August debt fixtures retain their actual paid amounts without remaining obligations", () => {
  const fixtures = [73, 127, 450.08];
  fixtures.forEach(amount => {
    assert.deepEqual(resolveDebtMonthSettlement({
      configuredObligation: amount,
      reviewed: { status: "settled", actualAmount: amount },
      override: { paid_amount: 999, actual_amount: 999, paid_date: "2026-08-10" },
    }), {
      configuredObligation: amount,
      paidAmount: amount,
      remainingRequired: 0,
      status: "settled",
    });
  });
});

test("settlement metadata prefers reviewed matches and falls back to monthly overrides", () => {
  assert.deepEqual(resolveDebtMonthSettlement({
    configuredObligation: 100,
    reviewed: { status: "partial", actualAmount: 40 },
    override: { paid_amount: 75 },
  }), { configuredObligation: 100, paidAmount: 40, remainingRequired: 60, status: "partial" });
  assert.deepEqual(resolveDebtMonthSettlement({
    configuredObligation: 100,
    override: { paid_amount: 25 },
  }), { configuredObligation: 100, paidAmount: 25, remainingRequired: 75, status: "partial" });
  assert.deepEqual(resolveDebtMonthSettlement({ configuredObligation: 100 }), {
    configuredObligation: 100,
    paidAmount: 0,
    remainingRequired: 100,
    status: "scheduled",
  });
});

test("valid extra plans require a positive amount and matching positive allocations", () => {
  assert.equal(isValidExtraPaymentPlan({ amount: 0, allocations: [] }), false);
  assert.equal(isValidExtraPaymentPlan({ amount: 20, allocations: [] }), false);
  assert.equal(isValidExtraPaymentPlan({ amount: 20, allocations: [{ payment: 0 }] }), false);
  assert.equal(isValidExtraPaymentPlan({ amount: 20, allocations: [{ payment: 19.98 }] }), false);
  assert.equal(isValidExtraPaymentPlan({ amount: 20, allocations: [{ payment: 20 }, { payment: -1 }] }), false);
  assert.equal(isValidExtraPaymentPlan({ amount: 20, allocations: [{ payment: 12 }, { payment: 8 }] }), true);
  assert.equal(isValidExtraPaymentPlan({ amount: 20, allocations: [{ payment: 19.99 }] }), false);
  assert.equal(isValidExtraPaymentPlan({ amount: 20, allocations: [{ payment: 19.995 }] }), true);
});

test("preview-shaped plans use the same write-path validation", () => {
  assert.equal(isValidExtraPaymentPlan({ amount: 0, allocations: [] }), false);
  assert.equal(isValidExtraPaymentPlan({ amount: 35, allocations: [{ payment: 20 }] }), false);
  assert.equal(isValidExtraPaymentPlan({ amount: 35, allocations: [{ payment: 20 }, { payment: 15 }] }), true);
});
