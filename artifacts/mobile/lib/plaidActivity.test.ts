import assert from "node:assert/strict";
import test from "node:test";

import { canonicalConnectedAccounts, visiblePendingPlaidActivity } from "./plaidActivity";

const duplicateAccounts = [
  { id: "account-old", name: "Checking", mask: "1234", account_type: "depository", account_subtype: "checking", is_active: true, updated_at: "2026-07-14T00:00:00Z", current_balance: 2171.13 },
  { id: "account-middle", name: "Checking", mask: "1234", account_type: "depository", account_subtype: "checking", is_active: true, updated_at: "2026-07-15T00:00:00Z", current_balance: 2171.13 },
  { id: "account-new", name: "Checking", mask: "1234", account_type: "depository", account_subtype: "checking", is_active: true, updated_at: "2026-07-16T00:00:00Z", current_balance: 2171.13 },
];

test("one real account linked three times contributes one balance", () => {
  const accounts = canonicalConnectedAccounts(duplicateAccounts);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, "account-new");
  assert.equal(accounts.reduce((sum, account) => sum + account.current_balance, 0), 2171.13);
});

test("one pending charge from duplicate links is shown once", () => {
  const pending = duplicateAccounts.map((account, index) => ({
    plaid_transaction_id: `pending-${index}`,
    plaid_account_id: account.id,
    transaction_date: "2026-07-16",
    amount: -51.38,
    name: "CAPITAL ONE - MOBILE PMT.",
  }));
  assert.equal(visiblePendingPlaidActivity(pending, duplicateAccounts).length, 1);
});

test("two identical charges from one real account remain two charges", () => {
  const account = duplicateAccounts[2];
  const pending = ["first", "second"].map(id => ({
    plaid_transaction_id: id,
    plaid_account_id: account.id,
    transaction_date: "2026-07-16",
    amount: -51.38,
    name: "CAPITAL ONE - MOBILE PMT.",
  }));
  assert.equal(visiblePendingPlaidActivity(pending, [account]).length, 2);
});

test("identical charges on two different real accounts remain separate", () => {
  const accounts = [
    duplicateAccounts[0],
    { ...duplicateAccounts[0], id: "other-account", mask: "9876" },
  ];
  const pending = accounts.map((account, index) => ({
    plaid_transaction_id: `pending-${index}`,
    plaid_account_id: account.id,
    transaction_date: "2026-07-16",
    amount: -51.38,
    name: "CAPITAL ONE - MOBILE PMT.",
  }));
  assert.equal(visiblePendingPlaidActivity(pending, accounts).length, 2);
});
