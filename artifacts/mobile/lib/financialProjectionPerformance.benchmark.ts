import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  buildDashboardFinancialSnapshot,
  selectRecentDashboardActivity,
  sumPostedDashboardIncome,
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
  indexRecordsByMonth,
  reuseStructurallyEqualFinancialValue,
} from "./financialProjectionCache";
import { buildTransactionLedger } from "./ledgerEngine";
import { countReviewQueue } from "./reviewCenter";

const PERFORMANCE_BUDGET_MS = 50;
const REPETITIONS = 5;

function measure(work: () => void): number {
  const startedAt = performance.now();
  work();
  return performance.now() - startedAt;
}

function measureMax(work: () => void, repetitions = REPETITIONS): number {
  let max = 0;
  for (let index = 0; index < repetitions; index += 1) {
    max = Math.max(max, measure(work));
  }
  return max;
}

function measureColdAndRepeated(work: () => void) {
  const cold = measure(work);
  const repeatedMax = measureMax(work);
  return { cold, repeatedMax, max: Math.max(cold, repeatedMax) };
}

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
      review_status: matched
        ? "matched"
        : index % 31 === 0
          ? "needs_review"
          : "categorized",
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

function snapshotInput(
  transactions: DashboardTransaction[],
): DashboardFinancialSnapshotBuildInput {
  const balances: DashboardDailyBalance[] = Array.from(
    { length: 31 },
    (_, index) => ({
      day: index + 1,
      income: 0,
      expense: 0,
      bills: 0,
      net: 0,
      balance: 2_000,
    }),
  );
  return {
    now: new Date(2026, 6, 10, 12),
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
    connectedBankAccounts: [{
      id: "checking-1",
      plaid_account_id: "checking-1",
      name: "Checking",
      account_type: "depository",
      account_subtype: "checking",
      current_balance: 2_000,
      is_active: true,
    }],
    pendingBankTransactions: [],
    pendingPlanMatches: [],
    categories: [],
    categoryBudgets: {},
    goals: [],
    incomes: [],
    allBills: [],
    allTransactions: transactions,
    getCashFlow: () => ({
      monthlyIncome: 0,
      totalBillsDue: 0,
      totalPaid: 0,
      netTransactions: 0,
      goalAllocations: 0,
      remaining: 0,
    }),
    getMonthlyBills: () => [],
    getMonthlyIncome: () => 0,
    getTransactionsForMonth: (month, year) => (
      month === 6 && year === 2026 ? transactions : []
    ),
    getDailyBalances: () => balances,
    getBillMonthlyTotal: () => 0,
    getPaidAmount: () => 0,
    getBillOccurrencesInMonth: () => [],
    getDebtMonthSettlements: () => new Map(),
    getRemainingDebtPlanForMonth: () => ({ allocations: [] }),
  };
}

const snapshotIdentity: DashboardFinancialSnapshotIdentity = {
  userId: "performance-user",
  householdId: "performance-household",
  budgetId: "performance-budget",
  dataRevision: "financial-42",
  planInputRevision: "2026-07-10",
};

test("isolated 20k provider preparation stays below one input task", context => {
  const ledger = productionShapedLedger();
  const connectedAccounts = [{
    plaid_account_id: "checking-1",
    account_type: "depository",
    account_subtype: "checking",
  }];
  let visibleTransactionIds = new Set<string>();
  const prepare = () => {
    const transactionLedger = buildTransactionLedger(
      ledger,
      ledger,
      connectedAccounts,
    );
    indexRecordsByMonth(ledger);
    indexRecordsByMonth(ledger);
    visibleTransactionIds = new Set(
      transactionLedger.visibleTransactions.map(transaction => transaction.id),
    );
    assert.ok(transactionLedger.cashTransactionsByMonth.size > 0);
    assert.ok(transactionLedger.visibleCheckingTransactionsByDate.size > 0);
    buildMatchedFinancialAllocationIndexes(ledger);
    countReviewQueue(ledger, "2026-12-15");
  };

  const coldMs = measure(prepare);
  const repeatedMaxMs = measureMax(prepare);
  const projectionMaxMs = measureMax(() => {
    buildFinancialProjectionIndexes({
      transactions: ledger,
      forecastTransactions: ledger,
      visibleTransactions: ledger,
      commitments: ledger,
    });
  });

  assert.equal(visibleTransactionIds.size, ledger.length);

  assert.ok(
    coldMs < PERFORMANCE_BUDGET_MS,
    `cold combined 20k preparation took ${coldMs.toFixed(1)}ms`,
  );
  assert.ok(
    repeatedMaxMs < PERFORMANCE_BUDGET_MS,
    `combined 20k preparation max-of-${REPETITIONS} took ${repeatedMaxMs.toFixed(1)}ms`,
  );
  assert.ok(
    projectionMaxMs < PERFORMANCE_BUDGET_MS,
    `20k projection indexes max-of-${REPETITIONS} took ${projectionMaxMs.toFixed(1)}ms`,
  );
  context.diagnostic(
    `isolated 20k provider prep: cold=${coldMs.toFixed(1)}ms, repeated-max=${repeatedMaxMs.toFixed(1)}ms, projection-max=${projectionMaxMs.toFixed(1)}ms`,
  );
});

test("isolated 20k cache-to-live equality stays below one input task", context => {
  const cached = productionShapedLedger();
  const live: DashboardTransaction[] = cached.map(transaction => ({
    ...transaction,
    review_allocations: transaction.review_allocations?.map(allocation => ({
      ...allocation,
    })),
  }));
  let selected: DashboardTransaction[] = live;
  const equalityTiming = measureColdAndRepeated(() => {
    selected = reuseStructurallyEqualFinancialValue(cached, live);
  });

  assert.equal(selected, cached);
  assert.ok(
    equalityTiming.max < PERFORMANCE_BUDGET_MS,
    `20k cache-to-live equality took ${equalityTiming.cold.toFixed(1)}ms cold/${equalityTiming.repeatedMax.toFixed(1)}ms max-of-${REPETITIONS}`,
  );
  context.diagnostic(
    `isolated 20k cache-to-live equality cold=${equalityTiming.cold.toFixed(1)}ms, repeated-max=${equalityTiming.repeatedMax.toFixed(1)}ms`,
  );
});

test("isolated dense Dashboard stages each stay below one input task", context => {
  const denseCurrentMonth: DashboardTransaction[] = Array.from(
    { length: 20_000 },
    (_, index) => ({
      id: `dense-current-${index}`,
      date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
      amount: index % 5 === 0 ? 2_500 : -19.95,
      category: index % 5 === 0 ? "Income" : index % 2 ? "Food" : "Other",
      note: `Current month row ${index}`,
      source: "plaid",
      review_status: "needs_review",
      plaid_account_id: "checking-1",
    }),
  );
  const base = snapshotInput(denseCurrentMonth);
  let reviewCenterCount = 0;
  let postedIncome = 0;
  let recentActivity: DashboardTransaction[] = [];
  const reviewTiming = measureColdAndRepeated(() => {
    reviewCenterCount = countReviewQueue(denseCurrentMonth, "2026-07-10");
  });
  const postedTiming = measureColdAndRepeated(() => {
    postedIncome = sumPostedDashboardIncome(
      denseCurrentMonth,
      base.connectedBankAccounts,
    );
  });
  const recentTiming = measureColdAndRepeated(() => {
    recentActivity = selectRecentDashboardActivity(denseCurrentMonth);
  });
  const publishInput = {
    ...base,
    preparedCashFlow: base.getCashFlow(6, 2026),
    preparedCurrentMonthBalances: base.getDailyBalances(6, 2026),
    reviewCenterCount,
    postedIncome,
    recentActivity,
  };
  const publishStartedAt = performance.now();
  let snapshot = buildDashboardFinancialSnapshot(snapshotIdentity, publishInput);
  const publishColdMs = performance.now() - publishStartedAt;
  const publishRepeatedMaxMs = measureMax(() => {
    snapshot = buildDashboardFinancialSnapshot(snapshotIdentity, publishInput);
  });
  const publishTiming = {
    cold: publishColdMs,
    repeatedMax: publishRepeatedMaxMs,
    max: Math.max(publishColdMs, publishRepeatedMaxMs),
  };

  assert.equal(snapshot.value.model.monthTransactions.length, 20_000);
  assert.equal(snapshot.value.recentActivity.length, 4);
  assert.equal(reviewCenterCount, 20_000);
  assert.equal(postedIncome, 10_000_000);
  const stages = {
    review: reviewTiming,
    posted: postedTiming,
    recent: recentTiming,
    publish: publishTiming,
  };
  Object.entries(stages).forEach(([stage, timing]) => {
    assert.ok(
      timing.max < PERFORMANCE_BUDGET_MS,
      `dense 20k ${stage} took ${timing.cold.toFixed(1)}ms cold/${timing.repeatedMax.toFixed(1)}ms max-of-${REPETITIONS}`,
    );
  });
  context.diagnostic(
    `isolated dense 20k cold/repeated-max: review=${reviewTiming.cold.toFixed(1)}/${reviewTiming.repeatedMax.toFixed(1)}ms, posted=${postedTiming.cold.toFixed(1)}/${postedTiming.repeatedMax.toFixed(1)}ms, recent=${recentTiming.cold.toFixed(1)}/${recentTiming.repeatedMax.toFixed(1)}ms, publish=${publishTiming.cold.toFixed(1)}/${publishTiming.repeatedMax.toFixed(1)}ms`,
  );
});
