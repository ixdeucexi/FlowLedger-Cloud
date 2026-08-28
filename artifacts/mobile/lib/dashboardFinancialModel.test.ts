import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  DASHBOARD_DECISION_FORECAST_MONTHS,
  dashboardDecisionForecastMonthLimit,
  buildDashboardSavingsAccounts,
  buildDashboardFinancialModel,
  type DashboardAccount as Account,
  type DashboardBill as Bill,
  type DashboardConnectedBankAccount as ConnectedBankAccount,
  type DashboardDailyBalance as DailyBalance,
  type DashboardGoal as Goal,
  type DashboardIncome as IncomeItem,
  type DashboardPendingTransaction as PendingBankTransaction,
  type DashboardSettings as Settings,
  type DashboardTransaction as Transaction,
} from "./dashboardFinancialModel";
import {
  buildDashboardFinancialSnapshot,
  dashboardFinancialSnapshotKey,
  errorDashboardFinancialSnapshot,
  isDashboardFinancialSnapshotReadyForScope,
  pendingDashboardFinancialSnapshot,
  selectRecentDashboardActivity,
  sumPostedDashboardIncome,
  type DashboardFinancialSnapshotBuildInput,
  type DashboardFinancialSnapshotIdentity,
} from "./dashboardFinancialSnapshot";
import { countReviewQueue } from "./reviewCenter";

const settings: Settings = {
  zeroBasedBudgetEnabled: true,
  debtPayoffEnabled: true,
  paymentMethod: "snowball",
  starting_balance: 0,
  safety_floor: 200,
  forecast_horizon_months: 2,
  onboarding_completed: true,
};

const bill: Bill = {
  id: "rent",
  name: "Rent",
  amount: 1_000,
  category: "Housing",
  priority: 1,
  is_debt: false,
  balance: 0,
  interest_rate: 0,
  due_day: 15,
  is_recurring: true,
  frequency: "monthly",
  created_at: "2026-01-01T00:00:00.000Z",
};

const closedDebt: Bill = {
  ...bill,
  id: "closed-debt",
  name: "Tia Kohls",
  amount: 29,
  category: "Debt",
  is_debt: true,
  balance: 0,
};

const activeGoal: Goal = {
  id: "emergency",
  name: "Emergency fund",
  target_amount: 2_000,
  target_date: "2026-12-31",
  current_amount: 500,
  created_at: "2026-01-01T00:00:00.000Z",
  goal_type: "savings",
};

const closedGoal: Goal = {
  ...activeGoal,
  id: "closed",
  name: "Closed goal",
  closed_at: "2026-06-30T00:00:00.000Z",
};

const income: IncomeItem = {
  id: "salary",
  name: "Salary",
  amount: 3_000,
  frequency: "monthly",
};

const transactions: Transaction[] = [
  {
    id: "food",
    date: "2026-07-03",
    amount: -125,
    category: "Food",
    note: "Groceries",
  },
];

const balances: DailyBalance[] = [
  {
    day: 10,
    income: 3_000,
    expense: 125,
    bills: 0,
    net: 2_875,
    balance: 2_243,
  },
  {
    day: 15,
    income: 0,
    expense: 0,
    bills: 1_000,
    net: -1_000,
    balance: 1_243,
  },
];

const snapshotIdentity: DashboardFinancialSnapshotIdentity = {
  userId: "user:one",
  householdId: "household|one",
  budgetId: "budget:one",
  dataRevision: "financial:42",
  planInputRevision: "2026-07-10:budgets-3",
};

function dashboardSnapshotBuildInput(): DashboardFinancialSnapshotBuildInput {
  const snapshotTransactions: Transaction[] = [
    {
      id: "review-me",
      date: "2026-07-10",
      amount: -25,
      category: "Other",
      note: "Needs review",
      source: "plaid",
      review_status: "needs_review",
      plaid_account_id: "connected-checking",
    },
    {
      id: "posted-income",
      date: "2026-07-10",
      amount: 750,
      category: "Income",
      note: "Deposit",
      source: "plaid",
      review_status: "categorized",
      plaid_account_id: "connected-checking",
    },
  ];
  const snapshotBalances: DailyBalance[] = [
    { day: 10, income: 0, expense: 25, bills: 0, net: -25, balance: 1_975 },
    { day: 15, income: 3_000, expense: 0, bills: 1_000, net: 2_000, balance: 3_975 },
  ];
  return {
    now: new Date(2026, 6, 10, 12),
    selectedYear: 2026,
    settings,
    forecastConfidence: { level: "high", label: "High", reasons: [] },
    accounts: [],
    connectedBankAccounts: [{
      id: "connected-checking",
      plaid_account_id: "connected-checking",
      name: "Checking",
      account_type: "depository",
      account_subtype: "checking",
      current_balance: 2_000,
      is_active: true,
    }],
    pendingBankTransactions: [],
    pendingPlanMatches: [],
    categories: ["Housing", "Other"],
    categoryBudgets: { Housing: 1_000 },
    goals: [activeGoal],
    incomes: [income],
    allBills: [bill],
    allTransactions: snapshotTransactions,
    getCashFlow: () => ({
      monthlyIncome: 3_000,
      totalBillsDue: 1_000,
      totalPaid: 0,
      netTransactions: 725,
      goalAllocations: 0,
      remaining: 2_725,
    }),
    getMonthlyBills: () => [bill],
    getMonthlyIncome: () => 3_000,
    getTransactionsForMonth: () => snapshotTransactions,
    getDailyBalances: () => snapshotBalances,
    getBillMonthlyTotal: () => 1_000,
    getPaidAmount: () => 0,
    getBillOccurrencesInMonth: () => [15],
    getDebtMonthSettlements: () => new Map(),
    getRemainingDebtPlanForMonth: () => null,
  };
}

test("builds the one financial model consumed by desktop and mobile dashboards", () => {
  const accounts: Account[] = [{
    id: "manual-checking",
    name: "Manual checking",
    account_type: "checking",
    current_balance: 999,
    balance_as_of: "2026-07-10",
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
  }];
  const connectedBankAccounts: ConnectedBankAccount[] = [
    {
      id: "connected-checking",
      persistent_account_id: "bank-checking-1",
      name: "Primary checking",
      account_type: "depository",
      account_subtype: "checking",
      current_balance: 2_243,
      available_balance: 2_100,
      is_active: true,
      updated_at: "2026-07-10T12:00:00.000Z",
    },
    {
      id: "older-connected-checking",
      persistent_account_id: "bank-checking-1",
      name: "Primary checking",
      account_type: "depository",
      account_subtype: "checking",
      current_balance: 1_800,
      available_balance: 1_700,
      is_active: true,
      updated_at: "2026-07-09T12:00:00.000Z",
    },
    {
      id: "connected-savings",
      name: "Savings",
      account_type: "depository",
      account_subtype: "savings",
      current_balance: 900,
      is_active: true,
    },
  ];
  const pendingBankTransactions: PendingBankTransaction[] = [{
    plaid_transaction_id: "pending-1",
    transaction_date: "2026-07-10",
    amount: -143,
    name: "Pending charge",
    category: "Shopping",
    plaid_account_id: "connected-checking",
  }];

  const modelInput: Parameters<typeof buildDashboardFinancialModel>[0] = {
    now: new Date(2026, 6, 10, 12),
    selectedYear: 2026,
    settings,
    forecastConfidence: { level: "high", label: "High", reasons: [] },
    accounts,
    connectedBankAccounts,
    pendingBankTransactions,
    pendingPlanMatches: [],
    categories: ["Housing", "Food"],
    categoryBudgets: { Food: 500 },
    goals: [closedGoal, activeGoal],
    incomes: [income],
    cashFlow: {
      monthlyIncome: 3_000,
      totalBillsDue: 1_000,
      totalPaid: 0,
      netTransactions: -125,
      goalAllocations: 0,
      remaining: 1_875,
    },
    currentMonthBalances: balances,
    getMonthlyBills: (month) => month === 6 ? [bill, closedDebt] : [],
    getMonthlyIncome: (month) => month === 6 ? 3_000 : 0,
    getTransactionsForMonth: (month) => month === 6 ? transactions : [],
    getDailyBalances: (month) => month === 6 ? balances : [],
    getBillMonthlyTotal: () => 1_000,
    getPaidAmount: () => 0,
    getBillOccurrencesInMonth: () => [15],
  };
  const model = buildDashboardFinancialModel(modelInput);

  assert.equal(model.checkingAccountBalance, 2_243);
  assert.equal(model.bankCurrentCheckingBalance, 2_243);
  assert.equal(model.connectedCheckingAccounts.length, 1);
  assert.equal(model.savingsAccountBalance, 900);
  assert.deepEqual(model.savingsAccounts, [{
    id: "connected-savings",
    name: "Savings",
    balance: 900,
    providerName: "Savings",
    source: "connected",
  }]);
  assert.equal(model.pendingCheckingSummary?.availableBalance, 2_100);
  assert.equal(model.monthlyIncome, 3_000);
  assert.equal(model.unpaidTotal, 1_000);
  assert.equal(model.unpaidCount, 1);
  assert.deepEqual(model.monthlyBills.map((item) => item.id), ["rent"]);
  assert.deepEqual(model.currentGoals.map((goal) => goal.id), ["emergency"]);
  assert.deepEqual(model.goalTotals, { current: 500, target: 2_000 });
  assert.equal(model.goalPercent, 25);
  assert.equal(model.categoryPlan.find((row) => row.category === "Food")?.budgeted, 500);
  assert.equal(model.categoryPlan.find((row) => row.category === "Food")?.spent, 125);
  assert.ok(Number.isFinite(model.algorithmSuite.flowScore.score));

  const unavailableBankModel = buildDashboardFinancialModel({
    ...modelInput,
    connectedBankAccounts: [{
      ...connectedBankAccounts[0],
      current_balance: 0,
      current_balance_available: false,
      available_balance: undefined,
    }],
    pendingBankTransactions: [],
  });
  assert.equal(unavailableBankModel.pendingCheckingSummary, null);
  assert.equal(unavailableBankModel.checkingAccountBalance, 999);
  assert.equal(unavailableBankModel.bankCurrentCheckingBalance, 999);

  const unavailableWithoutManualModel = buildDashboardFinancialModel({
    ...modelInput,
    accounts: [],
    connectedBankAccounts: [{
      ...connectedBankAccounts[0],
      current_balance: 0,
      current_balance_available: false,
      available_balance: undefined,
    }],
    pendingBankTransactions: [],
  });
  assert.equal(unavailableWithoutManualModel.pendingCheckingSummary, null);
  assert.equal(unavailableWithoutManualModel.checkingAccountBalance, null);
  assert.equal(unavailableWithoutManualModel.bankCurrentCheckingBalance, null);
});

test("bounds Dashboard render-time forecast work independently of the full Forecast horizon", () => {
  let dailyBalanceCalls = 0;
  const dailyBalancesForMonth = (month: number, year: number): DailyBalance[] => Array.from(
    { length: new Date(year, month + 1, 0).getDate() },
    (_, index) => ({
      day: index + 1,
      income: 0,
      expense: 0,
      bills: 0,
      net: 0,
      balance: 2_000,
    }),
  );
  const januaryBalances = dailyBalancesForMonth(0, 2026);

  const modelInput: Parameters<typeof buildDashboardFinancialModel>[0] = {
    now: new Date(2026, 0, 31, 12),
    selectedYear: 2026,
    settings: { ...settings, forecast_horizon_months: 24 },
    forecastConfidence: { level: "high", label: "High", reasons: [] },
    accounts: [],
    connectedBankAccounts: [],
    pendingBankTransactions: [],
    pendingPlanMatches: [],
    categories: [],
    categoryBudgets: {},
    goals: [],
    incomes: [income],
    cashFlow: {
      monthlyIncome: 3_000,
      totalBillsDue: 0,
      totalPaid: 0,
      netTransactions: 0,
      goalAllocations: 0,
      remaining: 3_000,
    },
    currentMonthBalances: januaryBalances,
    getMonthlyBills: () => [],
    getMonthlyIncome: () => 3_000,
    getTransactionsForMonth: () => [],
    getDailyBalances: (month, year) => {
      dailyBalanceCalls += 1;
      return dailyBalancesForMonth(month, year);
    },
    getBillMonthlyTotal: () => 0,
    getPaidAmount: () => 0,
    getBillOccurrencesInMonth: () => [],
  };
  const model = buildDashboardFinancialModel(modelInput);

  assert.equal(DASHBOARD_DECISION_FORECAST_MONTHS, 3);
  assert.equal(dashboardDecisionForecastMonthLimit(24), 3);
  assert.equal(dailyBalanceCalls, 2);
  assert.ok(model.decisionForecastDays.length >= 30);
  assert.ok(Number.isFinite(model.algorithmSuite.flowScore.score));

  dailyBalanceCalls = 0;
  buildDashboardFinancialModel({
    ...modelInput,
    settings: { ...settings, forecast_horizon_months: 1 },
  });
  assert.equal(dashboardDecisionForecastMonthLimit(1), 2);
  assert.equal(dailyBalanceCalls, 1);
});

test("builds an exact-scope provider Dashboard snapshot", () => {
  let cashFlowCalls = 0;
  let dailyBalanceCalls = 0;
  const input = dashboardSnapshotBuildInput();
  const ready = buildDashboardFinancialSnapshot(snapshotIdentity, {
    ...input,
    getCashFlow: (month, year) => {
      cashFlowCalls += 1;
      return input.getCashFlow(month, year);
    },
    getDailyBalances: (month, year) => {
      dailyBalanceCalls += 1;
      return input.getDailyBalances(month, year);
    },
  });

  assert.equal(cashFlowCalls, 1);
  assert.equal(dailyBalanceCalls, 1);
  assert.equal(ready.key, dashboardFinancialSnapshotKey(snapshotIdentity));
  assert.equal(ready.value.reviewCenterCount, 1);
  assert.equal(ready.value.postedIncome, 750);
  assert.deepEqual(ready.value.categoryBudgets, { Housing: 1_000 });
  assert.ok(ready.value.model.activePendingMatchIds instanceof Set);
  assert.ok(ready.value.todayDecisions.length > 0);
  assert.ok(ready.value.desktopTodayDecisions.length > 0);
  assert.equal(ready.value.upcoming[0]?.id, bill.id);
  assert.equal(ready.value.recentActivity.length, 2);
  assert.equal(ready.value.recentActivity[0]?.id, "review-me");
  assert.equal(
    isDashboardFinancialSnapshotReadyForScope(
      ready,
      snapshotIdentity.userId,
      snapshotIdentity.householdId,
      snapshotIdentity.budgetId,
    ),
    true,
  );
  assert.equal(
    isDashboardFinancialSnapshotReadyForScope(
      ready,
      snapshotIdentity.userId,
      snapshotIdentity.householdId,
      "another-budget",
    ),
    false,
  );
});

test("Dashboard snapshot rolls December 31 into the next local year", () => {
  const base = dashboardSnapshotBuildInput();
  const requestedBillMonths: Array<[number, number]> = [];
  const december = buildDashboardFinancialSnapshot(snapshotIdentity, {
    ...base,
    now: new Date(2026, 11, 31, 12),
    selectedYear: 2026,
    goals: [],
    incomes: [],
    getMonthlyBills: (month, year) => {
      requestedBillMonths.push([month, year]);
      return [bill];
    },
    getTransactionsForMonth: () => [],
    getDailyBalances: () => [{
      day: 31,
      income: 0,
      expense: 0,
      bills: 0,
      net: 0,
      balance: 1_000,
    }],
    preparedCashFlow: base.getCashFlow(11, 2026),
    preparedCurrentMonthBalances: [{
      day: 31,
      income: 0,
      expense: 0,
      bills: 0,
      net: 0,
      balance: 1_000,
    }],
    reviewCenterCount: 0,
    postedIncome: 0,
  });

  assert.equal(december.value.model.todayIso, "2026-12-31");
  assert.ok(requestedBillMonths.some(([month, year]) => month === 0 && year === 2027));
  assert.equal(december.value.upcoming[0]?.month, 0);
  assert.equal(december.value.upcoming[0]?.year, 2027);

  const january = buildDashboardFinancialSnapshot(
    { ...snapshotIdentity, planInputRevision: "2027-01-01:budgets-3" },
    {
      ...base,
      now: new Date(2027, 0, 1, 12),
      selectedYear: 2027,
      goals: [],
      incomes: [],
      getTransactionsForMonth: () => [],
      preparedCashFlow: base.getCashFlow(0, 2027),
      preparedCurrentMonthBalances: [{
        day: 1,
        income: 0,
        expense: 0,
        bills: 0,
        net: 0,
        balance: 1_000,
      }],
      reviewCenterCount: 0,
      postedIncome: 0,
    },
  );
  assert.equal(january.value.model.todayIso, "2027-01-01");
  assert.equal(january.value.upcoming[0]?.year, 2027);
});

test("snapshot Upcoming preserves the canonical remaining debt occurrence", () => {
  const debt: Bill = {
    ...bill,
    id: "mortgage",
    name: "Mortgage",
    category: "Debt",
    is_debt: true,
    amount: 100,
    balance: 42_000,
  };
  const base = dashboardSnapshotBuildInput();
  const ready = buildDashboardFinancialSnapshot(snapshotIdentity, {
    ...base,
    settings: { ...base.settings, debtPayoffEnabled: false },
    allBills: [debt],
    getMonthlyBills: () => [debt],
    getBillMonthlyTotal: () => 100,
    getPaidAmount: () => 67.13,
    getDebtMonthSettlements: (month, year) => new Map([[debt.id, {
      configuredObligation: 100,
      paidAmount: 67.13,
      occurrences: [{
        occurrenceDate: `${year}-${String(month + 1).padStart(2, "0")}-15`,
        configuredObligation: 100,
        paidAmount: 67.13,
        remainingRequired: 32.87,
      }],
    }]]),
    getRemainingDebtPlanForMonth: () => null,
  });

  assert.equal(ready.value.upcoming[0]?.id, debt.id);
  assert.equal(ready.value.upcoming[0]?.amount, 32.87);
});

test("builds the prepared snapshot in bounded work without rescanning a production-shaped ledger", () => {
  const ambiguousLeft: DashboardFinancialSnapshotIdentity = {
    userId: "a:b",
    householdId: "c",
    budgetId: null,
    dataRevision: "d",
    planInputRevision: "e",
  };
  const ambiguousRight: DashboardFinancialSnapshotIdentity = {
    userId: "a",
    householdId: "b:c",
    budgetId: null,
    dataRevision: "d",
    planInputRevision: "e",
  };
  assert.notEqual(
    dashboardFinancialSnapshotKey(ambiguousLeft),
    dashboardFinancialSnapshotKey(ambiguousRight),
  );

  const productionLedger: Transaction[] = Array.from({ length: 20_000 }, (_, index) => ({
    id: `transaction-${index}`,
    date: `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
    amount: index % 2 ? -19.95 : 2_500,
    category: index % 2 ? "Spending" : "Income",
    note: `Ledger item ${index}`,
    source: "plaid",
    review_status: index % 19 === 0 ? "needs_review" : "categorized",
    plaid_account_id: "connected-checking",
  }));
  let ledgerReads = 0;
  const trappedLedger: Transaction[] = new Proxy(productionLedger, {
    get(target, property, receiver) {
      ledgerReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const base = dashboardSnapshotBuildInput();
  const calls = {
    cashFlow: 0,
    dailyBalances: 0,
    debtSettlements: 0,
    debtPlan: 0,
    monthlyBills: 0,
  };
  const startedAt = performance.now();
  const ready = buildDashboardFinancialSnapshot(snapshotIdentity, {
    ...base,
    allTransactions: trappedLedger,
    // These values are prepared in separate provider stages. The atomic final
    // snapshot stage must not walk the full ledger again.
    reviewCenterCount: 1_053,
    postedIncome: 25_000_000,
    preparedCashFlow: base.getCashFlow(6, 2026),
    preparedCurrentMonthBalances: base.getDailyBalances(6, 2026),
    getCashFlow: (month, year) => {
      calls.cashFlow += 1;
      return base.getCashFlow(month, year);
    },
    getDailyBalances: (month, year) => {
      calls.dailyBalances += 1;
      return base.getDailyBalances(month, year);
    },
    getDebtMonthSettlements: (month, year) => {
      calls.debtSettlements += 1;
      return base.getDebtMonthSettlements?.(month, year) ?? new Map();
    },
    getRemainingDebtPlanForMonth: (month, year) => {
      calls.debtPlan += 1;
      return base.getRemainingDebtPlanForMonth(month, year);
    },
    getMonthlyBills: (month, year) => {
      calls.monthlyBills += 1;
      return base.getMonthlyBills(month, year);
    },
  });
  const elapsed = performance.now() - startedAt;

  assert.equal(ledgerReads, 0);
  assert.equal(ready.value.reviewCenterCount, 1_053);
  assert.equal(ready.value.postedIncome, 25_000_000);
  assert.deepEqual(calls, {
    cashFlow: 0,
    dailyBalances: 0,
    debtSettlements: 3,
    debtPlan: 2,
    monthlyBills: 3,
  });
  assert.ok(elapsed < 500, `prepared snapshot build took ${elapsed.toFixed(1)}ms`);

  const pending = pendingDashboardFinancialSnapshot(snapshotIdentity);
  assert.equal(
    isDashboardFinancialSnapshotReadyForScope(
      pending,
      snapshotIdentity.userId,
      snapshotIdentity.householdId,
      snapshotIdentity.budgetId,
    ),
    false,
  );
  assert.equal(
    isDashboardFinancialSnapshotReadyForScope(
      errorDashboardFinancialSnapshot(snapshotIdentity, "retry"),
      snapshotIdentity.userId,
      snapshotIdentity.householdId,
      snapshotIdentity.budgetId,
    ),
    false,
  );
});

test("cold final snapshot build stays bounded with 20k current-month rows", (context) => {
  const denseCurrentMonth: Transaction[] = Array.from(
    { length: 20_000 },
    (_, index) => ({
      id: `dense-current-${index}`,
      date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
      amount: index % 5 === 0 ? 2_500 : -19.95,
      category: index % 5 === 0 ? "Income" : index % 2 ? "Food" : "Other",
      note: `Current month row ${index}`,
      source: "plaid",
      review_status: "needs_review",
      plaid_account_id: "connected-checking",
    }),
  );
  const base = dashboardSnapshotBuildInput();
  const reviewStartedAt = performance.now();
  const preparedReviewCenterCount = countReviewQueue(
    denseCurrentMonth,
    "2026-07-10",
  );
  const reviewElapsed = performance.now() - reviewStartedAt;
  const postedStartedAt = performance.now();
  const preparedPostedIncome = sumPostedDashboardIncome(
    denseCurrentMonth,
    base.connectedBankAccounts,
  );
  const postedElapsed = performance.now() - postedStartedAt;
  const recentStartedAt = performance.now();
  const preparedRecentActivity = selectRecentDashboardActivity(denseCurrentMonth);
  const recentElapsed = performance.now() - recentStartedAt;
  const startedAt = performance.now();
  const ready = buildDashboardFinancialSnapshot(snapshotIdentity, {
    ...base,
    allTransactions: denseCurrentMonth,
    getTransactionsForMonth: (month, year) => (
      month === 6 && year === 2026 ? denseCurrentMonth : []
    ),
    preparedCashFlow: base.getCashFlow(6, 2026),
    preparedCurrentMonthBalances: base.getDailyBalances(6, 2026),
    reviewCenterCount: preparedReviewCenterCount,
    postedIncome: preparedPostedIncome,
    recentActivity: preparedRecentActivity,
  });
  const elapsed = performance.now() - startedAt;

  assert.equal(ready.value.model.monthTransactions.length, 20_000);
  assert.equal(ready.value.recentActivity.length, 4);
  assert.equal(ready.value.reviewCenterCount, 20_000);
  assert.equal(ready.value.postedIncome, 10_000_000);
  assert.ok(
    reviewElapsed < 50,
    `cold 20k review stage took ${reviewElapsed.toFixed(1)}ms`,
  );
  assert.ok(
    postedElapsed < 50,
    `cold 20k posted-income stage took ${postedElapsed.toFixed(1)}ms`,
  );
  assert.ok(
    recentElapsed < 50,
    `cold 20k recent selector took ${recentElapsed.toFixed(1)}ms`,
  );
  assert.ok(
    elapsed < 50,
    `cold 20k current-month snapshot took ${elapsed.toFixed(1)}ms`,
  );
  context.diagnostic(
    `cold 20k stages: review=${reviewElapsed.toFixed(1)}ms, posted=${postedElapsed.toFixed(1)}ms, recent=${recentElapsed.toFixed(1)}ms, final=${elapsed.toFixed(1)}ms`,
  );
});

test("recent Dashboard activity is newest-first, stable, and excludes deleted rows", () => {
  const rows: Transaction[] = [
    { id: "same-a", date: "2026-08-28", amount: -1, category: "Other", note: "A" },
    { id: "old", date: "2026-08-01", amount: -1, category: "Other", note: "Old" },
    { id: "deleted", date: "2026-08-31", amount: -1, category: "Other", note: "Deleted", deleted_at: "2026-08-31T12:00:00.000Z" },
    { id: "same-b", date: "2026-08-28", amount: -1, category: "Other", note: "B" },
    { id: "new", date: "2026-08-30", amount: -1, category: "Other", note: "New" },
    { id: "middle", date: "2026-08-15", amount: -1, category: "Other", note: "Middle" },
  ];

  assert.deepEqual(
    selectRecentDashboardActivity(rows).map(transaction => transaction.id),
    ["new", "same-a", "same-b", "middle"],
  );
});

test("mobile Dashboard render consumes only a ready snapshot and never runs financial projection", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const contentStart = mobileDashboard.indexOf("function MobileDashboardContent");
  const contentEnd = mobileDashboard.indexOf("function ZeroBudgetStat", contentStart);
  const content = mobileDashboard.slice(contentStart, contentEnd);
  const outlookStart = content.indexOf("// ── 12-month negative schedule");
  const outlookEnd = content.indexOf("// First month (across all 12)", outlookStart);
  const renderWithoutExplicitOutlook = `${content.slice(0, outlookStart)}${content.slice(outlookEnd)}`;
  const pendingStage = readFileSync(
    "components/DashboardSnapshotStage.tsx",
    "utf8",
  );

  for (const forbidden of [
    /getCashFlow\(/,
    /getDailyBalances\(/,
    /getDebtMonthSettlements\(/,
    /getRemainingDebtPlanForMonth\(/,
    /buildDashboardFinancialModel\(/,
    /buildAlgorithmSuite\(/,
    /buildReviewQueue\(/,
    /countReviewQueue\(/,
  ]) {
    assert.doesNotMatch(renderWithoutExplicitOutlook, forbidden);
  }
  assert.doesNotMatch(mobileDashboard, /import \{[^}]*buildDashboardFinancialModel/);
  assert.doesNotMatch(mobileDashboard, /subscribeCategoryBudgets/);
  assert.match(mobileDashboard, /dashboardFinancialSnapshot/);
  assert.match(mobileDashboard, /isDashboardFinancialSnapshotReadyForScope/);
  assert.match(mobileDashboard, /householdId,[\s\S]*budgetId,/);
  assert.match(mobileDashboard, /model: dashboardModel/);

  assert.match(pendingStage, /pointerEvents="box-none"/);
  assert.match(pendingStage, /Preparing today's plan/);
  assert.match(pendingStage, /\/\(tabs\)\/monthly/);
  assert.match(pendingStage, /\/\(tabs\)\/transactions/);
  assert.match(
    pendingStage,
    /style=\{styles\.status\}[\s\S]*?accessibilityLiveRegion="polite"|accessibilityLiveRegion="polite"[\s\S]*?style=\{styles\.status\}/,
  );
  assert.match(
    pendingStage,
    /<\/View>\s*\{failed && onRetry \? \(\s*<Pressable\s+accessibilityRole="button"/,
  );
  assert.doesNotMatch(pendingStage, /<Modal|AppLoadingIntro|position:\s*"absolute"/);
});

test("both Dashboard render paths are projection-free and keep pending navigation interactive", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const desktopDashboard = readFileSync(
    "components/desktop/DesktopDashboard.tsx",
    "utf8",
  );
  const stage = readFileSync("components/DashboardSnapshotStage.tsx", "utf8");

  for (const source of [mobileDashboard, desktopDashboard]) {
    for (const forbidden of [
      /getCashFlow\(/,
      /getDebtMonthSettlements\(/,
      /getRemainingDebtPlanForMonth\(/,
      /buildDashboardFinancialModel\(/,
      /buildAlgorithmSuite\(/,
      /buildReviewQueue\(/,
      /countReviewQueue\(/,
    ]) {
      assert.doesNotMatch(source, forbidden);
    }
    assert.match(source, /isDashboardFinancialSnapshotReadyForScope/);
    assert.match(source, /dashboardFinancialSnapshot/);
    assert.match(source, /useDashboardFinancialSnapshot/);
    assert.match(source, /budgetId/);
  }
  // Mobile's only daily projection is the explicitly opened outlook effect;
  // Desktop has no projection getter at all.
  assert.doesNotMatch(desktopDashboard, /getDailyBalances\(/);
  assert.match(stage, /pointerEvents="box-none"/);
  assert.match(stage, /router\.push\("\/\(tabs\)\/monthly"/);
  assert.match(stage, /router\.push\("\/\(tabs\)\/transactions"/);
  assert.doesNotMatch(stage, /<Modal|pointerEvents="none"/);
});

test("ready mobile and lazy desktop content acknowledge their exact snapshot mount", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const desktopDashboard = readFileSync(
    "components/desktop/DesktopDashboard.tsx",
    "utf8",
  );

  for (const source of [mobileDashboard, desktopDashboard]) {
    assert.match(source, /acknowledgeDashboardSnapshotContentMounted/);
    assert.match(source, /snapshotKey=\{dashboardFinancialSnapshot\.key\}/);
    assert.match(
      source,
      /useEffect\(\s*\(\) => acknowledgeMounted\(snapshotKey\),\s*\[acknowledgeMounted, snapshotKey\],\s*\)/,
    );
    assert.match(
      source,
      /snapshotKey=\{exactScopeError \? dashboardFinancialSnapshot\.key : undefined\}/,
    );
  }
  const stage = readFileSync("components/DashboardSnapshotStage.tsx", "utf8");
  assert.match(
    stage,
    /if \(!acknowledgeMounted \|\| !snapshotKey\) return undefined;[\s\S]*return acknowledgeMounted\(snapshotKey\)/,
  );
  const lazyImport = mobileDashboard.indexOf("const DesktopDashboard = React.lazy");
  const desktopFallback = mobileDashboard.indexOf("<React.Suspense", lazyImport);
  assert.ok(lazyImport >= 0 && desktopFallback > lazyImport);
  assert.match(desktopDashboard, /function DesktopDashboardContent/);
});

test("snapshot publication is isolated from non-Dashboard Budget consumers", () => {
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const snapshotContext = readFileSync(
    "context/DashboardFinancialSnapshotContext.tsx",
    "utf8",
  );
  const controllerStart = budgetContext.indexOf(
    "function DashboardFinancialSnapshotController",
  );
  const providerValueStart = budgetContext.indexOf(
    "const budgetContextValue: BudgetContextType",
  );
  const providerReturn = budgetContext.slice(providerValueStart, controllerStart);
  const controller = budgetContext.slice(controllerStart);

  assert.ok(providerValueStart > 0 && controllerStart > providerValueStart);
  assert.doesNotMatch(providerReturn, /dashboardFinancialSnapshot\s*[,}]/);
  assert.doesNotMatch(providerReturn, /setComputedSnapshot|setLoadedCategoryBudgets/);
  assert.match(providerReturn, /<BudgetContext\.Provider value=\{budgetContextValue\}>/);
  assert.match(providerReturn, /<DashboardFinancialSnapshotController/);
  assert.match(controller, /useState<DashboardFinancialSnapshotState \| null>/);
  assert.match(controller, /<DashboardFinancialSnapshotContextProvider/);
  assert.match(snapshotContext, /export function useDashboardFinancialSnapshot/);
});

test("hidden Dashboard editors and sheets do not mount on the ready first frame", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const desktopDashboard = readFileSync(
    "components/desktop/DesktopDashboard.tsx",
    "utf8",
  );

  for (const conditional of [
    /\{customizerOpen \? <DashboardCustomizer/,
    /\{addBillVisible \? <AddBillModal/,
    /\{goalModalVisible \? <GoalModal/,
    /\{savingsAccountNameTarget \? <SavingsAccountNameModal/,
    /\{flowScoreVisible \? <Modal/,
    /\{safeCushionVisible \? <Modal/,
    /\{actionModalVisible \? <Modal/,
    /\{categoryBudgetModalVisible \? <Modal/,
    /\{moveMoneyVisible \? <Modal/,
    /\{negCalendarVisible \? <Modal/,
  ]) {
    assert.match(mobileDashboard, conditional);
  }
  for (const conditional of [
    /\{customizerOpen \? <DashboardCustomizer/,
    /\{billEditor !== null \? <AddBillModal/,
    /\{incomeEditorOpen \? <IncomeModal/,
    /\{goalEditor !== undefined \? <GoalModal/,
  ]) {
    assert.match(desktopDashboard, conditional);
  }
});

test("defers the full outlook on every mobile-responsive width until explicit open", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const outlookEffect = mobileDashboard.slice(
    mobileDashboard.indexOf("// ── 12-month negative schedule"),
    mobileDashboard.indexOf("// First month (across all 12)"),
  );

  assert.match(outlookEffect, /if \(!isFocused \|\| !negCalendarVisible\) return;/);
  assert.doesNotMatch(outlookEffect, /isCommandWide/);
  assert.match(outlookEffect, /nextSchedule\.push\(next\)/);
  assert.match(outlookEffect, /i < settings\.forecast_horizon_months/);
  assert.match(outlookEffect, /setYearNegSchedule\(nextSchedule\)/);
  assert.doesNotMatch(outlookEffect, /setYearNegSchedule\(previous =>/);

  assert.match(mobileDashboard, /accessibilityRole="progressbar"/);
  assert.match(mobileDashboard, /accessibilityLabel="Building the breathing room outlook"/);
  assert.match(mobileDashboard, /Building outlook\.\.\./);
  assert.match(mobileDashboard, /accessibilityLabel="Open the breathing room outlook"/);
  assert.match(mobileDashboard, /tap to calculate/);
});

test("dashboard treats rollover as planned extra without raising the required or overdue amount", () => {
  const debt: Bill = {
    ...bill,
    id: "active-card",
    name: "Active Card",
    amount: 85,
    category: "Debt",
    is_debt: true,
    balance: 1_000,
    due_day: 15,
    snowball_minimum_boost: 29,
  };
  const model = buildDashboardFinancialModel({
    now: new Date(2026, 7, 16, 12),
    selectedYear: 2026,
    settings,
    forecastConfidence: { level: "high", label: "High", reasons: [] },
    accounts: [],
    connectedBankAccounts: [],
    pendingBankTransactions: [],
    pendingPlanMatches: [],
    categories: ["Debt"],
    categoryBudgets: {},
    goals: [],
    incomes: [],
    cashFlow: {
      monthlyIncome: 0,
      totalBillsDue: 114,
      totalPaid: 85,
      netTransactions: 0,
      goalAllocations: 0,
      remaining: -29,
    },
    currentMonthBalances: [{
      day: 16,
      income: 0,
      expense: 0,
      bills: 29,
      net: -29,
      balance: 500,
    }],
    getMonthlyBills: month => month === 7 ? [debt] : [],
    getMonthlyIncome: () => 0,
    getTransactionsForMonth: () => [],
    getDailyBalances: month => month === 7 ? [{
      day: 16,
      income: 0,
      expense: 0,
      bills: 29,
      net: -29,
      balance: 500,
    }] : [],
    getBillMonthlyTotal: () => 114,
    getPaidAmount: () => 85,
    getBillOccurrencesInMonth: () => [15],
  });

  assert.equal(model.algorithmSuite.flowScore.requiredAmountDue, 85);
  assert.equal(model.algorithmSuite.flowScore.requiredAmountCovered, 85);
  assert.equal(model.unpaidTotal, 29);
  assert.ok(model.algorithmSuite.flowScore.negativeFactors.every(factor => !/overdue bill/i.test(factor)));
});

test("lists each canonical savings account once and uses manual savings as a fallback", () => {
  const manualSavings: Account[] = [{
    id: "manual-savings",
    name: "Rainy day",
    account_type: "savings",
    current_balance: 250,
    balance_as_of: "2026-07-10",
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
  }];
  const connectedSavings: ConnectedBankAccount[] = [
    {
      id: "current-savings",
      persistent_account_id: "bank-savings-1",
      name: "Emergency savings",
      display_name: "House fund",
      mask: "4321",
      account_subtype: "savings",
      current_balance: 900,
      is_active: true,
      updated_at: "2026-07-10T12:00:00.000Z",
    },
    {
      id: "reconnected-savings",
      persistent_account_id: "bank-savings-1",
      name: "Emergency savings",
      mask: "4321",
      account_subtype: "savings",
      current_balance: 850,
      is_active: true,
      updated_at: "2026-07-09T12:00:00.000Z",
    },
  ];

  assert.deepEqual(buildDashboardSavingsAccounts(manualSavings, connectedSavings), [{
    id: "current-savings",
    name: "House fund",
    balance: 900,
    mask: "4321",
    providerName: "Emergency savings",
    source: "connected",
  }]);
  assert.deepEqual(buildDashboardSavingsAccounts(manualSavings, []), [{
    id: "manual-savings",
    name: "Rainy day",
    balance: 250,
    source: "manual",
  }]);
});

test("keeps both Dashboard presentations on the provider snapshot", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const desktopDashboard = readFileSync(
    "components/desktop/DesktopDashboard.tsx",
    "utf8",
  );

  for (const source of [mobileDashboard, desktopDashboard]) {
    assert.doesNotMatch(source, /import \{ buildAlgorithmSuite/);
    assert.doesNotMatch(source, /connectedCheckingBalance\(/);
  }
  assert.doesNotMatch(mobileDashboard, /buildDashboardFinancialModel\(/);
  assert.doesNotMatch(desktopDashboard, /buildDashboardFinancialModel\(/);
  assert.match(mobileDashboard, /dashboardFinancialSnapshot/);
  assert.match(desktopDashboard, /dashboardFinancialSnapshot/);
  assert.match(desktopDashboard, /desktopTodayDecisions: todayDecisions/);
  assert.match(desktopDashboard, /upcoming,/);
  assert.match(desktopDashboard, /recentActivity,/);
  assert.doesNotMatch(desktopDashboard, /monthTransactions[\s\S]{0,160}\.sort\(/);
});

test("desktop Upcoming uses canonical debt occurrences when the payoff planner is disabled", () => {
  const desktopDashboard = readFileSync(
    "components/desktop/DesktopDashboard.tsx",
    "utf8",
  );
  const snapshotBuilder = readFileSync(
    "lib/dashboardFinancialSnapshot.ts",
    "utf8",
  );

  assert.match(desktopDashboard, /dashboardSnapshot[\s\S]*upcoming,/);
  assert.doesNotMatch(desktopDashboard, /getDebtMonthSettlements\(/);
  assert.match(snapshotBuilder, /buildDashboardUpcomingBills/);
  assert.match(snapshotBuilder, /exactDebtOccurrence\?\.configuredObligation/);
  assert.match(snapshotBuilder, /exactDebtOccurrence\?\.remainingRequired/);
  assert.match(snapshotBuilder, /getDebtMonthSettlements\?\.\(month, year\)/);
});

test("both dashboards resume the same canonical setup walkthrough", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const desktopDashboard = readFileSync("components/desktop/DesktopDashboard.tsx", "utf8");

  for (const source of [mobileDashboard, desktopDashboard]) {
    assert.match(source, /useSetupReadiness\(\)/);
    assert.match(source, /Continue setup with Flo/);
    assert.match(source, /router\.push\("\/setup"|go\("\/setup"/);
  }
  assert.doesNotMatch(mobileDashboard, /onboarding_completed: true/);
});

test("the flipped savings card lists canonical accounts and exposes the naming editor", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");

  assert.match(mobileDashboard, /savingsAccounts\.map/);
  assert.match(mobileDashboard, /SavingsAccountNameModal/);
  assert.match(mobileDashboard, /updateConnectedBankAccountDisplayName/);
  assert.match(mobileDashboard, /canEditHousehold \?/);
});

test("the dashboard flip keeps Flow Score on the animated checking face", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const checkingFace = mobileDashboard.indexOf('pointerEvents={flipped ? "none" : "auto"}');
  const checkingCard = mobileDashboard.indexOf("styles.referenceCommandHero,", checkingFace);
  const scorePanel = mobileDashboard.indexOf("styles.referenceScorePanel", checkingFace);
  const savingsFace = mobileDashboard.indexOf('pointerEvents={flipped ? "auto" : "none"}', checkingFace);
  const savingsCard = mobileDashboard.indexOf("styles.referenceCommandHero,", savingsFace);

  assert.ok(checkingFace >= 0);
  assert.ok(checkingCard > checkingFace);
  assert.ok(scorePanel > checkingFace);
  assert.ok(scorePanel < savingsFace);
  assert.ok(savingsCard > savingsFace);
  assert.match(mobileDashboard, /styles\.referenceCommandHeroBackFace/);
  assert.match(mobileDashboard, /heroBackCardHeight/);
});

test("the dashboard and review center link to the existing spending bucket manager", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const more = readFileSync("app/(tabs)/more.tsx", "utf8");
  const reviewCenter = readFileSync("components/ReviewCenter.tsx", "utf8");

  assert.match(mobileDashboard, /label: "Spending Buckets"/);
  assert.match(mobileDashboard, /section: "review"/);
  assert.match(more, /onManageBuckets=\{scrollToBucketManager\}/);
  assert.match(more, /scrollTo\(\{ y: 0, animated: true \}\)/);
  assert.match(reviewCenter, /accessibilityLabel="Manage spending buckets"/);
});

test("uses one Plaid connection action and keeps syncing separate", () => {
  const plaidConnections = readFileSync("components/PlaidLinkButton.web.tsx", "utf8");
  const plaidOAuthResume = readFileSync("components/PlaidOAuthResume.web.tsx", "utf8");
  const desktopDashboard = readFileSync("components/desktop/DesktopDashboard.tsx", "utf8");

  assert.match(plaidConnections, /Connect account/);
  assert.match(plaidConnections, /connect\("bank"\)/);
  assert.match(plaidConnections, /Sync accounts/);
  assert.doesNotMatch(plaidConnections, /Add credit card/);
  assert.doesNotMatch(plaidConnections, /Add bank account/);
  assert.match(plaidConnections, /Attach to an existing debt/);
  assert.match(plaidConnections, /Create new Debt &amp; Snowball account/);
  assert.match(plaidConnections, /api\/plaid\/attach-credit-card/);
  assert.match(plaidConnections, /value == null[^\n]+Balance unavailable/);
  assert.match(plaidConnections, /OPEN_OAUTH/);
  assert.match(plaidConnections, /markPlaidOAuthAwaitingReturn/);
  assert.match(plaidOAuthResume, /receivedRedirectUri/);
  assert.match(plaidOAuthResume, /readPendingPlaidOAuthSession/);
  assert.match(plaidOAuthResume, /addEventListener\("focus"/);
  assert.match(plaidOAuthResume, /exchange-public-token/);
  assert.match(desktopDashboard, /Connections/);
  assert.match(desktopDashboard, /section: "plaid"/);
});

test("desktop dashboard presents the debt payoff planner as a first-class card", () => {
  const desktopDashboard = readFileSync("components/desktop/DesktopDashboard.tsx", "utf8");

  assert.match(desktopDashboard, /Debt Payoff Planner/);
  assert.match(desktopDashboard, /accessibilityLabel="Open Debt Payoff Planner"/);
  assert.match(desktopDashboard, /onPress=\{\(\) => go\("\/snowball-plan"\)\}/);
  assert.match(desktopDashboard, /CURRENT TARGET/);
});

test("activity surfaces use Inflows and Outflows wording across layouts", () => {
  const activitySources = [
    readFileSync("app/(tabs)/transactions.tsx", "utf8"),
    readFileSync("components/ReportsInsightsView.tsx", "utf8"),
    readFileSync("components/ReviewCenter.tsx", "utf8"),
    readFileSync("components/desktop/DesktopWorkspacePage.tsx", "utf8"),
  ];

  for (const source of activitySources) {
    assert.doesNotMatch(source, /Money in|Money out/);
  }
  assert.match(activitySources[0], /label: "Inflows"/);
  assert.match(activitySources[0], /label: "Outflows"/);
});
