import assert from "node:assert/strict";
import test from "node:test";
import {
  activePendingPlanMatches,
  debtSourceCommitmentsForDebts,
  debtSourceCommitmentsFromPendingMatches,
  livePendingPlanMatchForOccurrence,
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
  assert.equal(livePendingPlanMatchForOccurrence(matches, pending, "bill-1", "2026-07-29")?.pending_amount, 98);
});

test("debt source commitments distinguish live pending, vanished, and posted review states", () => {
  const pending = [{ plaid_transaction_id: "pending-1" }];
  assert.deepEqual(debtSourceCommitmentsFromPendingMatches([match({ pending_amount: 42.81 })], pending, []), [{
    sourceBillId: "bill-1", sourceBillName: "Electric", date: "2026-07-29", amount: 42.81, state: "pending",
  }]);
  assert.deepEqual(debtSourceCommitmentsFromPendingMatches([match()], [], []), []);
  assert.deepEqual(debtSourceCommitmentsFromPendingMatches([
    match({ status: "ready_review", posted_transaction_id: "posted-1" }),
  ], [], [{ id: "posted-1" }]), [{
    sourceBillId: "bill-1", sourceBillName: "Electric", date: "2026-07-29", amount: 0, state: "posted",
  }]);
});

test("a reviewed posted replacement stops suppressing the remaining debt obligation", () => {
  const ready = match({ status: "ready_review", posted_transaction_id: "posted-1" });

  assert.deepEqual(
    debtSourceCommitmentsFromPendingMatches([ready], [], [{ id: "posted-1", review_status: "matched" }]),
    [],
  );
  assert.deepEqual(
    debtSourceCommitmentsFromPendingMatches([ready], [], [{ id: "posted-1", review_status: "categorized" }]),
    [],
  );
  assert.deepEqual(
    debtSourceCommitmentsFromPendingMatches([ready], [], [{ id: "posted-1", review_status: "needs_review" }]),
    [{
      sourceBillId: "bill-1", sourceBillName: "Electric", date: "2026-07-29", amount: 0, state: "posted",
    }],
  );
});

test("a posted replacement keeps its real amount while waiting for review", () => {
  const ready = match({
    status: "ready_review",
    posted_transaction_id: "posted-1",
    posted_amount: 114,
  });
  assert.deepEqual(
    debtSourceCommitmentsFromPendingMatches([ready], [], [{ id: "posted-1", review_status: "needs_review" }]),
    [{
      sourceBillId: "bill-1",
      sourceBillName: "Electric",
      date: "2026-07-29",
      amount: 114,
      state: "posted",
    }],
  );
});

test("same-occurrence pending matches aggregate and a posted replacement wins deterministically", () => {
  const pending = [{ plaid_transaction_id: "pending-1" }, { plaid_transaction_id: "pending-2" }];
  const first = match({ id: "first", pending_amount: 20 });
  const second = match({ id: "second", pending_plaid_transaction_id: "pending-2", pending_amount: 22.81 });
  assert.deepEqual(debtSourceCommitmentsFromPendingMatches([first, second], pending, []), [{
    sourceBillId: "bill-1", sourceBillName: "Electric", date: "2026-07-29", amount: 42.81, state: "pending",
  }]);

  const posted = match({ id: "posted", status: "ready_review", posted_transaction_id: "posted-1" });
  assert.deepEqual(debtSourceCommitmentsFromPendingMatches([second, posted, first], pending, [{ id: "posted-1" }]), [{
    sourceBillId: "bill-1", sourceBillName: "Electric", date: "2026-07-29", amount: 0, state: "posted",
  }]);
});

test("only matched debts become debt-plan commitments", () => {
  const pending = [{ plaid_transaction_id: "pending-1" }];
  const ordinaryBill = { id: "bill-1", name: "YMCA", balance: 0, is_debt: false };
  assert.deepEqual(
    debtSourceCommitmentsForDebts([match({ target_name: "YMCA" })], pending, [], [ordinaryBill]),
    [],
  );

  const debt = { ...ordinaryBill, name: "Camera", balance: 42.81, is_debt: true };
  assert.deepEqual(
    debtSourceCommitmentsForDebts([match({ target_name: "Camera", pending_amount: 42.81 })], pending, [], [debt]),
    [{
      sourceBillId: "bill-1",
      sourceBillName: "Camera",
      sourceBalance: 42.81,
      date: "2026-07-29",
      amount: 42.81,
      state: "pending",
    }],
  );
});

test("a pending manual Activity match never becomes a second debt-plan commitment", () => {
  const pending = [{ plaid_transaction_id: "pending-1" }];
  const manual = match({ target_type: "manual", target_id: "manual-57", target_name: "James shoes" });
  assert.deepEqual(debtSourceCommitmentsFromPendingMatches([manual], pending, []), []);
  assert.equal(livePendingPlanMatchForOccurrence([manual], pending, "manual-57", "2026-07-29"), undefined);
  assert.deepEqual(unmatchedPendingTransactions([manual], pending), []);
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
