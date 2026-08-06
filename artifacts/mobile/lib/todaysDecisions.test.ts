import assert from "node:assert/strict";
import test from "node:test";

import { buildTodaysDecisions } from "./todaysDecisions";

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
    nextBill: { name: "Electric", amount: 120, dateLabel: "tomorrow", daysAway: 1 },
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

test("transient financial data is not required for a stable empty state", () => {
  const decisions = buildTodaysDecisions({ ...base, safeToSpend: 0 });
  assert.equal(decisions[0].id, "check-plan");
});
