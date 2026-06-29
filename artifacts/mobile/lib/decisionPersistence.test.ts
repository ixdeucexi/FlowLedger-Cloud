import assert from "node:assert/strict";
import test from "node:test";

import { decisionDbPayload } from "./decisionPersistence";

test("decision persistence keeps follow-through lifecycle fields", () => {
  const payload = decisionDbPayload({
    name: "Trip",
    decision_type: "one_time_purchase",
    scenario: { amount: 200 },
    result: { verdict: "safe" },
    status: "completed",
    calendar_date: "2026-07-10",
    actual_amount: 175,
    remind_at: null,
    next_due_date: "2026-07-10",
    completed_at: "2026-07-11T12:00:00Z",
    applied_change: { kind: "transaction", id: "tx-1" },
  });

  assert.equal(payload.actual_amount, 175);
  assert.equal(payload.completed_at, "2026-07-11T12:00:00Z");
  assert.deepEqual(payload.applied_change, { kind: "transaction", id: "tx-1" });
});

test("legacy calendar and applied statuses persist as phase 3 lifecycle statuses", () => {
  const calendar = decisionDbPayload({ name: "Plan", decision_type: "one_time_purchase", scenario: {}, result: {}, status: "calendar" });
  const applied = decisionDbPayload({ name: "Plan", decision_type: "one_time_purchase", scenario: {}, result: {}, status: "applied" });

  assert.equal(calendar.status, "planned");
  assert.equal(applied.status, "completed");
});
