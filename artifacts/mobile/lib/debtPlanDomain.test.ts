import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDebtSourceCommitments,
  advanceDebtProjectionWithCommitments,
  datedDebtPlanCacheSignature,
  configuredDebtAmountForRemainingPayment,
  configuredDebtMonthObligation,
  effectiveDebtOccurrenceAmount,
  isValidExtraPaymentPlan,
  isPlannedDebtOccurrenceDate,
  parsePlannedDebtAmount,
  parsePlannedDebtOccurrenceDate,
  plannedDebtAmountError,
  resolveDebtMonthSettlement,
} from "./debtPlanDomain";
import { projectDatedSnowballMonth } from "./snowball";

test("dated debt cache signature changes when a remaining payment appears", () => {
  const base = {
    payments: [],
    balances: new Map<string, number>(),
    payoffOrder: [],
    paidOffNames: [],
    rolledPayment: 0,
    minimumPayments: 0,
    scheduledPayments: 0,
    extraPayment: 0,
    interest: 0,
    endingDebt: 0,
    plannedPayment: 0,
    unusedAmount: 0,
    allocations: [],
  };
  const withDiscover = {
    ...base,
    plannedPayment: 28,
    allocations: [{
      id: "discover-remaining",
      date: "2026-08-22",
      sourceBillId: "discover",
      targetBillId: "discover",
      targetBillName: "Discover",
      kind: "required" as const,
      amount: 28,
      sourceAmount: 85,
      balanceBefore: 3046.97,
      balanceAfter: 3018.97,
      paidOff: false,
    }],
  };

  assert.equal(datedDebtPlanCacheSignature(base), "");
  assert.notEqual(datedDebtPlanCacheSignature(base), datedDebtPlanCacheSignature(withDiscover));
  assert.match(datedDebtPlanCacheSignature(withDiscover), /2026-08-22:discover:discover:required:28\.00/);
});

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

test("exact debt overrides replace automatic minimum plus boost per occurrence", () => {
  assert.equal(effectiveDebtOccurrenceAmount(73, 30, 30), 30);
  assert.equal(effectiveDebtOccurrenceAmount(73, 30, 0), 0);
  assert.equal(effectiveDebtOccurrenceAmount(73, 30, undefined), 103);
  assert.equal(configuredDebtMonthObligation({
    baseMinimum: 73,
    snowballMinimumBoost: 30,
    occurrenceCount: 4,
    plannedDebtAmount: 30,
  }), 120);
});

test("planned debt edits cannot undercut a live pending commitment", () => {
  assert.equal(plannedDebtAmountError(42.81, 42.81), undefined);
  assert.match(plannedDebtAmountError(30, 42.81) ?? "", /already pending/);
  assert.equal(plannedDebtAmountError(0, 0), undefined);
  assert.match(plannedDebtAmountError(-1) ?? "", /zero or more/);
});

test("planned debt input and route dates are parsed strictly", () => {
  assert.equal(parsePlannedDebtAmount("30.50"), 30.5);
  assert.equal(parsePlannedDebtAmount(".75"), 0.75);
  assert.equal(parsePlannedDebtAmount("30.5.7"), undefined);
  assert.equal(parsePlannedDebtAmount("30.555"), undefined);
  assert.equal(parsePlannedDebtAmount("30 dollars"), undefined);
  assert.deepEqual(parsePlannedDebtOccurrenceDate("2026-02-28"), { year: 2026, month: 1, day: 28 });
  assert.equal(parsePlannedDebtOccurrenceDate("2026-02-31"), undefined);
  assert.equal(isPlannedDebtOccurrenceDate("2026-08-11", [11, 18, 25]), true);
  assert.equal(isPlannedDebtOccurrenceDate("2026-08-12", [11, 18, 25]), false);
});

test("editing a remaining payment preserves money already paid", () => {
  assert.equal(configuredDebtAmountForRemainingPayment(113, 57), 170);
  assert.equal(configuredDebtAmountForRemainingPayment(56, 57), 113);
  assert.equal(configuredDebtAmountForRemainingPayment(113.337, -5), 113.34);
});

test("a pending source commitment replaces the source group and drops uncommitted rollover", () => {
  const allocations = [
    { id: "camera-required", kind: "required" as const, sourceBillId: "camera", sourceBillName: "Camera", targetBillId: "camera", targetBillName: "Camera", date: "2026-08-11", amount: 42.81, sourceAmount: 103, balanceBefore: 42.81, balanceAfter: 0, paidOff: true },
    { id: "camera-rollover", kind: "rollover" as const, sourceBillId: "camera", sourceBillName: "Camera", targetBillId: "concert", targetBillName: "Concert", date: "2026-08-11", amount: 60.19, sourceAmount: 103, balanceBefore: 319, balanceAfter: 258.81, paidOff: false },
  ];
  const pending = applyDebtSourceCommitments(allocations, [
    { sourceBillId: "camera", date: "2026-08-11", amount: 42.81, state: "pending" },
  ]);
  assert.deepEqual(pending.map(allocation => [allocation.targetBillId, allocation.amount]), [["camera", 42.81]]);
  assert.equal(pending.reduce((sum, allocation) => sum + allocation.amount, 0), 42.81);
  assert.deepEqual(applyDebtSourceCommitments(allocations, []), allocations);
  assert.deepEqual(applyDebtSourceCommitments(allocations, [
    { sourceBillId: "camera", date: "2026-08-11", amount: 0, state: "posted" },
  ]), []);
});

test("live Camera fixture keeps pending authoritative and restores automatic rollover when it disappears", () => {
  const project = (minimum: number) => projectDatedSnowballMonth({
    debts: [
      { id: "camera", name: "Camera", balance: 42.81, minimum, apr: 0, dueDay: 11, included: true },
      { id: "concert", name: "Concert", balance: 319, minimum: 0, apr: 0, dueDay: 29, included: true },
    ],
    method: "snowball",
    month: 7,
    year: 2026,
    paymentDatesByDebtId: new Map([["camera", ["2026-08-11"]]]),
  });
  const automatic = project(effectiveDebtOccurrenceAmount(73, 30));
  assert.deepEqual(automatic.allocations.map(allocation => [allocation.targetBillId, allocation.amount]), [
    ["camera", 42.81],
    ["concert", 60.19],
  ]);
  assert.equal(automatic.plannedPayment, 103);

  const pending = applyDebtSourceCommitments(automatic.allocations, [{
    sourceBillId: "camera",
    date: "2026-08-11",
    amount: 42.81,
    state: "pending",
  }]);
  assert.deepEqual(pending.map(allocation => [allocation.targetBillId, allocation.amount]), [["camera", 42.81]]);
  assert.equal(pending.reduce((total, allocation) => total + allocation.amount, 0), 42.81);
  assert.deepEqual(applyDebtSourceCommitments(automatic.allocations, []), automatic.allocations);

  const exactThirty = project(effectiveDebtOccurrenceAmount(73, 30, 30));
  assert.deepEqual(exactThirty.allocations.map(allocation => [allocation.targetBillId, allocation.amount]), [["camera", 30]]);
  assert.equal(exactThirty.plannedPayment, 30);
  assert.equal(project(effectiveDebtOccurrenceAmount(73, 30, 0)).plannedPayment, 0);
});

test("a larger pending amount cash-impacts once without inventing a rollover creditor", () => {
  const debts = [
    { id: "camera", name: "Camera", balance: 42.81, minimum: 30, apr: 0, dueDay: 11, included: true },
    { id: "concert", name: "Concert", balance: 319, minimum: 0, apr: 0, dueDay: 29, included: true },
  ];
  const plan = projectDatedSnowballMonth({ debts, method: "snowball", month: 7, year: 2026 });
  const commitments = [{ sourceBillId: "camera", sourceBillName: "Camera", sourceBalance: 42.81, date: "2026-08-11", amount: 50, state: "pending" as const }];
  const allocations = applyDebtSourceCommitments(plan.allocations, commitments);
  assert.deepEqual(allocations.map(allocation => [allocation.targetBillId, allocation.amount]), [["camera", 50]]);
  const advanced = advanceDebtProjectionWithCommitments(plan, debts, 0, commitments);
  assert.equal(advanced.balances.get("camera"), 0);
  assert.equal(advanced.balances.get("concert"), 319);
  assert.equal(advanced.allocations.reduce((sum, allocation) => sum + allocation.amount, 0), 50);
});

test("suppressed August rollover does not reduce the September starting balance", () => {
  const augustDebts = [
    { id: "camera", name: "Camera", balance: 42.81, minimum: 103, apr: 0, dueDay: 11, included: true },
    { id: "concert", name: "Concert", balance: 319, minimum: 0, apr: 0, dueDay: 29, included: true },
  ];
  const august = projectDatedSnowballMonth({ debts: augustDebts, method: "snowball", month: 7, year: 2026 });
  const automaticAdvance = advanceDebtProjectionWithCommitments(august, augustDebts, 0, []);
  assert.deepEqual(automaticAdvance.balances, august.balances);
  assert.equal(automaticAdvance.rolledPayment, august.rolledPayment);
  const advanced = advanceDebtProjectionWithCommitments(august, augustDebts, 0, [{
    sourceBillId: "camera", sourceBillName: "Camera", sourceBalance: 42.81, date: "2026-08-11", amount: 42.81, state: "pending",
  }]);
  assert.equal(advanced.balances.get("concert"), 319);

  const september = projectDatedSnowballMonth({
    debts: augustDebts.map(debt => ({ ...debt, minimum: debt.id === "concert" ? 35 : 103 })),
    method: "snowball",
    month: 8,
    year: 2026,
    startingBalances: advanced.balances,
    rolledPayment: advanced.rolledPayment,
  });
  const firstConcert = september.allocations.find(allocation => allocation.targetBillId === "concert");
  assert.equal(firstConcert?.balanceBefore, 319);
});
