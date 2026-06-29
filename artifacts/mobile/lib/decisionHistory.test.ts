import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionHistory, type DecisionHistoryInput } from "./decisionHistory";

const base = {
  scenario: { amount: 100, date: "2026-07-10", type: "one_time_purchase" },
} satisfies Partial<DecisionHistoryInput>;

test("groups upcoming planned decisions", () => {
  const history = buildDecisionHistory([
    { ...base, id: "plan", name: "Trip", status: "planned" } as DecisionHistoryInput,
  ], "2026-07-01", "2026-07-01T12:00:00.000Z");

  assert.equal(history.upcoming[0]?.status, "upcoming");
  assert.equal(history.upcoming[0]?.amountLabel, "Planned $100.00");
});

test("shows completed decisions with actual versus planned", () => {
  const history = buildDecisionHistory([
    { ...base, id: "done", name: "Dinner", status: "completed", actual_amount: 80 } as DecisionHistoryInput,
  ], "2026-07-20", "2026-07-20T12:00:00.000Z");

  assert.equal(history.completed[0]?.amountLabel, "Planned $100.00 · Actual $80.00");
  assert.equal(history.completed[0]?.varianceLabel, "-$20.00 vs plan");
});

test("groups postponed and cancelled decisions together", () => {
  const history = buildDecisionHistory([
    { ...base, id: "later", name: "Later", status: "planned", remind_at: "2026-07-05T12:00:00.000Z" } as DecisionHistoryInput,
    { ...base, id: "cancel", name: "Cancelled", status: "cancelled" } as DecisionHistoryInput,
  ], "2026-07-01", "2026-07-01T12:00:00.000Z");

  assert.deepEqual(history.changed.map(item => item.status), ["cancelled", "postponed"]);
});
