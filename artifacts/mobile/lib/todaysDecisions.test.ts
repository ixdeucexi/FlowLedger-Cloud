import assert from "node:assert/strict";
import test from "node:test";

import { buildTodaysDecisions, summarizeDatedDebtDecision } from "./todaysDecisions";

const base = {
  reviewCount: 0,
  lowestBalance: 1_500,
  safetyFloor: 500,
  safeToSpend: 1_000,
};

test("today decisions prioritize forecast risk and never exceed three items", () => {
  const decisions = buildTodaysDecisions({
    ...base,
    reviewCount: 4,
    lowestBalance: 100,
    lowestDate: "August 12",
    nextBill: { id: "electric", name: "Electric", amount: 120, dateLabel: "tomorrow", daysAway: 1 },
    snowballTarget: { name: "Card", balance: 900 },
  });
  assert.equal(decisions.length, 3);
  assert.equal(decisions[0].id, "low-balance-risk");
  assert.equal(decisions[1].id, "review-center");
  assert.equal(decisions[2].id, "bill-due");
});

test("today decisions return a forecast-grounded all-clear state", () => {
  const decisions = buildTodaysDecisions(base);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].id, "all-clear");
  assert.match(decisions[0].reason, /forecast/i);
});

test("today decisions name every supported bill cadence", () => {
  const cases = [
    ["weekly", 150, "$150 weekly payment is due tomorrow."],
    ["biweekly", 150, "$150 biweekly payment is due tomorrow."],
    ["monthly", 120, "$120 monthly payment is due tomorrow."],
    ["quarterly", 600, "$600 quarterly payment is due tomorrow."],
  ] as const;

  cases.forEach(([frequency, amount, expected]) => {
    const decision = buildTodaysDecisions({
      ...base,
      nextBill: {
        id: frequency,
        name: `${frequency} bill`,
        amount,
        dateLabel: "tomorrow",
        daysAway: 1,
        frequency,
      },
    })[0];

    assert.equal(decision.reason, expected, frequency);
  });
});

test("transient financial data is not required for a stable empty state", () => {
  const decisions = buildTodaysDecisions({ ...base, safeToSpend: 0 });
  assert.equal(decisions[0].id, "check-plan");
});

test("the snowball decision opens the dedicated planner", () => {
  const decision = buildTodaysDecisions({
    ...base,
    snowballTarget: { name: "Camera", balance: 45 },
  })[0];
  assert.equal(decision.actionLabel, "Open Planner");
  assert.equal(decision.route, "/snowball-plan");
  assert.equal(decision.params, undefined);
});

test("dated debt decisions split a payoff from its same-day rollover", () => {
  const summary = summarizeDatedDebtDecision([
    {
      id: "camera-required",
      date: "2026-08-11",
      sourceBillId: "camera",
      sourceBillName: "Camera",
      targetBillId: "camera",
      targetBillName: "Camera",
      kind: "required",
      amount: 45,
      sourceAmount: 103,
      balanceBefore: 45,
      balanceAfter: 0,
      paidOff: true,
    },
    {
      id: "camera-rollover",
      date: "2026-08-11",
      sourceBillId: "camera",
      sourceBillName: "Camera",
      targetBillId: "concert",
      targetBillName: "Concert",
      kind: "rollover",
      amount: 58,
      sourceAmount: 58,
      balanceBefore: 319,
      balanceAfter: 261,
      paidOff: false,
    },
  ], "camera");

  assert.deepEqual(summary, {
    date: "2026-08-11",
    name: "Camera",
    amount: 45,
    paidOff: true,
    rollover: { name: "Concert", amount: 58 },
  });

  const decision = buildTodaysDecisions({
    ...base,
    nextBill: {
      id: "camera",
      name: summary!.name,
      amount: summary!.amount,
      dateLabel: "tomorrow",
      daysAway: 1,
      isDebt: true,
      paidOff: summary!.paidOff,
      rollover: summary!.rollover,
    },
  })[0];

  assert.equal(decision.title, "Camera payoff is coming up");
  assert.equal(decision.reason, "$45 pays off Camera tomorrow. $58 rolls to Concert the same day.");
  assert.equal(decision.actionLabel, "Review Debt");
  assert.deepEqual(decision.params, { view: "debt", debtId: "camera" });
});
