const assert = require("node:assert/strict");
const test = require("node:test");

const {
  editablePlaidFields,
  shouldImportPlaidTransaction,
  shouldQueuePendingNotification,
  shouldQueuePostedNotification,
} = require("./sync");

test("only posted Plaid activity becomes a FlowLedger transaction", () => {
  assert.equal(shouldImportPlaidTransaction({ pending: true }), false);
  assert.equal(shouldImportPlaidTransaction({ pending: false }), true);
  assert.equal(shouldImportPlaidTransaction({}), true);
});

test("later Plaid syncs preserve fields the user edited", () => {
  const imported = { date: "2026-07-08", category: "Utilities", note: "Apple" };
  assert.deepEqual(editablePlaidFields(null, imported), { ...imported, user_edited_at: null });
  assert.deepEqual(editablePlaidFields({
    date: "2026-07-01",
    category: "Debt",
    note: "Tia Game",
    user_edited_at: "2026-07-15T15:00:00.000Z",
  }, imported), {
    date: "2026-07-01",
    category: "Debt",
    note: "Tia Game",
    user_edited_at: "2026-07-15T15:00:00.000Z",
  });
});

test("only a newly posted transaction after the initial cursor queues a phone notification", () => {
  const posted = { flowledgerId: "plaid:user:posted", isNewPosted: true };
  assert.equal(shouldQueuePostedNotification("cursor-1", posted), true);
  assert.equal(shouldQueuePostedNotification(null, posted), false);
  assert.equal(shouldQueuePostedNotification("cursor-1", { ...posted, isNewPosted: false }), false);
});

test("only newly seen pending activity after the initial cursor queues a pending alert", () => {
  const pending = { plaidTransactionId: "pending-1", isNewPending: true };
  assert.equal(shouldQueuePendingNotification("cursor-1", pending), true);
  assert.equal(shouldQueuePendingNotification(null, pending), false);
  assert.equal(shouldQueuePendingNotification("cursor-1", { ...pending, isNewPending: false }), false);
});
