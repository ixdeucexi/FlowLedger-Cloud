import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlanningMode, usesSnowball, usesZeroBudget } from "./planningMode";

test("normalizes missing and legacy planning modes to snowball", () => {
  assert.equal(normalizePlanningMode(undefined), "snowball");
  assert.equal(normalizePlanningMode("unexpected"), "snowball");
});

test("keeps supported planning modes and exposes their capabilities", () => {
  assert.equal(normalizePlanningMode("zero_budget"), "zero_budget");
  assert.equal(normalizePlanningMode("free_flow"), "free_flow");
  assert.equal(usesSnowball("snowball"), true);
  assert.equal(usesSnowball("free_flow"), false);
  assert.equal(usesZeroBudget("zero_budget"), true);
  assert.equal(usesZeroBudget("snowball"), false);
});
