import assert from "node:assert/strict";
import test from "node:test";

import {
  backupProgressPoints,
  calculateFlowScore,
  FLOW_SCORE_BACKUP_MILESTONES,
  FLOW_SCORE_GUIDE,
  FLOW_SCORE_MAX_POINTS,
  FLOW_SCORE_WEIGHTS,
  flowScoreLabel,
} from "./flowScorePolicy";

test("Flow Score has three understandable components totaling 100 points", () => {
  assert.equal(FLOW_SCORE_MAX_POINTS, 100);
  assert.deepEqual(FLOW_SCORE_WEIGHTS, {
    planCoverage: 40,
    requiredPayments: 30,
    backupProgress: 30,
  });
  assert.deepEqual(FLOW_SCORE_GUIDE.map(item => item.points), [40, 30, 30]);
});

test("Flow Score rewards plan coverage, current Must Pay money, and early backup milestones", () => {
  const result = calculateFlowScore({
    safeForecastDays: 10,
    forecastDays: 10,
    requiredAmountDue: 500,
    requiredAmountCovered: 500,
    protectedDays: 7,
  });
  assert.equal(result.score, 80);
  assert.equal(result.label, "Strong");
  assert.deepEqual(result.components.map(component => component.earned), [40, 30, 10]);
});

test("one day needing breathing room reduces coverage proportionally instead of losing 40 points", () => {
  const result = calculateFlowScore({
    safeForecastDays: 9,
    forecastDays: 10,
    requiredAmountDue: 500,
    requiredAmountCovered: 500,
    protectedDays: 7,
  });
  assert.equal(result.components[0].earned, 36);
  assert.equal(result.score, 76);
});

test("Must Pay points use dollars covered and future-only months remain current", () => {
  assert.equal(calculateFlowScore({ safeForecastDays: 1, forecastDays: 1, requiredAmountDue: 200, requiredAmountCovered: 100, protectedDays: 0 }).components[1].earned, 15);
  assert.equal(calculateFlowScore({ safeForecastDays: 1, forecastDays: 1, requiredAmountDue: 0, requiredAmountCovered: 0, protectedDays: 0 }).components[1].earned, 30);
});

test("backup milestones and score labels match the published policy", () => {
  assert.deepEqual(FLOW_SCORE_BACKUP_MILESTONES.map(milestone => backupProgressPoints(milestone.days)), [0, 10, 20, 27, 30]);
  assert.equal(flowScoreLabel(39), "Getting started");
  assert.equal(flowScoreLabel(40), "Building");
  assert.equal(flowScoreLabel(60), "Steady");
  assert.equal(flowScoreLabel(75), "Strong");
  assert.equal(flowScoreLabel(90), "Well protected");
});
