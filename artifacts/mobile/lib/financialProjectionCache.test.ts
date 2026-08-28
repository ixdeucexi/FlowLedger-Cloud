import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDashboardFinancialSnapshot,
  type DashboardFinancialSnapshotBuildInput,
  type DashboardFinancialSnapshotIdentity,
} from "./dashboardFinancialSnapshot";
import type {
  DashboardDailyBalance,
  DashboardTransaction,
} from "./dashboardFinancialModel";
import {
  buildFinancialProjectionIndexes,
  buildMatchedFinancialAllocationIndexes,
  authoritativeFreshnessTimestamp,
  financialProjectionPreparationMonths,
  financialProjectionMonthCacheKey,
  getOrComputeRevisionValue,
  reuseStructurallyEqualFinancialValue,
  startCancellableStageQueue,
} from "./financialProjectionCache";
import {
  countReviewQueue,
  matchedOccurrenceAllocations,
  reviewedBillMonthSettlements,
  reviewedBillOccurrenceSettlements,
} from "./reviewCenter";

function productionShapedLedger(size = 20_000): DashboardTransaction[] {
  return Array.from({ length: size }, (_, index) => {
    const month = (index % 60) + 1;
    const year = 2022 + Math.floor((month - 1) / 12);
    const monthOfYear = ((month - 1) % 12) + 1;
    const date = `${year}-${String(monthOfYear).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`;
    const matched = index % 5 === 0;
    const snowball = index % 25 === 0;
    return {
      id: `transaction-${index}`,
      date,
      amount: index % 7 === 0 ? 2_500 : -19.95,
      note: `Ledger transaction ${index}`,
      category: index % 7 === 0 ? "Income" : "Everyday",
      source: "plaid",
      plaid_account_id: "checking-1",
      review_status: matched ? "matched" : index % 31 === 0 ? "needs_review" : "categorized",
      review_resolution: snowball ? "snowball" : undefined,
      review_allocations: matched ? [{
        type: snowball ? "extra_principal" : "bill",
        targetId: snowball ? `debt-${index % 8}` : `bill-${index % 32}`,
        occurrenceDate: date,
        amount: 19.95,
        plannedAmount: 19.95,
        settlement: "exact",
      }] : undefined,
    };
  });
}

test("revision caches eliminate repeat projection work during snapshot publish", () => {
  const ledger = productionShapedLedger(2_000);
  const indexes = buildFinancialProjectionIndexes({
    transactions: ledger,
    forecastTransactions: ledger,
    visibleTransactions: ledger,
    commitments: ledger,
  });
  const identity: DashboardFinancialSnapshotIdentity = {
    userId: "user-one",
    householdId: "household-one",
    budgetId: "budget-one",
    dataRevision: "financial-42",
    planInputRevision: "2026-12-15",
  };
  const dailyCache = new Map<string, DashboardDailyBalance[]>();
  const cashFlowCache = new Map<string, {
    monthlyIncome: number;
    totalBillsDue: number;
    totalPaid: number;
    netTransactions: number;
    goalAllocations: number;
    remaining: number;
  }>();
  const remainingPlanCache = new Map<string, { allocations: [] }>();
  let dailyComputes = 0;
  let cashFlowComputes = 0;
  let remainingPlanComputes = 0;
  const balancesFor = (month: number, year: number) => getOrComputeRevisionValue(
    dailyCache,
    `${year}-${month}`,
    () => {
      dailyComputes += 1;
      return Array.from({ length: 31 }, (_, day): DashboardDailyBalance => ({
        day: day + 1,
        income: 0,
        expense: 0,
        bills: 0,
        net: 0,
        balance: 2_000,
      }));
    },
  );
  const cashFlowFor = (month: number, year: number) => getOrComputeRevisionValue(
    cashFlowCache,
    `${year}-${month}`,
    () => {
      cashFlowComputes += 1;
      return {
        monthlyIncome: 0,
        totalBillsDue: 0,
        totalPaid: 0,
        netTransactions: 0,
        goalAllocations: 0,
        remaining: 0,
      };
    },
  );
  const remainingPlanFor = (month: number, year: number) => getOrComputeRevisionValue(
    remainingPlanCache,
    `${year}-${month}`,
    () => {
      remainingPlanComputes += 1;
      return { allocations: [] as [] };
    },
  );

  // These are the provider's independently scheduled prewarm stages.
  cashFlowFor(11, 2026);
  balancesFor(11, 2026);
  balancesFor(0, 2027);
  balancesFor(1, 2027);
  remainingPlanFor(11, 2026);
  remainingPlanFor(0, 2027);
  const computeCountsBeforePublish = {
    dailyComputes,
    cashFlowComputes,
    remainingPlanComputes,
  };

  const input: DashboardFinancialSnapshotBuildInput = {
    now: new Date(2026, 11, 15, 12),
    selectedYear: 2026,
    settings: {
      zeroBasedBudgetEnabled: false,
      debtPayoffEnabled: true,
      paymentMethod: "snowball",
      starting_balance: 2_000,
      safety_floor: 200,
      forecast_horizon_months: 24,
      onboarding_completed: true,
    },
    forecastConfidence: { level: "high", label: "High", reasons: [] },
    accounts: [],
    connectedBankAccounts: [],
    pendingBankTransactions: [],
    pendingPlanMatches: [],
    categories: [],
    categoryBudgets: {},
    goals: [],
    incomes: [],
    allBills: [],
    allTransactions: ledger,
    reviewCenterCount: countReviewQueue(ledger, "2026-12-15"),
    postedIncome: 0,
    getCashFlow: cashFlowFor,
    getMonthlyBills: () => [],
    getMonthlyIncome: () => 0,
    getTransactionsForMonth: (month, year) => (
      indexes.transactionsByMonth.get(
        `${year}-${String(month + 1).padStart(2, "0")}`,
      ) ?? []
    ),
    getDailyBalances: balancesFor,
    getBillMonthlyTotal: () => 0,
    getPaidAmount: () => 0,
    getBillOccurrencesInMonth: () => [],
    getDebtMonthSettlements: () => new Map(),
    getRemainingDebtPlanForMonth: remainingPlanFor,
  };

  const snapshot = buildDashboardFinancialSnapshot(identity, input);

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(
    { dailyComputes, cashFlowComputes, remainingPlanComputes },
    computeCountsBeforePublish,
    "the atomic publish stage must only read prewarmed revision caches",
  );
  const replacementRevision = new Map<string, DashboardDailyBalance[]>();
  let replacementComputes = 0;
  getOrComputeRevisionValue(replacementRevision, "2026-11", () => {
    replacementComputes += 1;
    return balancesFor(11, 2026);
  });
  assert.equal(replacementComputes, 1, "a new source revision owns a fresh cache");
});

test("month projection caches roll at household-local month and year boundaries", () => {
  assert.notEqual(
    financialProjectionMonthCacheKey("2026-08", 8, 2026),
    financialProjectionMonthCacheKey("2026-09", 8, 2026),
  );
  assert.notEqual(
    financialProjectionMonthCacheKey("2026-12", 0, 2027),
    financialProjectionMonthCacheKey("2027-01", 0, 2027),
  );
  assert.equal(
    financialProjectionMonthCacheKey("2027-01", 0, 2027),
    financialProjectionMonthCacheKey("2027-01", 0, 2027),
  );
});

test("a next-month prewarm recomputes after the household date rolls", () => {
  const dailyCache = new Map<string, string>();
  let computes = 0;
  const readSeptember = (asOfDate: string) => getOrComputeRevisionValue(
    dailyCache,
    financialProjectionMonthCacheKey(asOfDate, 8, 2026),
    () => {
      computes += 1;
      return `projection-${computes}`;
    },
  );

  assert.equal(readSeptember("2026-08-31"), "projection-1");
  assert.equal(readSeptember("2026-08-31"), "projection-1");
  assert.equal(readSeptember("2026-09-01"), "projection-2");
  assert.equal(computes, 2);
});

test("date-sensitive projection caches roll on the next local day in the same month", () => {
  const dailyCache = new Map<string, string>();
  let computes = 0;
  const readAugust = (asOfDate: string) => getOrComputeRevisionValue(
    dailyCache,
    financialProjectionMonthCacheKey(asOfDate, 7, 2026),
    () => `projection-${++computes}`,
  );

  assert.equal(readAugust("2026-08-28"), "projection-1");
  assert.equal(readAugust("2026-08-28"), "projection-1");
  assert.equal(readAugust("2026-08-29"), "projection-2");
  assert.equal(computes, 2);
});

test("long projection history is prepared as one canonical month per cancellable stage", () => {
  const months = financialProjectionPreparationMonths({
    asOfDate: "2026-08-28",
    startingBalanceDate: "2016-08-15",
    targetMonth: 9,
    targetYear: 2026,
  });
  assert.deepEqual(months[0], { month: 7, year: 2016 });
  assert.deepEqual(months.at(-1), { month: 9, year: 2026 });
  assert.equal(months.length, 123);

  let cancelled = false;
  const visited: string[] = [];
  for (const { month, year } of months) {
    if (cancelled) break;
    visited.push(`${year}-${month}`);
    if (visited.length === 7) cancelled = true;
  }
  assert.equal(visited.length, 7, "blur cancellation stops before the next month");

  const observed = financialProjectionPreparationMonths({
    asOfDate: "2026-08-28",
    startingBalanceDate: "2016-08-15",
    observedAnchorDate: "2026-06-30",
    targetMonth: 9,
    targetYear: 2026,
  });
  assert.deepEqual(observed[0], { month: 6, year: 2026 });
  assert.deepEqual(observed.at(-1), { month: 9, year: 2026 });

  const sameMonthObservation = financialProjectionPreparationMonths({
    asOfDate: "2026-08-28",
    startingBalanceDate: "2016-08-15",
    observedAnchorDate: "2026-08-27",
    targetMonth: 9,
    targetYear: 2026,
  });
  assert.deepEqual(
    sameMonthObservation[0],
    { month: 7, year: 2016 },
    "same-month observations keep canonical historical reconciliation semantics",
  );
});

test("leaving Dashboard between stages cancels every queued projection task", () => {
  const pending: Array<{ cancelled: boolean; work: () => void }> = [];
  const completed: string[] = [];
  const cancel = startCancellableStageQueue({
    stages: [
      () => completed.push("current"),
      () => completed.push("next"),
      () => completed.push("publish"),
    ],
    schedule: work => {
      const handle = { cancelled: false, work };
      pending.push(handle);
      return handle;
    },
    cancelScheduled: handle => {
      handle.cancelled = true;
    },
    onError: error => {
      throw error;
    },
  });

  const first = pending.shift();
  assert.ok(first);
  first.work();
  assert.deepEqual(completed, ["current"]);
  cancel();
  pending.forEach(handle => handle.work());
  assert.deepEqual(completed, ["current"]);
  assert.ok(pending.every(handle => handle.cancelled));
});

test("paid bill indexes ignore allocations that are no longer matched", () => {
  const allocation = {
    type: "bill" as const,
    targetId: "bill-one",
    occurrenceDate: "2026-08-04",
    amount: 32.87,
    settlement: "exact" as const,
  };
  const indexes = buildMatchedFinancialAllocationIndexes([
    {
      id: "matched",
      date: "2026-08-04",
      amount: -32.87,
      note: "Mortgage",
      category: "Housing",
      review_status: "matched",
      review_allocations: [allocation],
    },
    {
      id: "reopened",
      date: "2026-08-04",
      amount: -90,
      note: "Reopened payment",
      category: "Housing",
      review_status: "needs_review",
      review_allocations: [{ ...allocation, amount: 90 }],
    },
  ]);

  assert.equal(indexes.paidBillAmountByMonth.get("2026-08"), 32.87);
});

test("the one-pass allocation indexes preserve canonical merge semantics", () => {
  const ledger = productionShapedLedger(2_000);
  const indexes = buildMatchedFinancialAllocationIndexes(ledger);
  assert.deepEqual(
    indexes.bill,
    matchedOccurrenceAllocations(ledger, "bill"),
  );
  assert.deepEqual(
    indexes.income,
    matchedOccurrenceAllocations(ledger, "income"),
  );
  assert.deepEqual(
    indexes.snowball,
    matchedOccurrenceAllocations(ledger, "extra_principal", "snowball"),
  );
  assert.deepEqual(
    indexes.reviewedBillOccurrences,
    reviewedBillOccurrenceSettlements(ledger),
  );
  assert.deepEqual(
    indexes.reviewedBillSettlements,
    reviewedBillMonthSettlements(ledger),
  );
});

test("combined reviewed settlements preserve per-allocation cent rounding", () => {
  const rows = [1.001, 1.004].map((amount, index) => ({
    id: `fractional-${index}`,
    date: "2026-08-04",
    amount: -amount,
    note: "Bill",
    category: "Housing",
    review_status: "matched",
    review_allocations: [{
      type: "bill" as const,
      targetId: "bill-one",
      occurrenceDate: "2026-08-04",
      amount,
      plannedAmount: 2,
      settlement: index === 0 ? "partial" as const : "exact" as const,
    }],
  }));
  const indexes = buildMatchedFinancialAllocationIndexes(rows);
  assert.deepEqual(
    indexes.reviewedBillOccurrences,
    reviewedBillOccurrenceSettlements(rows),
  );
  assert.equal(
    indexes.reviewedBillOccurrences.get("bill-one:2026-08-04")?.actualAmount,
    2,
  );
});

test("identical cached-to-live rows preserve revision and index ownership", () => {
  const cached = productionShapedLedger(2_000);
  const live: DashboardTransaction[] = cached.map(transaction => ({
    ...transaction,
    review_allocations: transaction.review_allocations?.map(allocation => ({
      ...allocation,
    })),
  }));
  const selected = reuseStructurallyEqualFinancialValue(cached, live);
  let revision = 7;
  let indexBuilds = 0;
  if (selected !== cached) {
    revision += 1;
    indexBuilds += 1;
  }

  assert.equal(selected, cached);
  assert.equal(revision, 7);
  assert.equal(indexBuilds, 0);
  const changed = live.map((transaction, index) => (
    index === live.length - 1
      ? { ...transaction, amount: transaction.amount - 1 }
      : transaction
  ));
  const changedSelection = reuseStructurallyEqualFinancialValue(cached, changed);
  assert.notEqual(changedSelection, cached);
  assert.equal(changedSelection[0], cached[0]);
});

test("an identical authoritative refresh keeps the cached freshness timestamp", () => {
  const cachedTimestamp = "2026-08-28T12:00:00.000Z";
  assert.equal(authoritativeFreshnessTimestamp({
    currentTimestamp: cachedTimestamp,
    revisionBeforeRefresh: "scope:7.4.2",
    revisionAfterRefresh: "scope:7.4.2",
    authoritativeTimestamp: "2026-08-28T12:00:03.000Z",
  }), cachedTimestamp);
  assert.equal(authoritativeFreshnessTimestamp({
    currentTimestamp: cachedTimestamp,
    revisionBeforeRefresh: "scope:7.4.2",
    revisionAfterRefresh: "scope:7.5.2",
    authoritativeTimestamp: "2026-08-28T12:00:03.000Z",
  }), "2026-08-28T12:00:03.000Z");
});

test("structural sharing never hides duplicate, deleted, added, or reordered rows", () => {
  const cached = productionShapedLedger(3);
  const duplicateReplacement = [cached[0], { ...cached[0] }, cached[2]];
  const duplicateSelection = reuseStructurallyEqualFinancialValue(
    cached,
    duplicateReplacement,
  );
  assert.notEqual(duplicateSelection, cached);
  assert.deepEqual(duplicateSelection, duplicateReplacement);

  const deletedAndAdded = [cached[0], cached[2], {
    ...cached[1],
    id: "new-row",
  }];
  assert.notEqual(
    reuseStructurallyEqualFinancialValue(cached, deletedAndAdded),
    cached,
  );

  const reordered = [cached[2], cached[1], cached[0]];
  const reorderedSelection = reuseStructurallyEqualFinancialValue(cached, reordered);
  assert.notEqual(reorderedSelection, cached);
  assert.deepEqual(
    reorderedSelection.map(row => row.id),
    reordered.map(row => row.id),
  );
  assert.equal(reorderedSelection[0], cached[2]);
});
