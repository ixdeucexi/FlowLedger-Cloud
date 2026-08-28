import assert from "node:assert/strict";
import test from "node:test";

import { buildTransactionLedger, remainingPlannedAmount, selectFlowLedgerTransactions } from "./ledgerEngine";

const checking = [{
  plaid_account_id: "checking-1",
  account_type: "depository",
  account_subtype: "checking",
  is_active: true,
}];

test("posted bank activity changes cash before review", () => {
  const transaction = {
    id: "posted",
    date: "2026-07-28",
    amount: -25,
    source: "plaid",
    plaid_transaction_id: "plaid-1",
    plaid_account_id: "checking-1",
    review_status: "needs_review",
  };
  const ledger = buildTransactionLedger([transaction], [transaction], checking);
  assert.equal(ledger.cashByDate.get("2026-07-28"), -25);
  assert.equal(ledger.visibleCheckingTransactions.length, 1);
});

test("pending and removed activity never changes cash", () => {
  const pending = { id: "pending", date: "2026-07-28", amount: -25, pending: true };
  const removed = { id: "removed", date: "2026-07-28", amount: -30, removed_at: "2026-07-28T10:00:00Z" };
  const ledger = buildTransactionLedger([pending, removed], [pending, removed], checking);
  assert.equal(ledger.cashTransactions.length, 0);
  assert.equal(ledger.visibleTransactions.length, 0);
});

test("a deleted posted bank row stays in cash history but not visible activity", () => {
  const hidden = {
    id: "hidden-posted",
    date: "2026-07-20",
    amount: -287.52,
    source: "plaid",
    plaid_transaction_id: "geico",
    plaid_account_id: "checking-1",
    deleted_at: "2026-07-21T00:00:00Z",
  };
  const ledger = buildTransactionLedger([hidden], [], checking);
  assert.equal(ledger.cashTransactions.length, 1);
  assert.equal(ledger.visibleTransactions.length, 0);
});

test("transfer counts only on the checking side", () => {
  const savings = {
    id: "savings-side",
    date: "2026-07-28",
    amount: 100,
    source: "plaid",
    plaid_account_id: "savings-1",
    review_status: "transfer",
  };
  const checkingSide = {
    id: "checking-side",
    date: "2026-07-28",
    amount: -100,
    source: "plaid",
    plaid_account_id: "checking-1",
    review_status: "transfer",
  };
  const ledger = buildTransactionLedger(
    [savings, checkingSide],
    [savings, checkingSide],
    [...checking, {
      plaid_account_id: "savings-1",
      account_type: "depository",
      account_subtype: "savings",
      is_active: true,
    }],
  );
  assert.equal(ledger.cashTransactions.length, 1);
  assert.equal(ledger.cashByDate.get("2026-07-28"), -100);
});

test("credit-card purchases stay out of Activity and checking cash before and after review", () => {
  const purchase = {
    id: "card-purchase",
    date: "2026-08-04",
    amount: -72.15,
    source: "plaid",
    plaid_account_id: "card-1",
    review_status: "categorized",
  };
  const ledger = buildTransactionLedger([purchase], [purchase], [...checking, {
    plaid_account_id: "card-1",
    account_type: "credit",
    account_subtype: "credit card",
    is_active: true,
  }]);
  assert.deepEqual(ledger.visibleTransactions.map(transaction => transaction.id), []);
  assert.equal(ledger.visibleCheckingTransactions.length, 0);
  assert.equal(ledger.cashTransactions.length, 0);
  assert.equal(ledger.cashByDate.size, 0);
});

test("inactive and reconnected card identities remain excluded by the shared selector", () => {
  const transactions = [
    { id: "old-card", date: "2026-07-01", amount: -10, source: "plaid", plaid_account_id: "card-external-old", review_status: "needs_review" },
    { id: "new-card", date: "2026-07-02", amount: -20, source: "plaid", plaid_account_id: "card-external-new", review_status: "categorized" },
  ];
  const selection = selectFlowLedgerTransactions(transactions, [
    { id: "card-row-old", plaid_account_id: "card-external-old", account_type: "credit", account_subtype: "credit card", is_active: false },
    { id: "card-row-new", plaid_account_id: "card-external-new", account_type: "credit", account_subtype: "credit card", is_active: true },
  ]);
  assert.equal(selection.included.length, 0);
  assert.deepEqual(selection.excludedNonCash.map(transaction => transaction.id), ["old-card", "new-card"]);
});

test("unknown Plaid accounts fail closed with a ledger diagnostic", () => {
  const unknown = { id: "unknown", date: "2026-07-03", amount: -40, source: "plaid", plaid_account_id: "not-loaded" };
  const ledger = buildTransactionLedger([unknown], [unknown], checking);
  assert.equal(ledger.cashTransactions.length, 0);
  assert.equal(ledger.visibleTransactions.length, 0);
  assert.deepEqual(ledger.issues.map(issue => issue.code), ["unknown_plaid_account"]);
});

test("thirteen card purchases add zero cash and Aug 10 closes at 2369.46", () => {
  const legitimateChecking = {
    id: "legitimate-net",
    date: "2026-08-10",
    amount: -638.30,
    source: "plaid",
    plaid_account_id: "checking-1",
  };
  const cardPurchases = Array.from({ length: 13 }, (_, index) => ({
    id: `card-${index}`,
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    amount: index === 12 ? -113.38 : -60,
    source: "plaid",
    plaid_account_id: "card-1",
    review_status: index % 2 ? "categorized" : "needs_review",
  }));
  assert.equal(cardPurchases.reduce((sum, transaction) => sum + transaction.amount, 0), -833.38);
  const ledger = buildTransactionLedger(
    [legitimateChecking, ...cardPurchases],
    [legitimateChecking, ...cardPurchases],
    [...checking, { plaid_account_id: "card-1", account_type: "credit", account_subtype: "credit card", is_active: true }],
  );
  assert.equal(cardPurchases.reduce((sum, transaction) => sum + (ledger.cashTransactions.includes(transaction) ? transaction.amount : 0), 0), 0);
  assert.equal(Math.round((3007.76 + [...ledger.cashByDate.values()].reduce((sum, amount) => sum + amount, 0)) * 100) / 100, 2369.46);
});

test("a card payment counts only on its checking side", () => {
  const checkingSide = { id: "checking-payment", date: "2026-08-10", amount: -127, source: "plaid", plaid_account_id: "checking-1", review_status: "transfer" };
  const cardSide = { id: "card-payment", date: "2026-08-10", amount: 127, source: "plaid", plaid_account_id: "card-1", review_status: "transfer" };
  const ledger = buildTransactionLedger(
    [checkingSide, cardSide],
    [checkingSide, cardSide],
    [...checking, { plaid_account_id: "card-1", account_type: "credit", account_subtype: "credit card", is_active: true }],
  );
  assert.deepEqual(ledger.cashTransactions.map(transaction => transaction.id), ["checking-payment"]);
  assert.equal(ledger.cashByDate.get("2026-08-10"), -127);
});

test("matched plans are replaced and partial matches leave only the open amount", () => {
  assert.equal(remainingPlannedAmount(100), 100);
  assert.equal(remainingPlannedAmount(100, { amount: 100, settlement: "exact" }), 0);
  assert.equal(remainingPlannedAmount(100, { amount: 60, settlement: "partial" }), 40);
  assert.equal(remainingPlannedAmount(100, { amount: 60, plannedAmount: 120, settlement: "partial" }), 60);
});

test("duplicate bank IDs and unbalanced splits are reported without double-counting the same row ID", () => {
  const first = {
    id: "one",
    date: "2026-07-28",
    amount: -50,
    source: "plaid",
    plaid_transaction_id: "duplicate",
    plaid_account_id: "checking-1",
    review_status: "matched",
    review_allocations: [{ amount: 20 }, { amount: 20 }],
  };
  const second = { ...first, id: "two" };
  const ledger = buildTransactionLedger([first, first, second], [first, second], checking);
  assert.equal(ledger.cashTransactions.length, 2);
  assert.deepEqual(
    new Set(ledger.issues.map(issue => issue.code)),
    new Set(["duplicate_transaction_id", "duplicate_plaid_transaction_id", "allocation_mismatch"]),
  );
});

test("the fused ledger pass preserves mixed cash, visibility, and diagnostic ordering", () => {
  const accounts = [
    ...checking,
    { plaid_account_id: "card-1", account_type: "credit", account_subtype: "credit card", is_active: true },
  ];
  const rows = [
    { id: "active", date: "2026-08-01", amount: -10, source: "plaid", plaid_account_id: "checking-1", plaid_transaction_id: "p1" },
    { id: "deleted", date: "2026-08-02", amount: -20, source: "plaid", plaid_account_id: "checking-1", plaid_transaction_id: "p2", deleted_at: "2026-08-03" },
    { id: "card", date: "2026-08-03", amount: -30, source: "plaid", plaid_account_id: "card-1" },
    { id: "unknown", date: "2026-08-04", amount: -40, source: "plaid", plaid_account_id: "missing" },
    { id: "hidden-import", date: "2026-08-05", amount: -5, source: "statement", import_hash: "row-5", deleted_at: "2026-08-06" },
    { id: "transfer", date: "2026-08-06", amount: -6, review_status: "transfer" },
    { id: "pending", date: "2026-08-07", amount: -7, source: "plaid", plaid_account_id: "checking-1", pending: true },
    { id: "removed", date: "2026-08-08", amount: -8, source: "plaid", plaid_account_id: "checking-1", removed_at: "2026-08-09" },
    { id: "mismatch", date: "2026-08-09", amount: -8, source: "plaid", plaid_account_id: "checking-1", plaid_transaction_id: "duplicate-bank", review_status: "matched", review_allocations: [{ amount: 3 }] },
    { id: "duplicate-bank-row", date: "2026-08-10", amount: -4, source: "plaid", plaid_account_id: "checking-1", plaid_transaction_id: "duplicate-bank" },
  ];
  const allRows = [...rows, rows[0]];
  const ledger = buildTransactionLedger(allRows, rows, accounts);

  assert.deepEqual(
    ledger.cashTransactions.map(transaction => transaction.id),
    ["active", "deleted", "hidden-import", "mismatch", "duplicate-bank-row"],
  );
  assert.deepEqual(
    ledger.visibleTransactions.map(transaction => transaction.id),
    ["active", "transfer", "mismatch", "duplicate-bank-row"],
  );
  assert.deepEqual(
    ledger.visibleCheckingTransactions.map(transaction => transaction.id),
    ["active", "mismatch", "duplicate-bank-row"],
  );
  assert.deepEqual(
    ledger.issues.map(issue => issue.code),
    [
      "allocation_mismatch",
      "duplicate_plaid_transaction_id",
      "duplicate_transaction_id",
      "unknown_plaid_account",
    ],
  );
  assert.equal(
    [...ledger.cashByDate.values()].reduce((sum, amount) => sum + amount, 0),
    -47,
  );
});
