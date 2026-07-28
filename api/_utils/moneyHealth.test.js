const assert = require("node:assert/strict");
const test = require("node:test");

const { auditMoneyHealthData, localDateInZone, localHourInZone } = require("./moneyHealth");

test("a clean matched transaction has a balanced reconciliation", () => {
  const result = auditMoneyHealthData({
    transactions: [{
      id: "tx-1",
      amount: -100,
      review_status: "matched",
      review_allocations: [{ amount: 100 }],
    }],
    reconciliations: [{ transaction_id: "tx-1" }],
  }, new Date("2026-07-28T12:00:00Z"));
  assert.equal(result.status, "clean");
  assert.equal(result.issueCount, 0);
});

test("reports missing undo history and an unbalanced split", () => {
  const result = auditMoneyHealthData({
    transactions: [{
      id: "tx-1",
      amount: -100,
      review_status: "matched",
      review_allocations: [{ amount: 40 }, { amount: 40 }],
    }],
  }, new Date("2026-07-28T12:00:00Z"));
  assert.deepEqual(
    new Set(result.issues.map(item => item.code)),
    new Set(["matched_without_reconciliation", "allocation_mismatch"]),
  );
});

test("reports a pending row that remains after its posted replacement", () => {
  const result = auditMoneyHealthData({
    plaidTransactions: [
      { plaid_transaction_id: "pending-1", pending: true },
      { plaid_transaction_id: "posted-1", pending: false, raw: { pending_transaction_id: "pending-1" } },
    ],
  }, new Date("2026-07-28T12:00:00Z"));
  assert.equal(result.issues[0].code, "stale_pending_transition");
});

test("household timezone helpers select its local audit window", () => {
  const now = new Date("2026-07-28T07:15:00Z");
  assert.equal(localDateInZone("America/Chicago", now), "2026-07-28");
  assert.equal(localHourInZone("America/Chicago", now), 2);
});
