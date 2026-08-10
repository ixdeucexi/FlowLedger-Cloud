import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRestorableRoute } from "./navigationMemory";

test("normalizes tab routes without retaining action parameters", () => {
  assert.equal(normalizeRestorableRoute("/(tabs)/bills?add=1"), "/bills");
  assert.equal(normalizeRestorableRoute("/"), "/(tabs)");
});

test("retains allow-listed page presentation parameters", () => {
  assert.equal(
    normalizeRestorableRoute("/transactions?range=last_90_days&category=Food&activityId=private"),
    "/transactions?range=last_90_days&category=Food",
  );
  assert.equal(normalizeRestorableRoute("/more?section=security"), "/more?section=security");
});

test("rejects blocked, unknown, and privileged restoration targets", () => {
  assert.equal(normalizeRestorableRoute("/login"), null);
  assert.equal(normalizeRestorableRoute("/somewhere-else"), null);
  assert.equal(normalizeRestorableRoute("/more?section=admin"), "/more");
});

test("treats the How FlowLedger works guide as a transient route", () => {
  assert.equal(normalizeRestorableRoute("/how-flowledger-works?section=stability"), "/(tabs)");
  assert.equal(normalizeRestorableRoute("/(tabs)/how-flowledger-works?protectedDays=42"), "/(tabs)");
});
