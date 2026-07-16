import assert from "node:assert/strict";
import test from "node:test";

import { ALGORITHM_CATALOG, defaultAlgorithmToggles, normalizeAlgorithmToggles } from "./algorithmCatalog";
import { buildAlgorithmSuite, type AlgorithmSuiteInput } from "./algorithmSuite";

function baseInput(overrides: Partial<AlgorithmSuiteInput> = {}): AlgorithmSuiteInput {
  return {
    month: 6,
    year: 2026,
    todayDay: 1,
    safetyFloor: 200,
    cashFlow: {
      monthlyIncome: 3000,
      totalBillsDue: 1400,
      totalPaid: 900,
      netTransactions: -250,
      remaining: 1350,
      goalAllocations: 100,
    },
    dailyBalances: [
      { day: 1, income: 3000, bills: 0, expense: 0, net: 3000, balance: 3000 },
      { day: 5, income: 0, bills: 800, expense: 0, net: -800, balance: 2200 },
      { day: 12, income: 0, bills: 300, expense: 100, net: -400, balance: 1800 },
      { day: 25, income: 0, bills: 300, expense: 100, net: -400, balance: 1400 },
    ],
    bills: [
      { id: "rent", name: "Rent", amount: 800, category: "Housing", due_day: 5, is_debt: false, is_recurring: true, paidAmount: 800 },
      { id: "phone", name: "Phone", amount: 100, category: "Utilities", due_day: 8, is_debt: false, is_recurring: true, paidAmount: 0 },
      { id: "card", name: "Credit Card", amount: 120, category: "Debt", due_day: 10, is_debt: true, is_recurring: true, balance: 900, interest_rate: 24.99, paidAmount: 0 },
    ],
    transactions: [
      { id: "food-1", date: "2026-07-03", amount: -45, category: "Food", note: "Groceries" },
    ],
    incomes: [
      { id: "pay", name: "Paycheck", amount: 3000, frequency: "biweekly" },
    ],
    goals: [
      { id: "emergency", name: "Emergency Fund", target_amount: 1000, current_amount: 400, target_date: "2026-12-01", goal_type: "savings" },
    ],
    categoryPlan: [
      { category: "Food", budgeted: 400, spent: 200, remaining: 200, status: "available" },
    ],
    forecastConfidence: { level: "high", label: "High", reasons: ["Accounts and recurring cash flow are current"] },
    settings: {
      algorithmSuiteEnabled: true,
      algorithmToggles: defaultAlgorithmToggles(),
    },
    ...overrides,
  };
}

test("builds Flow Score, Safe Cushion, and practical algorithm outputs", () => {
  const suite = buildAlgorithmSuite(baseInput());

  assert.ok(suite.flowScore.score > 70);
  assert.ok(suite.flowScore.topReason.length > 0);
  assert.ok(suite.flowScore.topAction.length > 0);
  assert.ok(suite.flowScore.breakdownItems.length >= 4);
  assert.ok(suite.flowScore.positiveFactors.some(factor => /upcoming bill/i.test(factor)));
  assert.ok(suite.flowScore.negativeFactors.every(factor => !/still need attention/i.test(factor)));
  assert.equal(suite.safeCushion.amount, 1200);
  assert.equal(suite.safeCushion.status, "safe");
  assert.match(suite.safeCushion.topReason, /\$1200/);
  assert.ok(suite.safeCushion.topAction.length > 0);
  assert.ok(suite.safeCushion.breakdownItems.some(item => item.label === "Safety floor"));
  assert.equal(suite.lowBalanceWarning.status, "safe");
  assert.equal(suite.billPriority.bills[0].name, "Phone");
  assert.equal(suite.billPriority.nextBill?.name, "Phone");
  assert.match(suite.billPriority.summary, /Phone|bill/i);
  assert.match(suite.purchaseDecision.nextMove, /Flo|purchase|date/i);
  assert.equal(suite.paydaySplit.dollars.bills, 900);
  assert.ok(suite.paydaySplit.dollars.debt >= 120);
  assert.equal(
    suite.paydaySplit.dollars.bills + suite.paydaySplit.dollars.debt + suite.paydaySplit.dollars.goals + suite.paydaySplit.dollars.savings + suite.paydaySplit.dollars.spending,
    3000,
  );
  assert.match(suite.paydaySplit.summary, /bills/i);
  assert.equal(suite.debtPayoff.nextDebtName, "Credit Card");
  assert.equal(suite.debtPayoff.status, "ready");
  assert.equal(suite.debtPayoff.avalancheName, "Credit Card");
  assert.equal(suite.debtPayoff.cashFlowReliefName, "Credit Card");
  assert.match(suite.debtPayoff.nextMove, /Credit Card/);
  assert.equal(suite.extraMoneyRouter.recommendation, "debt");
  assert.equal(suite.extraMoneyRouter.targetLabel, "Credit Card");
  assert.ok(suite.extraMoneyRouter.options.length >= 3);
  assert.ok(suite.spendingLimit.daily > 0);
  assert.equal(suite.spendingLimit.status, "safe");
  assert.ok(suite.insights.some(insight => insight.algorithm === "Flow Score"));
});

test("every active algorithm exposes a decision-engine detail", () => {
  const suite = buildAlgorithmSuite(baseInput());

  for (const algorithm of ALGORITHM_CATALOG) {
    const detail = suite.algorithmDetails[algorithm.id];
    assert.equal(detail.id, algorithm.id);
    assert.match(detail.status, /^(safe|watch|risk)$/);
    assert.ok(detail.headline.length > 0);
    assert.ok(detail.whatIFound.length > 0);
    assert.ok(detail.whyItMatters.length > 0);
    assert.ok(detail.nextAction.length > 0);
    assert.ok(detail.floPrompt.length > 0);
    assert.ok(detail.sourceNumbers.length > 0);
  }
});

test("Safe Cushion protects spending, routing, and debt recommendations", () => {
  const suite = buildAlgorithmSuite(baseInput({
    cashFlow: {
      monthlyIncome: 3000,
      totalBillsDue: 1400,
      totalPaid: 900,
      netTransactions: -250,
      remaining: 1000,
      goalAllocations: 0,
    },
    dailyBalances: [
      { day: 1, income: 0, bills: 0, expense: 0, net: 0, balance: 190 },
      { day: 8, income: 0, bills: 0, expense: 0, net: 0, balance: 175 },
    ],
  }));

  assert.equal(suite.safeCushion.amount, 0);
  assert.equal(suite.safeCushion.status, "risk");
  assert.equal(suite.purchaseDecision.safeNowLimit, 0);
  assert.equal(suite.spendingLimit.daily, 0);
  assert.equal(suite.extraMoneyRouter.amount, 0);
  assert.equal(suite.debtPayoff.status, "hold");
  assert.match(suite.algorithmDetails.safeCushion.whyItMatters, /money I’m protecting/i);
  assert.match(suite.algorithmDetails.debtPayoff.nextAction, /Hold extra debt payments/i);
});

test("Debt Payoff exposes snowball rollover and next target metadata", () => {
  const suite = buildAlgorithmSuite(baseInput({
    bills: [
      { id: "camera", name: "Camera", amount: 38, category: "Debt", due_day: 11, is_debt: true, is_recurring: true, balance: 144, interest_rate: 0, paidAmount: 0 },
      { id: "concert", name: "Concert", amount: 35, category: "Debt", due_day: 29, is_debt: true, is_recurring: true, balance: 389, interest_rate: 0, paidAmount: 0 },
      { id: "card", name: "Card", amount: 80, category: "Debt", due_day: 15, is_debt: true, is_recurring: true, balance: 1200, interest_rate: 25, paidAmount: 0 },
    ],
  }));

  assert.equal(suite.debtPayoff.nextDebtName, "Camera");
  assert.equal(suite.debtPayoff.nextDebtNameAfterTarget, "Concert");
  assert.equal(suite.debtPayoff.rolloverAmount, 38);
  assert.equal(suite.debtPayoff.totalMonthlyMinimum, 153);
  assert.ok(suite.debtPayoff.safeExtraAmount > 0);
  assert.match(suite.debtPayoff.whyItMatters, /rolls into Concert/i);
});

test("cash-flow gap wording handles a one-day tight stretch", () => {
  const suite = buildAlgorithmSuite(baseInput({
    dailyBalances: [
      { day: 1, income: 3000, bills: 0, expense: 0, net: 3000, balance: 3000 },
      { day: 8, income: 0, bills: 0, expense: 0, net: 0, balance: 272 },
      { day: 9, income: 0, bills: 0, expense: 0, net: 0, balance: 600 },
    ],
  }));

  assert.equal(suite.cashFlowGap.startDay, 8);
  assert.equal(suite.cashFlowGap.endDay, 8);
  assert.equal(suite.cashFlowGap.detail, "Tightest stretch is July 8, 2026. Main pressure: Phone $100.");
  assert.deepEqual(suite.cashFlowGap.causes.map(cause => cause.label), ["Phone"]);
  assert.equal(suite.algorithmDetails.cashFlowGap.sourceNumbers.find(item => item.label === "Main pressure")?.value, "Phone");
});

test("Flow Score treats future bills as planned, not negative", () => {
  const suite = buildAlgorithmSuite(baseInput({
    todayDay: 1,
    bills: [
      { id: "a", name: "Future A", amount: 100, category: "Other", due_day: 20, is_debt: false, is_recurring: true, paidAmount: 0 },
      { id: "b", name: "Future B", amount: 200, category: "Other", due_day: 25, is_debt: false, is_recurring: true, paidAmount: 0 },
    ],
  }));

  assert.equal(suite.flowScore.breakdownItems.find(item => item.label === "Due Bills")?.value, "On track");
  assert.ok(suite.flowScore.positiveFactors.some(factor => /upcoming bills are planned/i.test(factor)));
  assert.ok(suite.flowScore.negativeFactors.every(factor => !/bill/i.test(factor)));
});

test("Flow Score only flags bills when due or overdue", () => {
  const suite = buildAlgorithmSuite(baseInput({
    todayDay: 12,
    bills: [
      { id: "a", name: "Past Bill", amount: 100, category: "Other", due_day: 9, is_debt: false, is_recurring: true, paidAmount: 0 },
      { id: "b", name: "Future Bill", amount: 200, category: "Other", due_day: 25, is_debt: false, is_recurring: true, paidAmount: 0 },
    ],
  }));

  assert.equal(suite.flowScore.breakdownItems.find(item => item.label === "Due Bills")?.value, "0/1");
  assert.ok(suite.flowScore.negativeFactors.some(factor => /overdue bill/i.test(factor)));
});

test("spending and purchase algorithms require monthly room, not cushion alone", () => {
  const suite = buildAlgorithmSuite(baseInput({
    cashFlow: {
      monthlyIncome: 3000,
      totalBillsDue: 1400,
      totalPaid: 900,
      netTransactions: -1800,
      remaining: -200,
      goalAllocations: 0,
    },
    dailyBalances: [
      { day: 1, income: 3000, bills: 0, expense: 0, net: 3000, balance: 3000 },
      { day: 20, income: 0, bills: 0, expense: 0, net: 0, balance: 1600 },
    ],
  }));

  assert.equal(suite.safeCushion.amount, 1400);
  assert.equal(suite.purchaseDecision.safeNowLimit, 0);
  assert.equal(suite.purchaseDecision.action, "avoid");
  assert.equal(suite.spendingLimit.daily, 0);
  assert.equal(suite.spendingLimit.status, "risk");
  assert.equal(suite.extraMoneyRouter.amount, 0);
});

test("cash-flow gap explains the biggest bills and spending creating the squeeze", () => {
  const suite = buildAlgorithmSuite(baseInput({
    todayDay: 1,
    dailyBalances: [
      { day: 1, income: 3000, bills: 0, expense: 0, net: 3000, balance: 3000 },
      { day: 7, income: 0, bills: 900, expense: 75, net: -975, balance: 310 },
      { day: 8, income: 0, bills: 200, expense: 60, net: -260, balance: 255 },
      { day: 9, income: 0, bills: 0, expense: 0, net: 0, balance: 700 },
    ],
    bills: [
      { id: "rent", name: "Rent", amount: 900, category: "Housing", due_day: 7, is_debt: false, is_recurring: true, paidAmount: 0 },
      { id: "phone", name: "Phone", amount: 200, category: "Utilities", due_day: 8, is_debt: false, is_recurring: true, paidAmount: 0 },
    ],
    transactions: [
      { id: "gas", date: "2026-07-07", amount: -75, category: "Transportation", note: "Gas" },
      { id: "food", date: "2026-07-08", amount: -60, category: "Food", note: "Food" },
    ],
  }));

  assert.equal(suite.cashFlowGap.startDay, 7);
  assert.equal(suite.cashFlowGap.endDay, 8);
  assert.deepEqual(suite.cashFlowGap.causes.map(cause => cause.label), ["Rent", "Phone", "Gas"]);
  assert.match(suite.cashFlowGap.detail, /Main pressure: Rent \$900, Phone \$200, Gas \$75/);
});

test("Extra Money Router protects current bills before routing leftover to debt", () => {
  const suite = buildAlgorithmSuite(baseInput({
    todayDay: 12,
    cashFlow: {
      monthlyIncome: 5000,
      totalBillsDue: 600,
      totalPaid: 0,
      netTransactions: -250,
      remaining: 3500,
      goalAllocations: 0,
    },
    dailyBalances: [
      { day: 12, income: 5000, bills: 0, expense: 0, net: 5000, balance: 5000 },
      { day: 20, income: 0, bills: 0, expense: 0, net: 0, balance: 4200 },
    ],
    bills: [
      { id: "utility", name: "Utility", amount: 220, category: "Utilities", due_day: 10, is_debt: false, is_recurring: true, paidAmount: 0 },
      { id: "card", name: "Credit Card", amount: 120, category: "Debt", due_day: 20, is_debt: true, is_recurring: true, balance: 900, interest_rate: 24.99, paidAmount: 0 },
    ],
  }));

  assert.equal(suite.extraMoneyRouter.recommendation, "bill");
  assert.equal(suite.extraMoneyRouter.targetLabel, "Utility");
  assert.match(suite.algorithmDetails.extraMoneyRouter.whyItMatters, /protect the floor first/i);
});

test("debt standing uses monthly minimums instead of total balance", () => {
  const suite = buildAlgorithmSuite(baseInput({
    cashFlow: {
      monthlyIncome: 10000,
      totalBillsDue: 1500,
      totalPaid: 1500,
      netTransactions: -500,
      remaining: 8000,
      goalAllocations: 0,
    },
    bills: [
      { id: "mortgage", name: "Mortgage", amount: 500, category: "Debt", due_day: 1, is_debt: true, is_recurring: true, balance: 500000, interest_rate: 4.5, paidAmount: 500 },
    ],
  }));

  assert.ok(suite.flowScore.score > 70);
  assert.equal(suite.debtPayoff.totalMonthlyMinimum, 500);
  assert.ok(suite.flowScore.negativeFactors.every(factor => !/large part|500000/i.test(factor)));
});

test("visible algorithm catalog is trimmed to user-facing suite", () => {
  assert.deepEqual(ALGORITHM_CATALOG.map(item => item.id), [
    "flowScore",
    "safeCushion",
    "purchaseDecision",
    "billPriority",
    "paydaySplit",
    "cashFlowGap",
    "debtPayoff",
    "spendingLimit",
    "extraMoneyRouter",
  ]);
  assert.equal(normalizeAlgorithmToggles({ savingsSweep: false }).extraMoneyRouter, false);
});

test("respects disabled algorithm toggles without growth-stage gating", () => {
  const toggles = defaultAlgorithmToggles();
  toggles.safeCushion = false;
  const suite = buildAlgorithmSuite(baseInput({
    settings: {
      algorithmSuiteEnabled: true,
      algorithmToggles: toggles,
    },
  }));

  assert.equal(suite.safeCushion.amount, 0);
  assert.equal(suite.extraMoneyRouter.targetLabel, "Credit Card");
  assert.ok(suite.activeCount < 20);
  assert.ok(suite.insights.every(insight => insight.id !== "safeCushion"));
});

test("flags risk days and low balance warnings deterministically", () => {
  const suite = buildAlgorithmSuite(baseInput({
    dailyBalances: [
      { day: 1, income: 0, bills: 0, expense: 0, net: 0, balance: 500 },
      { day: 2, income: 0, bills: 450, expense: 0, net: -450, balance: 50 },
    ],
  }));

  assert.equal(suite.lowBalanceWarning.status, "risk");
  assert.equal(suite.lowBalanceWarning.day, 2);
  assert.equal(suite.riskDay.risk, 1);
  assert.ok(suite.flowScore.score < 70);
  assert.match(suite.flowScore.topReason, /floor|negative|risk/i);
  assert.equal(suite.safeCushion.amount, 0);
  assert.equal(suite.safeCushion.status, "risk");
  assert.match(suite.safeCushion.topAction, /protect/i);
});

test("Safe Cushion enters watch status when only a small amount remains above the floor", () => {
  const suite = buildAlgorithmSuite(baseInput({
    dailyBalances: [
      { day: 1, income: 0, bills: 0, expense: 0, net: 0, balance: 500 },
      { day: 8, income: 0, bills: 100, expense: 0, net: -100, balance: 325 },
    ],
  }));

  assert.equal(suite.safeCushion.amount, 125);
  assert.equal(suite.safeCushion.status, "watch");
  assert.match(suite.safeCushion.topReason, /only \$125/);
});
