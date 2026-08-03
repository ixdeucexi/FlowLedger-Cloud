import assert from "node:assert/strict";
import test from "node:test";
import {
  activePendingPlanMatches,
  pendingPlanMatchForOccurrence,
  pendingMatchStatusLabel,
  prioritizePendingPlanTarget,
  unmatchedPendingTransactions,
  type PendingPlanMatch,
} from "./pendingPlanMatches";

function match(overrides: Partial<PendingPlanMatch> = {}): PendingPlanMatch {
  return {
    id: "match-1",
    pending_plaid_transaction_id: "pending-1",
    target_type: "bill",
    target_id: "bill-1",
    target_name: "Electric",
    occurrence_date: "2026-07-29",
    planned_amount: 100,
    pending_amount: 98,
    pending_transaction_date: "2026-07-29",
    status: "active",
    created_at: "2026-07-29T12:00:00Z",
    updated_at: "2026-07-29T12:00:00Z",
    ...overrides,
  };
}

test("a live pending match protects only its exact bill occurrence", () => {
  const matches = [match()];
  const pending = [{ plaid_transaction_id: "pending-1" }];
  assert.equal(pendingPlanMatchForOccurrence(matches, pending, "bill-1", "2026-07-29")?.id, "match-1");
  assert.equal(pendingPlanMatchForOccurrence(matches, pending, "bill-1", "2026-08-29"), undefined);
});

test("a vanished pending charge stops suppressing overdue", () => {
  assert.deepEqual(activePendingPlanMatches([match()], []), []);
});

test("a matched pending charge no longer needs an alert counter", () => {
  const pending = [
    { plaid_transaction_id: "pending-1" },
    { plaid_transaction_id: "pending-2" },
  ];
  assert.deepEqual(
    unmatchedPendingTransactions([match()], pending),
    [{ plaid_transaction_id: "pending-2" }],
  );
});

test("cancelled pending matches do not hide the alert counter", () => {
  const pending = [{ plaid_transaction_id: "pending-1" }];
  assert.deepEqual(
    unmatchedPendingTransactions([match({ status: "cancelled" })], pending),
    pending,
  );
});

test("a posted replacement remains protected while waiting for review", () => {
  const ready = match({ status: "ready_review", posted_transaction_id: "posted-1" });
  assert.deepEqual(activePendingPlanMatches([ready], []), [ready]);
  assert.equal(pendingMatchStatusLabel(ready), "REVIEW PAYMENT");
});

test("the posted replacement prioritizes the bill chosen while pending", () => {
  const targets = [
    { type: "bill", id: "other", occurrenceDate: "2026-07-29", score: 80, reasons: [] as string[] },
    { type: "bill", id: "bill-1", occurrenceDate: "2026-07-29", score: 20, reasons: ["Close amount"] },
  ];
  const ranked = prioritizePendingPlanTarget(
    targets,
    "posted-1",
    [match({ status: "ready_review", posted_transaction_id: "posted-1" })],
  );
  assert.equal(ranked[0]?.id, "bill-1");
  assert.equal(ranked[0]?.score, 100);
  assert.equal(ranked[0]?.reasons[0], "Matched while pending");
});
