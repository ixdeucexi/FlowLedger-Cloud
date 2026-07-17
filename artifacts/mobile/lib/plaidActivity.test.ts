import assert from "node:assert/strict";
import test from "node:test";

import { canonicalConnectedAccounts, pendingPlaidActivityWithBalanceHolds, visiblePendingPlaidActivity } from "./plaidActivity";

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

test("checking available balance difference creates one inferred pending hold", () => {
  const pending = pendingPlaidActivityWithBalanceHolds([], [{
    id: "checking",
    name: "Bill Account",
    mask: "3673",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 2119.75,
    available_balance: 2109.76,
    is_active: true,
    updated_at: "2026-07-17T12:00:00Z",
  }], "2026-07-17");

  assert.equal(pending.length, 1);
  assert.equal(pending[0].name, "Pending bank hold");
  assert.equal(pending[0].amount, -9.99);
  assert.equal(pending[0].category, "Pending");
});

test("savings available balance difference is not shown as checking activity", () => {
  const pending = pendingPlaidActivityWithBalanceHolds([], [{
    id: "savings",
    name: "Savings-Sinking Act",
    mask: "0656",
    account_type: "depository",
    account_subtype: "savings",
    current_balance: 297.86,
    available_balance: 292.86,
    is_active: true,
    updated_at: "2026-07-17T12:00:00Z",
  }], "2026-07-17");

  assert.equal(pending.length, 0);
});

test("inferred pending hold is not added when Plaid already supplied the pending row", () => {
  const account = {
    id: "checking",
    name: "Bill Account",
    mask: "3673",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 2119.75,
    available_balance: 2109.76,
    is_active: true,
    updated_at: "2026-07-17T12:00:00Z",
  };
  const pending = pendingPlaidActivityWithBalanceHolds([{
    plaid_transaction_id: "pending-apple",
    plaid_account_id: account.id,
    transaction_date: "2026-07-17",
    amount: -9.99,
    name: "Apple",
    category: "GENERAL_MERCHANDISE",
  }], [account], "2026-07-17");

  assert.equal(pending.length, 1);
  assert.equal(pending[0].name, "Apple");
});
