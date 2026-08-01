import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalConnectedAccounts,
  pendingPlaidActivityWithBalanceHolds,
  summarizePendingCheckingActivity,
  unplannedPendingExpenses,
  visiblePendingPlaidActivity,
} from "./plaidActivity";

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

test("a pending charge from an older duplicate link follows the canonical checking account", () => {
  const canonicalAccounts = canonicalConnectedAccounts(duplicateAccounts);
  const pending = pendingPlaidActivityWithBalanceHolds([{
    plaid_transaction_id: "pending-old-link",
    plaid_account_id: "account-old",
    transaction_date: "2026-07-16",
    amount: -51.38,
    name: "CAPITAL ONE - MOBILE PMT.",
  }], duplicateAccounts, "2026-07-16");

  assert.equal(pending.length, 1);
  assert.equal(pending[0].plaid_account_id, "account-new");
  assert.equal(summarizePendingCheckingActivity(pending, canonicalAccounts)?.pendingCount, 1);
  assert.equal(summarizePendingCheckingActivity(pending, canonicalAccounts)?.pendingOutflow, 51.38);
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

test("pending checking summary keeps the bank current and available balances separate", () => {
  const summary = summarizePendingCheckingActivity([{
    plaid_transaction_id: "pending-food",
    plaid_account_id: "checking",
    transaction_date: "2026-07-31",
    amount: -42.75,
    name: "Restaurant",
  }], [{
    id: "checking",
    name: "Checking",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 1000,
    available_balance: 957.25,
    is_active: true,
  }]);

  assert.deepEqual(summary, {
    currentBalance: 1000,
    availableBalance: 957.25,
    pendingOutflow: 42.75,
    pendingInflow: 0,
    pendingCount: 1,
  });
});

test("pending checking summary derives available money only when the bank omits it", () => {
  const summary = summarizePendingCheckingActivity([
    { plaid_transaction_id: "out", plaid_account_id: "checking", transaction_date: "2026-07-31", amount: -25, name: "Fuel" },
    { plaid_transaction_id: "in", plaid_account_id: "checking", transaction_date: "2026-07-31", amount: 10, name: "Refund" },
  ], [{
    id: "checking",
    name: "Checking",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 1000,
    available_balance: null,
    is_active: true,
  }]);

  assert.equal(summary?.availableBalance, 985);
});

test("Flo only calls out real unmatched pending expenses", () => {
  const pending = [
    { plaid_transaction_id: "new-charge", transaction_date: "2026-07-31", amount: -21.43, name: "Drake's" },
    { plaid_transaction_id: "matched-charge", transaction_date: "2026-07-30", amount: -30, name: "Amazon" },
    { plaid_transaction_id: "pending-hold:checking:9.99", transaction_date: "2026-07-31", amount: -9.99, name: "Pending bank hold" },
    { plaid_transaction_id: "refund", transaction_date: "2026-07-31", amount: 12, name: "Refund" },
  ];

  assert.deepEqual(
    unplannedPendingExpenses(pending, ["matched-charge"]).map(row => row.plaid_transaction_id),
    ["new-charge"],
  );
});
