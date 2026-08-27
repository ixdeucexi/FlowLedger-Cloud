import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { goalAffordabilityFromProjectedBalance } from "./goalAffordability";

test("goal affordability uses the canonical projected close exactly once", () => {
  assert.deepEqual(goalAffordabilityFromProjectedBalance(1_250, 800, 200), {
    projectedBalance: 1_250,
    canAfford: true,
    shortfall: 0,
  });
  assert.deepEqual(goalAffordabilityFromProjectedBalance(700, 800, 200), {
    projectedBalance: 700,
    canAfford: false,
    shortfall: 300,
  });
});

test("BudgetContext derives affordability from Forecast's projected getter", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const start = context.indexOf("const checkGoalAffordability");
  const end = context.indexOf("const getPlanSimulationBaseline", start);
  const source = context.slice(start, end);
  assert.match(source, /getDailyBalances\(month, year\)/);
  assert.doesNotMatch(source, /getCalendarDailyBalances|const monthNet/);
});
