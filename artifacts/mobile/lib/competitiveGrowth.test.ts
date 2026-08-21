import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTransactionRules,
  buildGoalFundingPlans,
  buildMonthlyMoneyInsights,
  buildReportsSummary,
  buildReviewQueue,
  buildSmartReminders,
  detectSubscriptions,
  subscriptionNeedsCleanup,
  subscriptionLinkKeys,
  evaluateForecastReadiness,
  type GrowthTransaction,
  type TransactionRule,
} from "./competitiveGrowth";

const transactions: GrowthTransaction[] = [
  { id: "t1", date: "2026-07-01", amount: -15.99, description: "Netflix", category: "Entertainment", source: "manual" },
  { id: "t2", date: "2026-08-01", amount: -17.99, description: "Netflix", category: "Entertainment", source: "manual" },
  { id: "t3", date: "2026-09-01", amount: -17.99, description: "Netflix", category: "Entertainment", source: "manual" },
  { id: "t4", date: "2026-07-04", amount: -83.44, description: "Unknown store", category: "Other", source: "import", importHash: "abc" },
  { id: "t5", date: "2026-07-04", amount: -83.44, description: "Unknown store", category: "Other", source: "import", importHash: "abc" },
  { id: "t6", date: "2026-07-10", amount: 2200, description: "Payroll", category: "Income", source: "import" },
];

test("applies the best matching transaction rule", () => {
  const rules: TransactionRule[] = [
    { id: "other", name: "Fallback amount", matchType: "amount_range", amountMin: 10, amountMax: 30, category: "Other", priority: 50 },
    { id: "netflix", name: "Netflix subscription", matchType: "contains", matchValue: "netflix", category: "Subscriptions", priority: 1 },
  ];

  const result = applyTransactionRules(transactions[0], rules);

  assert.equal(result.ruleId, "netflix");
  assert.equal(result.category, "Subscriptions");
  assert.match(result.reason, /Netflix subscription/);
});

test("builds a review queue for imports, duplicates, and unclear categories", () => {
  const queue = buildReviewQueue(transactions, []);

  const duplicate = queue.find(item => item.transactionId === "t4");
  assert.ok(duplicate);
  assert.ok(duplicate.reasons.includes("possible_duplicate"));
  assert.ok(duplicate.reasons.includes("missing_category"));
  assert.equal(duplicate.priority, "high");
});

test("detects recurring subscriptions and price increases", () => {
  const subscriptions = detectSubscriptions(transactions);
  const netflix = subscriptions.find(item => item.merchant === "netflix");

  assert.ok(netflix);
  assert.equal(netflix.cadence, "monthly");
  assert.equal(netflix.priceIncrease, true);
  assert.ok(netflix.yearlyEquivalent > 200);
});

test("tracked bill subscriptions stay out of cleanup until a new charge needs review", () => {
  const candidate = { transactionIds: ["old", "new"] };
  assert.equal(subscriptionNeedsCleanup(candidate, [
    { id: "old", amount: -15, source: "plaid", review_status: "matched", linked_bill_id: "bill" },
  ]), false);
  assert.equal(subscriptionNeedsCleanup(candidate, [
    { id: "old", amount: -15, source: "plaid", review_status: "matched", linked_bill_id: "bill" },
    { id: "new", amount: -15, source: "plaid", review_status: "needs_review" },
  ]), true);
  assert.equal(subscriptionNeedsCleanup(candidate, [
    { id: "old", amount: -15, source: "plaid", review_status: "categorized" },
  ]), true);
  assert.equal(subscriptionNeedsCleanup(candidate, [
    { id: "old", amount: -15, source: "plaid", review_status: "categorized" },
  ], "saved-bill"), false);
  assert.equal(subscriptionNeedsCleanup(candidate, [
    { id: "old", amount: -15, source: "plaid", review_status: "categorized" },
    { id: "new", amount: -15, source: "plaid", review_status: "needs_review" },
  ], "saved-bill"), true);
});

test("subscription links can be found from both Plaid merchant and raw bank text", () => {
  assert.deepEqual(subscriptionLinkKeys({
    merchant_name: "Google",
    note: "Electronic Withdrawal Google 014923619",
    category: "Subscriptions",
  }), ["google", "electronic withdrawal google 014923619", "subscriptions"]);
});

test("scores forecast readiness with clear next step", () => {
  const readiness = evaluateForecastReadiness({
    accounts: 1,
    hasCurrentBalance: true,
    incomes: 1,
    recurringBills: 0,
    debts: 0,
    goals: 0,
    debtPayoffSelected: true,
    savingsSelected: false,
    safetyFloorReviewed: true,
    firstForecastViewed: false,
    reconciledRecently: false,
  });

  assert.ok(readiness.score < 70);
  assert.equal(readiness.nextStep, "Add recurring bills");
  assert.ok(readiness.missing.includes("Add debts"));
});

test("creates safe goal funding plans", () => {
  const plans = buildGoalFundingPlans([
    { id: "g1", name: "Emergency fund", targetAmount: 1200, currentAmount: 300, targetDate: "2026-12-31" },
  ], 100, new Date("2026-07-01T00:00:00"));

  assert.equal(plans[0].status, "behind");
  assert.equal(plans[0].safeMonthlyContribution, 100);
});

test("summarizes reports without AI guessing", () => {
  const report = buildReportsSummary(
    transactions,
    [{ id: "b1", name: "Utilities", amount: 300, category: "Utilities", dueDay: 4, isRecurring: true }],
    [{ id: "d1", name: "Card", balance: 500, minimumPayment: 50 }],
    [{ id: "g1", name: "Emergency", targetAmount: 1000, currentAmount: 250 }],
  );

  assert.equal(report.debtTotal, 500);
  assert.equal(report.plannedBills, 300);
  assert.equal(report.debtMinimums, 50);
  assert.equal(report.net, report.income - report.spending);
  assert.equal(report.goalProgress[0].percent, 25);
  assert.ok(report.subscriptionTotal > 0);
});

test("builds six chronological monthly money insights", () => {
  const insights = buildMonthlyMoneyInsights([
    { id: "june-in", date: "2026-06-05", amount: 2000, description: "Payday" },
    { id: "june-out", date: "2026-06-06", amount: -500, description: "Rent" },
    { id: "july-in", date: "2026-07-05", amount: 2100, description: "Payday" },
    { id: "july-out", date: "2026-07-06", amount: -600, description: "Rent" },
  ], "2026-07", 3);

  assert.deepEqual(insights.map(item => item.key), ["2026-05", "2026-06", "2026-07"]);
  assert.deepEqual(insights.at(-1), {
    key: "2026-07",
    label: "Jul",
    income: 2100,
    spending: 600,
    net: 1500,
  });
});

test("builds reminders", () => {
  const reminders = buildSmartReminders({
    today: "2026-07-02",
    bills: [{ id: "b1", name: "Utilities", amount: 300, category: "Utilities", dueDay: 4 }],
    reviewCount: 2,
    subscriptionIncreases: 1,
    lowestBalance: 120,
    safetyFloor: 200,
    needsReconcile: true,
  });

  assert.ok(reminders.some(item => item.type === "low_balance"));
  assert.ok(reminders.some(item => item.type === "transaction_review"));

});
