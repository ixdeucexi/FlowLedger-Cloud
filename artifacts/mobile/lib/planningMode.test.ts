import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlanningTools } from "./planningMode";

test("preserves the existing debt-plan experience by default", () => {
  assert.deepEqual(normalizePlanningTools(undefined), {
    zeroBasedBudgetEnabled: false,
    debtPayoffEnabled: true,
  });
});

test("migrates legacy exclusive modes into independent planning tools", () => {
  assert.deepEqual(normalizePlanningTools({ planning_mode: "zero_budget" }), {
    zeroBasedBudgetEnabled: true,
    debtPayoffEnabled: false,
  });
  assert.deepEqual(normalizePlanningTools({ planning_mode: "free_flow" }), {
    zeroBasedBudgetEnabled: false,
    debtPayoffEnabled: false,
  });
});

test("supports zero-based budgeting and debt payoff at the same time", () => {
  assert.deepEqual(normalizePlanningTools({
    zero_based_budget_enabled: true,
    debt_payoff_enabled: true,
    planning_mode: "free_flow",
  }), {
    zeroBasedBudgetEnabled: true,
    debtPayoffEnabled: true,
  });
});
