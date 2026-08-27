import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDebtSourceCommitments,
  advanceDebtProjectionWithCommitments,
  authoritativeDebtPaidAmountForMonth,
  automaticDebtRolloverForMonth,
  datedDebtPlanCacheSignature,
  configuredDebtAmountForRemainingPayment,
  configuredDebtMonthObligation,
  debtPlanPaymentBreakdown,
  effectiveDebtOccurrenceAmount,
  exactDebtPlanTotal,
  isValidExtraPaymentPlan,
  isPlannedDebtOccurrenceDate,
  parsePlannedDebtAmount,
  parsePlannedDebtOccurrenceDate,
  plannedDebtAmountError,
  remainingDebtAllocationsAfterReviewedPayments,
  resolveDebtOccurrenceSettlement,
  resolveDebtMonthSettlement,
  summarizeDebtOccurrenceSettlements,
} from "./debtPlanDomain";
import { projectDatedSnowballMonth } from "./snowball";
import { buildOverdueBillOccurrences } from "./overdueBills";
import { occurrenceKey, reviewedBillOccurrenceSettlements } from "./reviewCenter";

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

test("forecast edits can change the planned cadence without changing the lender-required amount", () => {
  assert.equal(effectiveDebtOccurrenceAmount(73, 30, 30), 30);
  assert.equal(effectiveDebtOccurrenceAmount(73, 30, 0), 0);
  assert.equal(effectiveDebtOccurrenceAmount(73, 30, undefined), 103);
  assert.equal(configuredDebtMonthObligation({
    baseMinimum: 73,
    snowballMinimumBoost: 30,
    occurrenceCount: 4,
    plannedDebtAmount: 30,
  }), 292);
});

test("a later recurring-minimum edit cannot make an exact reviewed payment overdue", () => {
  assert.deepEqual(resolveDebtMonthSettlement({
    configuredObligation: 153,
    occurrenceCount: 1,
    reviewed: { status: "settled", actualAmount: 127, requiredAmount: 127, occurrenceCount: 1 },
    override: { paid_amount: 127, actual_amount: 127, paid_date: "2026-08-10" },
  }), {
    configuredObligation: 127,
    paidAmount: 127,
    remainingRequired: 0,
    status: "settled",
  });
});

test("a corrected lower lender minimum overrides an obsolete larger review target", () => {
  const fixtures = [
    { name: "Mortgage", configured: 1467.13, reviewedRequired: 1500, paid: 1467.13 },
    { name: "Tia Credit Card 1", configured: 73, reviewedRequired: 80, paid: 73 },
    { name: "Discover", configured: 85, reviewedRequired: 113, paid: 85 },
  ];

  fixtures.forEach(({ name, configured, paid }) => {
    assert.deepEqual(resolveDebtMonthSettlement({
      configuredObligation: configured,
      occurrenceCount: 1,
      // Per-occurrence review normalization turns explicit full/exact history
      // into the amount actually required, without retaining the stale plan.
      reviewed: { status: "settled", actualAmount: paid, requiredAmount: paid, occurrenceCount: 1 },
      override: { paid_amount: paid, actual_amount: paid, paid_date: "2026-08-24" },
    }), {
      configuredObligation: configured,
      paidAmount: paid,
      remainingRequired: 0,
      status: "settled",
    }, name);
  });
});

test("one reviewed weekly occurrence cannot settle the rest of the month", () => {
  assert.deepEqual(resolveDebtMonthSettlement({
    configuredObligation: 400,
    occurrenceCount: 4,
    reviewed: { status: "settled", actualAmount: 100, requiredAmount: 100, occurrenceCount: 1 },
  }), {
    configuredObligation: 400,
    paidAmount: 100,
    remainingRequired: 300,
    status: "partial",
  });
});

test("an exact lower weekly occurrence keeps its own requirement without redistributing a false gap", () => {
  const dates = ["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26"];
  const reviewed = reviewedBillOccurrenceSettlements([{
    id: "weekly-first",
    date: "2026-08-05",
    amount: -90,
    category: "Debt",
    note: "Weekly debt",
    review_status: "matched",
    review_allocations: [{
      type: "bill",
      targetId: "weekly-debt",
      occurrenceDate: dates[0],
      amount: 90,
      plannedAmount: 100,
      settlement: "exact",
    }],
  }]);
  const occurrences = dates.map(occurrenceDate => resolveDebtOccurrenceSettlement({
    occurrenceDate,
    configuredObligation: 100,
    reviewed: reviewed.get(occurrenceKey("weekly-debt", occurrenceDate)),
  }));
  const settlement = summarizeDebtOccurrenceSettlements(occurrences);

  assert.deepEqual(occurrences.map(occurrence => ({
    date: occurrence.occurrenceDate,
    required: occurrence.configuredObligation,
    paid: occurrence.paidAmount,
    remaining: occurrence.remainingRequired,
  })), [
    { date: dates[0], required: 90, paid: 90, remaining: 0 },
    { date: dates[1], required: 100, paid: 0, remaining: 100 },
    { date: dates[2], required: 100, paid: 0, remaining: 100 },
    { date: dates[3], required: 100, paid: 0, remaining: 100 },
  ]);
  assert.equal(settlement.configuredObligation, 390);
  assert.equal(settlement.paidAmount, 90);
  assert.equal(settlement.remainingRequired, 300);
  assert.equal(settlement.occurrences?.[0]?.remainingRequired, 0);
});

test("a true partial keeps its reviewed requirement after a later lower recurring edit", () => {
  assert.deepEqual(resolveDebtMonthSettlement({
    configuredObligation: 800,
    occurrenceCount: 1,
    reviewed: { status: "partial", actualAmount: 1000, requiredAmount: 1500, occurrenceCount: 1 },
  }), {
    configuredObligation: 1500,
    paidAmount: 1000,
    remainingRequired: 500,
    status: "partial",
  });
});

test("an explicit zero required snapshot stays closed after the recurring minimum changes", () => {
  const occurrence = resolveDebtOccurrenceSettlement({
    occurrenceDate: "2026-08-04",
    configuredObligation: 153,
    paidAmount: 0,
    requiredAmountSnapshot: 0,
  });
  assert.deepEqual(occurrence, {
    occurrenceDate: "2026-08-04",
    configuredObligation: 0,
    paidAmount: 0,
    remainingRequired: 0,
    status: "settled",
  });
  assert.equal(summarizeDebtOccurrenceSettlements([occurrence]).status, "settled");
});

test("dated snowball requirements preserve a reviewed 1500/1000 partial after the configured minimum becomes 800", () => {
  const occurrenceDate = "2026-08-04";
  const occurrence = resolveDebtOccurrenceSettlement({
    occurrenceDate,
    configuredObligation: 800,
    reviewed: {
      status: "partial",
      actualAmount: 1000,
      requiredAmount: 1500,
    },
  });
  const settlement = summarizeDebtOccurrenceSettlements([occurrence]);
  assert.deepEqual(settlement, {
    configuredObligation: 1500,
    paidAmount: 1000,
    remainingRequired: 500,
    status: "partial",
    occurrences: [{
      occurrenceDate,
      configuredObligation: 1500,
      paidAmount: 1000,
      remainingRequired: 500,
      status: "partial",
    }],
  });

  let requiredCashRemaining = debtPlanPaymentBreakdown(
    settlement.configuredObligation,
  ).requiredPayment;
  const requiredPaymentsByDate = new Map((settlement.occurrences ?? []).map(item => {
    const amount = Math.min(item.configuredObligation, requiredCashRemaining);
    requiredCashRemaining = Math.max(0, requiredCashRemaining - amount);
    return [item.occurrenceDate, amount] as const;
  }));
  const plan = projectDatedSnowballMonth({
    debts: [{
      id: "mortgage",
      name: "Mortgage",
      balance: 20_000,
      minimum: 800,
      requiredPayment: 1500,
      requiredPaymentsByDate,
      apr: 0,
      dueDay: 4,
      included: true,
    }],
    method: "snowball",
    month: 7,
    year: 2026,
    paymentDatesByDebtId: new Map([["mortgage", [occurrenceDate]]]),
  });
  assert.deepEqual(
    plan.allocations.filter(allocation => allocation.kind === "required").map(allocation => [allocation.date, allocation.amount]),
    [[occurrenceDate, 1500]],
  );

  const remaining = remainingDebtAllocationsAfterReviewedPayments(
    plan.allocations,
    new Map([["mortgage", settlement]]),
  );
  assert.deepEqual(
    remaining.filter(allocation => allocation.kind === "required").map(allocation => [allocation.date, allocation.amount]),
    [[occurrenceDate, 500]],
  );
});

test("an original minimum settles the debt while rollover stays one separate forecast outflow", () => {
  const requiredMinimum = configuredDebtMonthObligation({
    baseMinimum: 85,
    snowballMinimumBoost: 29,
    occurrenceCount: 1,
    plannedDebtAmount: 114,
  });
  assert.equal(requiredMinimum, 85);
  assert.deepEqual(resolveDebtMonthSettlement({
    configuredObligation: requiredMinimum,
    reviewed: { status: "partial", actualAmount: 85 },
  }), {
    configuredObligation: 85,
    paidAmount: 85,
    remainingRequired: 0,
    status: "settled",
  });
  assert.deepEqual(buildOverdueBillOccurrences([{
    billId: "card",
    name: "Card",
    closed: false,
    occurrenceDays: [15],
    plannedTotal: requiredMinimum,
    paidTotal: 85,
  }], 7, 2026, 16), []);

  const plan = projectDatedSnowballMonth({
    debts: [{
      id: "card",
      name: "Card",
      balance: 1_000,
      minimum: requiredMinimum,
      apr: 0,
      dueDay: 15,
      included: true,
    }],
    method: "snowball",
    month: 7,
    year: 2026,
    rolledPayment: 29,
  });
  assert.equal(plan.allocations.filter(item => item.kind === "required").reduce((sum, item) => sum + item.amount, 0), 85);
  assert.equal(plan.allocations.filter(item => item.kind === "rollover").reduce((sum, item) => sum + item.amount, 0), 29);
  assert.equal(plan.plannedPayment, 114);
});

test("an exact debt override replaces rollover instead of stacking with it", () => {
  assert.equal(exactDebtPlanTotal({ plannedDebtAmount: 114, customAmount: 200, occurrenceCount: 1 }), 114);
  assert.equal(exactDebtPlanTotal({ customAmount: 114, occurrenceCount: 1 }), 114);
  assert.equal(exactDebtPlanTotal({ plannedDebtAmount: 0, occurrenceCount: 1 }), 0);
  assert.equal(automaticDebtRolloverForMonth(29, "card", new Set(["card"])), 0);
  assert.equal(automaticDebtRolloverForMonth(29, "card", new Set(["other"])), 29);
  assert.deepEqual(debtPlanPaymentBreakdown(85, 114), {
    requiredAmount: 85,
    requiredPayment: 85,
    plannedExtraPayment: 29,
    plannedPayment: 114,
  });
  assert.deepEqual(debtPlanPaymentBreakdown(85, 50), {
    requiredAmount: 85,
    requiredPayment: 50,
    plannedExtraPayment: 0,
    plannedPayment: 50,
  });
  const plan = projectDatedSnowballMonth({
    debts: [{
      id: "card",
      name: "Card",
      balance: 1_000,
      minimum: 85,
      requiredPayment: 85,
      plannedExtraPayment: 29,
      apr: 0,
      dueDay: 15,
      included: true,
    }],
    method: "snowball",
    month: 7,
    year: 2026,
    rolledPayment: 0,
  });
  assert.equal(plan.allocations.filter(item => item.kind === "required").reduce((sum, item) => sum + item.amount, 0), 85);
  assert.equal(plan.allocations.filter(item => item.kind === "rollover").reduce((sum, item) => sum + item.amount, 0), 29);
  assert.equal(plan.plannedPayment, 114);
  assert.equal(plan.plannedPayment + automaticDebtRolloverForMonth(29, "card", new Set(["card"])), 114);
});

test("payments above the original minimum consume this month's automatic rollover once", () => {
  const exactPlans = new Set<string>();
  assert.equal(automaticDebtRolloverForMonth(29, "card", exactPlans, Math.max(0, 85 - 85)), 29);
  assert.equal(automaticDebtRolloverForMonth(29, "card", exactPlans, Math.max(0, 100 - 85)), 14);
  assert.equal(automaticDebtRolloverForMonth(29, "card", exactPlans, Math.max(0, 114 - 85)), 0);
  assert.equal(automaticDebtRolloverForMonth(29, "card", exactPlans, Math.max(0, 200 - 85)), 0);
});

test("a live bank commitment authoritatively consumes planned extra without duplicating it", () => {
  const pending = [{
    sourceBillId: "card",
    sourceBillName: "Card",
    date: "2026-08-15",
    amount: 100,
    state: "pending" as const,
  }];
  const authoritativePaid = authoritativeDebtPaidAmountForMonth(0, pending, "card", "2026-08");
  assert.equal(authoritativePaid, 100);
  const remainingRollover = automaticDebtRolloverForMonth(29, "card", new Set(), authoritativePaid - 85);
  assert.equal(remainingRollover, 14);

  const automaticPlan = projectDatedSnowballMonth({
    debts: [{ id: "card", name: "Card", balance: 500, minimum: 85, apr: 0, dueDay: 15, included: true }],
    method: "snowball",
    month: 7,
    year: 2026,
    rolledPayment: remainingRollover,
  });
  const committedAutomaticPlan = applyDebtSourceCommitments(automaticPlan.allocations, pending);
  assert.equal(committedAutomaticPlan.reduce((sum, allocation) => sum + allocation.amount, 0), 114);
  assert.deepEqual(committedAutomaticPlan.map(allocation => [allocation.kind, allocation.amount]), [
    ["required", 85],
    ["rollover", 15],
    ["rollover", 14],
  ]);

  const exactPlan = projectDatedSnowballMonth({
    debts: [{
      id: "card",
      name: "Card",
      balance: 500,
      minimum: 85,
      requiredPayment: 85,
      plannedExtraPayment: 14,
      apr: 0,
      dueDay: 15,
      included: true,
    }],
    method: "snowball",
    month: 7,
    year: 2026,
    rolledPayment: 0,
  });
  const committedExactPlan = applyDebtSourceCommitments(exactPlan.allocations, pending);
  assert.equal(committedExactPlan.reduce((sum, allocation) => sum + allocation.amount, 0), 114);
  assert.deepEqual(committedExactPlan.map(allocation => [allocation.kind, allocation.amount]), [
    ["required", 85],
    ["rollover", 15],
    ["rollover", 14],
  ]);

  const fullCommitment = [{ ...pending[0]!, amount: 114 }];
  const committedFullPlan = applyDebtSourceCommitments(automaticPlan.allocations.filter(allocation => allocation.kind === "required"), fullCommitment);
  assert.deepEqual(committedFullPlan.map(allocation => [allocation.kind, allocation.amount]), [
    ["required", 85],
    ["rollover", 29],
  ]);
});

test("a pending continuation combines with an earlier reviewed partial without restoring rollover", () => {
  const pending = [{
    sourceBillId: "card",
    sourceBillName: "Card",
    date: "2026-08-15",
    amount: 64,
    state: "pending" as const,
  }];
  const authoritativePaid = authoritativeDebtPaidAmountForMonth(50, pending, "card", "2026-08");
  assert.equal(authoritativePaid, 114);
  assert.equal(automaticDebtRolloverForMonth(29, "card", new Set(), authoritativePaid - 85), 0);

  const remainingRequired = 35;
  const plan = projectDatedSnowballMonth({
    debts: [{
      id: "card",
      name: "Card",
      balance: 500,
      minimum: 85,
      requiredPayment: remainingRequired,
      apr: 0,
      dueDay: 15,
      included: true,
    }],
    method: "snowball",
    month: 7,
    year: 2026,
    rolledPayment: 0,
  });
  const committedPlan = applyDebtSourceCommitments(plan.allocations, pending);
  assert.equal(committedPlan.reduce((sum, allocation) => sum + allocation.amount, 0), 64);
});

test("future balances advance only the unpaid required amount plus rollover after a reviewed partial", () => {
  const debts = [{ id: "card", name: "Card", balance: 950, minimum: 85, apr: 0, dueDay: 15, included: true }];
  const fullPlan = projectDatedSnowballMonth({
    debts,
    method: "snowball",
    month: 7,
    year: 2026,
    rolledPayment: 29,
  });
  assert.equal(fullPlan.plannedPayment, 114);
  const allocations = remainingDebtAllocationsAfterReviewedPayments(
    fullPlan.allocations,
    new Map([["card", { paidAmount: 50 }]]),
  );
  assert.deepEqual(allocations.map(allocation => [allocation.kind, allocation.amount]), [
    ["required", 35],
    ["rollover", 29],
  ]);
  const remainingPlan = {
    ...fullPlan,
    allocations,
    plannedPayment: 64,
  };
  const advanced = advanceDebtProjectionWithCommitments(
    remainingPlan,
    debts,
    29,
    [],
    fullPlan.allocations,
  );
  assert.equal(advanced.balances.get("card"), 886);
});

test("a stored settled label cannot satisfy less than the original lender minimum", () => {
  const settlement = resolveDebtMonthSettlement({
    configuredObligation: 85,
    reviewed: { status: "settled", actualAmount: 50 },
    plannedDebtAmount: 50,
  });
  assert.deepEqual(settlement, {
    configuredObligation: 85,
    paidAmount: 50,
    remainingRequired: 35,
    status: "partial",
    plannedDebtAmount: 50,
  });
  const overdue = buildOverdueBillOccurrences([{
    billId: "card",
    name: "Card",
    closed: false,
    occurrenceDays: [15],
    plannedTotal: 85,
    paidTotal: 50,
  }], 7, 2026, 16);
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0]?.remainingAmount, 35);
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
  assert.deepEqual(allocations.map(allocation => [allocation.targetBillId, allocation.kind, allocation.amount]), [
    ["camera", "required", 30],
    ["camera", "rollover", 20],
  ]);
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
