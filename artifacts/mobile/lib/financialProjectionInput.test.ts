import assert from "node:assert/strict";
import test from "node:test";
import { accountAwareTransactionCollections, checkingPendingBankRows, depositoryPendingBankRows, normalizeConnectedBankRows, normalizePendingBankRows } from "./financialProjectionInput";

const accounts = normalizeConnectedBankRows([
  { id: "checking-row", plaid_account_id: "checking-provider", name: "Checking", account_type: "depository", account_subtype: "checking", is_active: true },
  { id: "savings-row", plaid_account_id: "savings-provider", name: "Savings", account_type: "depository", account_subtype: "savings", is_active: false },
  { id: "credit-row", plaid_account_id: "credit-provider", name: "Credit", account_type: "credit", account_subtype: "credit card", is_active: true },
]);

test("state collections retain savings activity and deleted posted history before operating cash filtering", () => {
  const make = (id: string, plaid_account_id: string) => ({ id, date: "2026-11-01", amount: "-25", source: "plaid", plaid_account_id });
  const collections = accountAwareTransactionCollections([
    make("checking", "checking-provider"), make("savings", "savings-provider"),
    { ...make("deleted-savings", "savings-provider"), deleted_at: "2026-11-02" },
    make("credit", "credit-provider"), make("unknown", "missing"),
    { ...make("pending-savings", "savings-provider"), pending: true },
    { ...make("removed-savings", "savings-provider"), removed_at: "2026-11-02" },
  ], accounts);
  assert.deepEqual(collections.active.map(row => row.id), ["checking", "savings"]);
  assert.deepEqual(collections.deleted.map(row => row.id), ["deleted-savings"]);
  assert.deepEqual(collections.unknownPlaid.map(row => row.id), ["unknown"]);
  assert.equal(collections.active[1].amount, -25);
});

test("pending depository rows accept exact retained row IDs while legacy pending cash remains checking-only", () => {
  const rows = normalizePendingBankRows(["checking-row", "savings-row", "credit-row", "missing"].map((plaid_account_id, id) =>
    ({ plaid_account_id, plaid_transaction_id: String(id), transaction_date: "2026-11-01", amount: -25 })));
  assert.deepEqual(depositoryPendingBankRows(rows, accounts), { included: rows.slice(0, 2), unknownCount: 1 });
  assert.deepEqual(checkingPendingBankRows(rows, accounts), { included: rows.slice(0, 1), unknownCount: 1 });
  const conflicting = [...accounts, { ...accounts[1], id: "different-row" }];
  const providerRows = normalizePendingBankRows([{ plaid_account_id: "savings-provider", plaid_transaction_id: "savings", transaction_date: "2026-11-01", amount: -25 }]);
  assert.deepEqual(depositoryPendingBankRows(providerRows, conflicting), { included: [], unknownCount: 1 });
});
