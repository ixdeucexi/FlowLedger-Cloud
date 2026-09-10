import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { goalFundingCushion, parseGoalContribution, goalContributionSnapshotMatches } from "./goalFundingReview";
import { buildGoalFundingPlans } from "./competitiveGrowth";

function baseline(balances: number[], openingBalance = 500) {
  return { startDate: "2026-09-09", endDate: "2026-09-11", openingBalance,
    days: balances.map((balance, index) => ({ date: `2026-09-${9 + index}`, balance, inflow: 0, outflow: 0, net: 0, events: [] })) };
}
test("shared cushion protects the lowest dated cash point and opening cash, not month-end income", () => {
  assert.equal(goalFundingCushion(baseline([450, 125, 1800]), 100), 25);
  assert.equal(goalFundingCushion(baseline([900, 1000], 50), 100), 0);
  assert.equal(goalFundingCushion(baseline([450, -25, 1800]), 100), 0);
  assert.equal(goalFundingCushion(baseline([]), 100), null);
  assert.equal(goalFundingCushion(baseline([NaN]), 100), null);
});
test("multiple goals get target paces, never independent claims on the same cash", () => {
  const plans = buildGoalFundingPlans([
    { id: "a", name: "Buffer", targetAmount: 1000, currentAmount: 0, targetDate: "2027-01-09" },
    { id: "b", name: "Car", targetAmount: 3000, currentAmount: 0, targetDate: "2027-01-09" },
  ], new Date("2026-09-09T12:00:00"));
  assert.ok(plans.every(plan => !Object.hasOwn(plan, "safeMonthlyContribution") && plan.status === "needs_review"));
});
test("recorded contributions require finite positive exact cents within target", () => {
  for (const text of ["", "0", "-1", "NaN", "Infinity", "1e3", "1.001", "$20", "20,00", "101"]) {
    assert.equal(parseGoalContribution(text, 100), null, text);
  }
  assert.equal(parseGoalContribution("100.00", 100), 100);
  assert.equal(parseGoalContribution("0.01", 0.01), 0.01);
});
test("confirmation rejects changed household, goal, date, permission or financial revision", () => {
  const revision = {};
  const expected = { householdId: "h1", goalId: "g1", currentAmount: 100, targetAmount: 500, date: "2026-09-09", revision };
  const current = { householdId: "h1", goals: [{ id: "g1", current_amount: 100, target_amount: 500 }], date: expected.date, revision, canEdit: true };
  assert.equal(goalContributionSnapshotMatches(expected, current), true);
  for (const change of [{ householdId: "h2" }, { goals: [] }, { canEdit: false }, { date: "2026-09-10" }, { revision: {} }, { goals: [{ id: "g1", current_amount: 200, target_amount: 500 }] }]) {
    assert.equal(goalContributionSnapshotMatches(expected, { ...current, ...change }), false);
  }
});
test("goal UI preserves atomic recording and scopes estimate work to visible Goals", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/more.tsx"), "utf8");
  assert.match(source, /activeSettingsSection !== "goals" \|\| !goalEstimateReady/);
  assert.match(source, /getPlanSimulationBaseline\(3, todayIso\)/);
  assert.match(source, /goalContributionSnapshotMatches\(expected, current\)/);
  assert.match(source, /assertFinancialMutationOnline\(\);\s+await fundGoalAtomically/);
  assert.match(source, /expectedCurrentAmount: goal.current_amount/);
  assert.doesNotMatch(source, /safeMonthlyGoalFunding|safeMonthlyContribution|activeAccounts\[0\]\?\.id/);
  assert.match(source, /does not transfer money/);
});
