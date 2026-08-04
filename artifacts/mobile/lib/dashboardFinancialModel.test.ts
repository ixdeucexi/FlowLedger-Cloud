import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
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
      name: "Primary checking",
      account_type: "depository",
      account_subtype: "checking",
      current_balance: 2_243,
      available_balance: 2_100,
      is_active: true,
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

  const model = buildDashboardFinancialModel({
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
    getMonthlyBills: (month) => month === 6 ? [bill] : [],
    getMonthlyIncome: (month) => month === 6 ? 3_000 : 0,
    getTransactionsForMonth: (month) => month === 6 ? transactions : [],
    getDailyBalances: (month) => month === 6 ? balances : [],
    getBillMonthlyTotal: () => 1_000,
    getPaidAmount: () => 0,
    getBillOccurrencesInMonth: () => [15],
  });

  assert.equal(model.checkingAccountBalance, 2_243);
  assert.equal(model.savingsAccountBalance, 900);
  assert.equal(model.pendingCheckingSummary?.availableBalance, 2_100);
  assert.equal(model.monthlyIncome, 3_000);
  assert.equal(model.unpaidTotal, 1_000);
  assert.equal(model.unpaidCount, 1);
  assert.deepEqual(model.currentGoals.map((goal) => goal.id), ["emergency"]);
  assert.deepEqual(model.goalTotals, { current: 500, target: 2_000 });
  assert.equal(model.goalPercent, 25);
  assert.equal(model.categoryPlan.find((row) => row.category === "Food")?.budgeted, 500);
  assert.equal(model.categoryPlan.find((row) => row.category === "Food")?.spent, 125);
  assert.ok(Number.isFinite(model.algorithmSuite.flowScore.score));
});

test("keeps both dashboard presentations on the shared calculation model", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const desktopDashboard = readFileSync(
    "components/desktop/DesktopDashboard.tsx",
    "utf8",
  );

  for (const source of [mobileDashboard, desktopDashboard]) {
    assert.match(source, /buildDashboardFinancialModel\(/);
    assert.doesNotMatch(source, /import \{ buildAlgorithmSuite/);
    assert.doesNotMatch(source, /connectedCheckingBalance\(/);
  }
});
