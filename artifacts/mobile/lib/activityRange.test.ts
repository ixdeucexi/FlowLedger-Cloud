import assert from "node:assert/strict";
import test from "node:test";

import {
  activityManualAccountAllowsChecking,
  activityRunningBalances,
  activityRunningBalancesFromDatedAnchor,
  activityTransactionUsesCheckingLedger,
  dateIsInActivityRange,
  resolveActivityDateRange,
  summarizeActivityRange,
  summarizeActivitySnapshot,
} from "./activityRange";
import { isCheckingBalanceTransaction } from "./billMatching";
import { selectFlowLedgerTransactions } from "./ledgerEngine";

const today = new Date(2026, 7, 5, 12);

test("resolves every common Activity period using local calendar dates", () => {
  assert.deepEqual(resolveActivityDateRange("today", today), {
    id: "today",
    label: "Today",
    startDate: "2026-08-05",
    endDate: "2026-08-05",
  });
  assert.deepEqual(resolveActivityDateRange("last_month", today), {
    id: "last_month",
    label: "Last Month",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  });
  assert.equal(
    resolveActivityDateRange("last_90_days", today).startDate,
    "2026-05-08",
  );
});

test("supports all time and inclusive custom ranges", () => {
  const allTime = resolveActivityDateRange("all_time", today);
  assert.equal(dateIsInActivityRange("2019-01-01", allTime), true);
  const custom = resolveActivityDateRange(
    "custom",
    today,
    "2025-12-30",
    "2026-01-02",
  );
  assert.equal(dateIsInActivityRange("2026-01-02", custom), true);
  assert.equal(dateIsInActivityRange("2026-01-03", custom), false);
});

test("range totals exclude pending rows and transfers", () => {
  assert.deepEqual(
    summarizeActivityRange([
      { amount: 1200 },
      { amount: -200 },
      { amount: -50, source: "transfer" },
      { amount: -75, pending: true },
    ]),
    { income: 1200, out: 200, net: 1000, transactions: 3 },
  );
});

test("the unfiltered monthly snapshot uses the full plan instead of one visible bill", () => {
  const visibleRows = [{ amount: -150, source: "bill_payment" }];
  const plannedMonth = { income: 4000, out: 1350, net: 2650 };

  assert.deepEqual(summarizeActivitySnapshot(visibleRows, plannedMonth), {
    income: 4000,
    out: 1350,
    net: 2650,
    transactions: 1,
  });
  assert.deepEqual(summarizeActivitySnapshot(visibleRows), {
    income: 0,
    out: 150,
    net: -150,
    transactions: 1,
  });
});

test("activity running balances are derived from the complete ledger before display filters", () => {
  const completeLedger = [
    { id: "tx-newest", date: "2026-08-25", amount: -25 },
    { id: "tx-income", date: "2026-08-24", amount: 100 },
    { id: "tx-oldest", date: "2026-08-23", amount: -10 },
  ];

  const balances = activityRunningBalances(500, completeLedger);

  assert.equal(balances.get("tx-newest"), 500);
  assert.equal(balances.get("tx-income"), 525);
  assert.equal(balances.get("tx-oldest"), 425);
  assert.equal(activityRunningBalances(null, completeLedger).size, 0);
});

test("posted unreviewed checking activity stays in running balances while non-checking history stays out", () => {
  const retainedAccounts = [
    {
      id: "checking-row",
      plaid_account_id: "checking-1",
      account_type: "depository",
      account_subtype: "checking",
      is_active: true,
    },
    {
      id: "card-row",
      plaid_account_id: "card-1",
      account_type: "credit",
      account_subtype: "credit card",
      is_active: true,
    },
    {
      id: "savings-row",
      plaid_account_id: "savings-1",
      account_type: "depository",
      account_subtype: "savings",
      is_active: true,
    },
    {
      id: "old-checking-row",
      plaid_account_id: "old-checking-1",
      account_type: "depository",
      account_subtype: "checking",
      is_active: false,
    },
  ];
  const rawHistory = [
    {
      id: "unreviewed-checking",
      date: "2026-08-25",
      amount: -25,
      source: "plaid",
      plaid_account_id: "checking-1",
      review_status: "needs_review",
    },
    {
      id: "older-reviewed",
      date: "2026-08-24",
      amount: -10,
      source: "plaid",
      plaid_account_id: "checking-1",
      review_status: "categorized",
    },
    {
      id: "credit-card",
      date: "2026-08-23",
      amount: -80,
      source: "plaid",
      plaid_account_id: "card-1",
    },
    {
      id: "savings",
      date: "2026-08-22",
      amount: 300,
      source: "plaid",
      plaid_account_id: "savings-1",
    },
    {
      id: "unknown",
      date: "2026-08-21",
      amount: -40,
      source: "plaid",
      plaid_account_id: "missing-account",
    },
    {
      id: "historical-deposit",
      date: "2026-08-20",
      amount: 125,
      source: "plaid",
      plaid_account_id: "old-checking-1",
      review_status: "categorized",
    },
  ];

  const selected = selectFlowLedgerTransactions(
    rawHistory,
    retainedAccounts,
  );
  assert.deepEqual(
    selected.included.map((transaction) => transaction.id),
    ["unreviewed-checking", "older-reviewed", "historical-deposit"],
  );
  assert.deepEqual(
    selected.excludedNonCash.map((transaction) => transaction.id),
    ["credit-card", "savings"],
  );
  assert.deepEqual(
    selected.unknownPlaid.map((transaction) => transaction.id),
    ["unknown"],
  );

  const ledgerRows = selected.included
    .filter((transaction) =>
      isCheckingBalanceTransaction(transaction, retainedAccounts),
    )
    .map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      amount: transaction.amount,
    }));
  const balances = activityRunningBalances(500, ledgerRows);
  assert.equal(balances.get("unreviewed-checking"), 500);
  assert.equal(balances.get("older-reviewed"), 525);
  assert.equal(
    isCheckingBalanceTransaction(
      selected.included.find(
        (transaction) => transaction.id === "historical-deposit",
      )!,
      retainedAccounts,
    ),
    true,
  );
});

test("same-day running balances stay hidden when row order is unknowable", () => {
  const balances = activityRunningBalances(1000, [
    { id: "same-day-out", date: "2026-08-25", amount: -25 },
    { id: "same-day-in", date: "2026-08-25", amount: 100 },
    { id: "prior-day", date: "2026-08-24", amount: -10 },
  ]);

  assert.equal(balances.has("same-day-out"), false);
  assert.equal(balances.has("same-day-in"), false);
  assert.equal(balances.get("prior-day"), 925);
});

test("dated running balances advance only from transactions after the observation", () => {
  const balances = activityRunningBalancesFromDatedAnchor(
    { balance: 1000, date: "2026-08-20" },
    [
      { id: "anchor-day", date: "2026-08-20", amount: -25 },
      { id: "next-day", date: "2026-08-21", amount: -100 },
      { id: "latest", date: "2026-08-22", amount: 50 },
    ],
  );

  assert.equal(balances.has("anchor-day"), false);
  assert.equal(balances.get("latest"), 950);
  assert.equal(balances.get("next-day"), 900);
});

test("manual savings assignments never enter a checking running balance", () => {
  const manualAccounts = [
    { id: "checking", account_type: "checking", is_active: true },
    { id: "savings", account_type: "savings", is_active: true },
  ];

  assert.equal(
    activityManualAccountAllowsChecking(
      { source: "manual", account_id: "checking" },
      manualAccounts,
    ),
    true,
  );
  assert.equal(
    activityManualAccountAllowsChecking(
      { source: "manual", account_id: "savings" },
      manualAccounts,
    ),
    false,
  );
  assert.equal(
    activityManualAccountAllowsChecking(
      { source: "manual", account_id: "missing" },
      manualAccounts,
    ),
    false,
  );
  assert.equal(
    activityManualAccountAllowsChecking({ source: "manual" }, manualAccounts),
    true,
  );
  assert.equal(
    activityTransactionUsesCheckingLedger(
      { source: "manual", account_id: "checking" },
      manualAccounts,
      false,
    ),
    true,
  );
  assert.equal(
    activityTransactionUsesCheckingLedger(
      { source: "manual", account_id: "savings" },
      manualAccounts,
      false,
    ),
    false,
  );
  assert.equal(
    activityTransactionUsesCheckingLedger(
      { source: "manual" },
      manualAccounts,
      false,
    ),
    false,
  );
});
