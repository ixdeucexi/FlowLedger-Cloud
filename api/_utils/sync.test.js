const assert = require("node:assert/strict");
const test = require("node:test");

const {
  duplicatePlaidAccountIds,
  editablePlaidFields,
  plaidAccountIdentity,
  persistCanonicalPlaidTransaction,
  stablePlaidFingerprint,
  shouldImportPlaidTransaction,
  shouldQueuePendingNotification,
  shouldQueuePostedNotification,
} = require("./sync");

test("overlapping Plaid webhook inserts are idempotent", async () => {
  const calls = [];
  const db = {
    from(table) {
      assert.equal(table, "transactions");
      return {
        async upsert(row, options) {
          calls.push({ row, options });
          return { error: null };
        },
      };
    },
  };
  const canonicalRow = { id: "plaid:user-1:transaction-1", user_id: "user-1" };

  await persistCanonicalPlaidTransaction({ db, existing: null, canonicalRow, userId: "user-1" });

  assert.deepEqual(calls, [{
    row: canonicalRow,
    options: { onConflict: "id", ignoreDuplicates: true },
  }]);
});

test("Plaid account identity falls back to institution, mask, type, and name", () => {
  const account = { id: "account-1", mask: "1234", account_type: "depository", account_subtype: "checking", name: "Checking" };
  assert.equal(plaidAccountIdentity(account, "ins_1"), "fallback:ins_1:1234:depository:checking:checking");
  assert.notEqual(plaidAccountIdentity(account, "ins_1"), plaidAccountIdentity(account, "ins_2"));
});

test("duplicate bank links keep the existing Plaid item account", () => {
  const accounts = [
    { id: "account-retired", user_id: "user-1", plaid_item_id: "item-retired", mask: "1234", account_type: "depository", account_subtype: "checking", name: "Checking", is_active: false, created_at: "2026-07-12T00:00:00Z" },
    { id: "account-old", user_id: "user-1", plaid_item_id: "item-old", mask: "1234", account_type: "depository", account_subtype: "checking", name: "Checking", is_active: true, created_at: "2026-07-14T00:00:00Z" },
    { id: "account-new", user_id: "user-1", plaid_item_id: "item-new", mask: "1234", account_type: "depository", account_subtype: "checking", name: "Checking", is_active: true, created_at: "2026-07-16T00:00:00Z" },
  ];
  const items = new Map([
    ["item-retired", { institution_id: "ins_1", created_at: "2026-07-12T00:00:00Z" }],
    ["item-old", { institution_id: "ins_1", created_at: "2026-07-14T00:00:00Z" }],
    ["item-new", { institution_id: "ins_1", created_at: "2026-07-16T00:00:00Z" }],
  ]);
  assert.deepEqual(duplicatePlaidAccountIds(accounts, items), ["account-new"]);
});

test("Plaid fingerprints ignore only connection-specific IDs", () => {
  const first = {
    account_id: "account-old",
    transaction_id: "transaction-old",
    pending_transaction_id: "pending-old",
    amount: 51.38,
    date: "2026-07-16",
    merchant_name: "Capital One",
    personal_finance_category: { detailed: "LOAN_PAYMENTS_CAR_PAYMENT", primary: "LOAN_PAYMENTS" },
  };
  const copy = {
    personal_finance_category: { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CAR_PAYMENT" },
    merchant_name: "Capital One",
    date: "2026-07-16",
    amount: 51.38,
    pending_transaction_id: "pending-new",
    transaction_id: "transaction-new",
    account_id: "account-new",
  };
  assert.equal(stablePlaidFingerprint(first), stablePlaidFingerprint(copy));
  assert.notEqual(stablePlaidFingerprint(first), stablePlaidFingerprint({ ...copy, amount: 52.38 }));
});

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
