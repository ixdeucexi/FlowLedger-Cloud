import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSetupCompletionMessage,
  buildPersonalizedSetupKeys,
  describeSetupPlan,
  getSetupPathItem,
  normalizeOnboardingPreferences,
  shouldAskSavingsGoal,
} from "./onboarding";

test("normalizes onboarding preferences safely", () => {
  const prefs = normalizeOnboardingPreferences({
    help: ["track_spending", "bad", "track_spending"],
    goals: ["pay_off_debt", "unknown"],
    savingsGoal: "emergency_fund",
  });
  assert.deepEqual(prefs.help, ["track_spending"]);
  assert.deepEqual(prefs.goals, ["pay_off_debt"]);
  assert.equal(prefs.savingsGoal, "emergency_fund");
});

test("asks the savings question only when savings is selected", () => {
  assert.equal(shouldAskSavingsGoal(normalizeOnboardingPreferences({ help: ["grow_savings"] })), true);
  assert.equal(shouldAskSavingsGoal(normalizeOnboardingPreferences({ goals: ["grow_savings"] })), true);
  assert.equal(shouldAskSavingsGoal(normalizeOnboardingPreferences({ goals: ["pay_off_debt"] })), false);
});

test("routes debt users into debt setup before goals", () => {
  const keys = buildPersonalizedSetupKeys(normalizeOnboardingPreferences({
    help: ["pay_off_debt"],
    goals: ["pay_off_debt"],
  }));
  assert.deepEqual(keys, ["account", "money", "income", "debts", "safety", "reconcile", "finish"]);
});

test("routes savings users into goal setup", () => {
  const keys = buildPersonalizedSetupKeys(normalizeOnboardingPreferences({
    help: ["grow_savings"],
    goals: ["grow_savings"],
  }));
  assert.deepEqual(keys, ["account", "money", "income", "goals", "safety", "reconcile", "finish"]);
});

test("keeps a full setup path when preferences are empty", () => {
  const keys = buildPersonalizedSetupKeys(normalizeOnboardingPreferences({}));
  assert.deepEqual(keys, ["account", "money", "income", "bills", "debts", "goals", "safety", "reconcile", "finish"]);
});

test("summarizes the selected path for Flo", () => {
  const summary = describeSetupPlan(normalizeOnboardingPreferences({
    help: ["lower_bills", "track_spending"],
    goals: ["grow_savings"],
  }));
  assert.match(summary, /savings goals/);
  assert.match(summary, /bill review/);
  assert.match(summary, /spending and budget setup/);
});

test("labels setup path items for polished onboarding", () => {
  const debt = getSetupPathItem("debts");
  assert.equal(debt.shortLabel, "Debt");
  assert.match(debt.detail, /snowball/i);
});

test("builds a completion message without changing money data", () => {
  const message = buildSetupCompletionMessage(normalizeOnboardingPreferences({
    help: ["pay_off_debt"],
    goals: ["pay_off_debt"],
  }));
  assert.match(message, /debt payoff/);
  assert.match(message, /real forecast/);
});
