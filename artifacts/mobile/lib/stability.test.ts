import assert from "node:assert/strict";
import test from "node:test";

import { buildStabilityProgress } from "./stability";

test("prioritizes stabilization when a future day crosses the safety floor", () => {
  const result = buildStabilityProgress({
    balances: [{ day: 1, balance: 700 }, { day: 5, balance: 150 }],
    todayDay: 1,
    safetyFloor: 200,
    monthlyRequiredOutflow: 1200,
    overdueBills: 0,
    forecastConfidence: "high",
  });

  assert.equal(result.stage, "stabilize");
  assert.equal(result.status, "risk");
  assert.equal(result.riskDays, 1);
  assert.equal(result.protectedAmount, 0);
});

test("turns breathing room into understandable protected days", () => {
  const result = buildStabilityProgress({
    balances: [{ day: 1, balance: 1000 }, { day: 20, balance: 800, income: 1200 }],
    todayDay: 1,
    safetyFloor: 200,
    monthlyRequiredOutflow: 1200,
    overdueBills: 0,
    forecastConfidence: "high",
  });

  assert.equal(result.protectedAmount, 600);
  assert.equal(result.protectedDays, 15);
  assert.equal(result.stage, "reserve");
  assert.equal(result.nextMilestoneAmount, 600);
  assert.equal(result.safeUntilPayday, true);
  assert.equal(result.backupTarget, 3600);
});

test("separates safety through payday from the 90-day backup path", () => {
  const result = buildStabilityProgress({
    balances: [
      { day: 1, balance: 700 },
      { day: 7, balance: 500 },
      { day: 10, balance: 1100, income: 1000 },
    ],
    todayDay: 1,
    safetyFloor: 200,
    monthlyRequiredOutflow: 900,
    overdueBills: 0,
    forecastConfidence: "high",
    nextPaycheckLabel: "July 10, 2026",
  });

  assert.equal(result.safeUntilPayday, true);
  assert.equal(result.nextPaycheckLabel, "July 10, 2026");
  assert.equal(result.protectedDays, 10);
  assert.equal(result.stage, "reserve");
  assert.equal(result.nextMilestone, "30 protected days");
});

test("requires a complete essential-expense plan before claiming reserve progress", () => {
  const result = buildStabilityProgress({
    balances: [{ day: 1, balance: 1000 }],
    todayDay: 1,
    safetyFloor: 200,
    monthlyRequiredOutflow: 0,
    overdueBills: 0,
    forecastConfidence: "medium",
  });

  assert.equal(result.stage, "next_paycheck");
  assert.equal(result.protectedDays, 0);
  assert.match(result.nextAction, /required bills/i);
});
