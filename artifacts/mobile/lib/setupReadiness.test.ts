import assert from "node:assert/strict";
import test from "node:test";

import { defaultSetupScopeProgress, normalizeOnboardingPreferences } from "./onboarding";
import { buildSetupReadiness, canonicalResumeStage, withSetupConfirmation } from "./setupReadiness";

function baseInput() {
  return {
    preferences: normalizeOnboardingPreferences({ startingPoint: "first_budget", help: ["create_budget"] }),
    progress: defaultSetupScopeProgress("2026-08-12T00:00:00.000Z"),
    accounts: [{ is_active: true, balance_as_of: "2026-08-12" }],
    incomeCount: 1,
    bills: [{ is_debt: false, is_recurring: true }, { is_debt: true, is_recurring: true }],
    goalCount: 0,
    safetyFloor: 200,
    forecastMonths: 6,
  };
}

test("a confirmed zero-balance account completes starting money", () => {
  const readiness = buildSetupReadiness(baseInput());
  assert.equal(readiness.stages.find(stage => stage.id === "starting_money")?.complete, true);
});

test("explicit none answers complete empty cash-flow and debt sections", () => {
  let progress = defaultSetupScopeProgress("2026-08-12T00:00:00.000Z");
  progress = withSetupConfirmation(progress, "income_none", true);
  progress = withSetupConfirmation(progress, "bills_none", true);
  progress = withSetupConfirmation(progress, "debts_none", true);
  const readiness = buildSetupReadiness({ ...baseInput(), progress, incomeCount: 0, bills: [] });
  assert.equal(readiness.stages.find(stage => stage.id === "cashflow")?.complete, true);
  assert.equal(readiness.stages.find(stage => stage.id === "debt_savings")?.complete, true);
});

test("savings goals are required only when the user asks for savings help", () => {
  const preferences = normalizeOnboardingPreferences({ startingPoint: "building_room", help: ["grow_savings"] });
  const readiness = buildSetupReadiness({ ...baseInput(), preferences });
  assert.equal(readiness.wantsSavings, true);
  assert.equal(readiness.stages.find(stage => stage.id === "debt_savings")?.complete, false);
});

test("review requires an explicit safety confirmation", () => {
  const incomplete = buildSetupReadiness(baseInput());
  assert.equal(incomplete.isComplete, false);
  const progress = withSetupConfirmation(baseInput().progress, "safety_reviewed", true);
  const complete = buildSetupReadiness({ ...baseInput(), progress });
  assert.equal(complete.isComplete, true);
});

test("resume never skips an earlier incomplete stage", () => {
  const input = baseInput();
  const progress = { ...input.progress, currentStage: "review" as const };
  const readiness = buildSetupReadiness({ ...input, progress, accounts: [] });
  assert.equal(canonicalResumeStage(readiness, progress), "starting_money");
});
