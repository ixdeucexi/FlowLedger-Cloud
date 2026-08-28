import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("defers the full outlook until desktop or an explicit mobile modal", () => {
  const mobileDashboard = readFileSync("app/(tabs)/index.tsx", "utf8");
  const outlookEffect = mobileDashboard.slice(
    mobileDashboard.indexOf("// ── 12-month negative schedule"),
    mobileDashboard.indexOf("// First month (across all 12)"),
  );

  assert.match(outlookEffect, /if \(!isFocused \|\| \(!isCommandWide && !negCalendarVisible\)\) return;/);
  assert.match(outlookEffect, /nextSchedule\.push\(next\)/);
  assert.match(outlookEffect, /i < settings\.forecast_horizon_months/);
  assert.match(outlookEffect, /setYearNegSchedule\(nextSchedule\)/);
  assert.doesNotMatch(outlookEffect, /setYearNegSchedule\(previous =>/);

  assert.match(mobileDashboard, /accessibilityRole="progressbar"/);
  assert.match(mobileDashboard, /accessibilityLabel="Building the breathing room outlook"/);
  assert.match(mobileDashboard, /Building outlook\.\.\./);
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

test("desktop Upcoming uses canonical debt occurrences when the payoff planner is disabled", () => {
  const desktopDashboard = readFileSync(
    "components/desktop/DesktopDashboard.tsx",
    "utf8",
  );

  assert.match(desktopDashboard, /const debtSettlements = getDebtMonthSettlements\(month, year\)/);
  assert.match(desktopDashboard, /exactDebtOccurrence\?\.configuredObligation/);
  assert.match(desktopDashboard, /exactDebtOccurrence\?\.remainingRequired/);
  assert.match(desktopDashboard, /getDebtMonthSettlements,[\s\S]+getBillMonthlyTotal/);
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
