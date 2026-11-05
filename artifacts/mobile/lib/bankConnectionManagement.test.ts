import assert from "node:assert/strict";
import test from "node:test";
import { bankConnectionAccountLabel, bankConnectionConfirmation, bankConnectionSignature, bankConnectionStatusLabel, bankManagementHeaders, parseBankConnections } from "./bankConnectionManagement";

const item = { id: "bank-row", institution_name: "Example Bank", status: "active", can_disconnect: true, initial_import_version: 1, history_status: "complete", last_successful_sync_at: "2026-11-05T18:00:00Z", encrypted_access_token: "never-render" };
const accounts = [
  { id: "checking", plaid_item_record_id: "bank-row", display_name: "Home checking", name: "Provider checking", mask: "123456789", account_type: "depository", account_subtype: "checking", is_active: true, plaid_account_id: "private-provider-id" },
  { id: "credit", plaid_item_record_id: "bank-row", name: "Travel card", mask: "4321", account_type: "credit", account_subtype: "credit card", is_active: true },
  { id: "other", plaid_item_record_id: "other-bank", name: "Unrelated account", mask: "9999", is_active: true },
];

test("management status groups every affected account and discards provider secrets", () => {
  const rows = parseBankConnections({ items: [item], accounts });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.accounts.map(row => row.name), ["Home checking", "Travel card"]);
  assert.equal(bankConnectionAccountLabel(rows[0]!.accounts[0]!), "Home checking · •••• 6789");
  assert.doesNotMatch(JSON.stringify(rows), /never-render|private-provider-id|123456789|Unrelated account/);
  const confirmation = bankConnectionConfirmation(rows[0]!);
  assert.match(confirmation, /entire Example Bank connection/);
  assert.match(confirmation, /Home checking · •••• 6789/);
  assert.match(confirmation, /Travel card · •••• 4321/);
  assert.match(confirmation, /saved transactions, matches, bills, and debts stay/);
});

test("cleanup-needed removed banks stay retryable while fully removed banks stay hidden", () => {
  const rows = parseBankConnections({ items: [{ ...item, status: "removed", disconnect_cleanup_needed: true }, { ...item, id: "removed-bank", status: "removed", disconnect_cleanup_needed: false }], accounts });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.cleanupNeeded, true);
  assert.equal(rows[0]!.canDisconnect, true);
});

test("capability and import progress require explicit server metadata", () => {
  const [row] = parseBankConnections({ items: [{ ...item, initial_import_version: null, can_disconnect: "true", last_successful_sync_at: "invalid" }], accounts });
  assert.equal(row!.canDisconnect, false);
  assert.equal(row!.historyStatus, null);
  assert.equal(row!.lastSuccessfulSync, null);
  assert.equal(bankConnectionStatusLabel("needs_repair"), "Needs attention");
  assert.equal(bankConnectionStatusLabel("unknown-status"), "Status unavailable");
  assert.throws(() => parseBankConnections({ items: [], accounts: null }));
});

test("confirmation signature changes with affected account list and permission", () => {
  const [row] = parseBankConnections({ items: [item], accounts });
  assert.notEqual(bankConnectionSignature(row!), bankConnectionSignature({ ...row!, accounts: row!.accounts.slice(0, 1) }));
  assert.notEqual(bankConnectionSignature(row!), bankConnectionSignature({ ...row!, canDisconnect: false }));
  assert.deepEqual(bankManagementHeaders("fictional-token", "household-a"), { Authorization: "Bearer fictional-token", "X-FlowLedger-Household-Id": "household-a", "Content-Type": "application/json" });
});
