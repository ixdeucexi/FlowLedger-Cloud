import test from "node:test";
import assert from "node:assert/strict";
import { bankBalanceAdjustment, connectedCheckingAnchor, connectedCheckingBalance, connectedCheckingObservedAnchor, evaluateForecastConfidence, historicalMonthOpeningBalance, operatingAccountAnchor, parseStatementCsv, totalForecastBalance, type AccountSnapshot } from "./accounts";

const accounts: AccountSnapshot[] = [
  { id: "checking", name: "Checking", type: "checking", currentBalance: 1200, balanceAsOf: "2026-06-23", lastReconciledAt: "2026-06-23", active: true },
  { id: "savings", name: "Savings", type: "savings", currentBalance: 300, balanceAsOf: "2026-06-23", lastReconciledAt: "2026-06-23", active: true },
];

test("account total combines checking and savings", () => assert.equal(totalForecastBalance(accounts), 1500));
test("calendar anchor uses checking cash without pulling savings into spendable money", () => {
  assert.deepEqual(operatingAccountAnchor(accounts), { balance: 1200, date: "2026-06-23" });
});
test("calendar anchor never pulls a savings-only balance into spendable money", () => {
  assert.equal(operatingAccountAnchor([accounts[1]]), null);
});
test("calendar anchor includes active cash without treating savings as cash", () => {
  const cash: AccountSnapshot = { id: "cash", name: "Wallet", type: "cash", currentBalance: 45, balanceAsOf: "2026-06-24", active: true };
  assert.deepEqual(operatingAccountAnchor([accounts[1], cash]), { balance: 45, date: "2026-06-24" });
});
test("connected checking uses the same balance for dashboard and calendar", () => {
  const connected = [
    { account_subtype: "checking", current_balance: 800, is_active: true },
    { account_subtype: "checking", current_balance: 200, is_active: true },
    { account_subtype: "savings", current_balance: 5000, is_active: true },
  ];
  assert.equal(connectedCheckingBalance(connected), 1000);
  assert.deepEqual(connectedCheckingAnchor(connected, "2026-07-17"), { balance: 1000, date: "2026-07-17" });
});

test("an unavailable connected checking balance is not treated as a verified zero", () => {
  const connected = [
    {
      account_subtype: "checking",
      current_balance: 0,
      current_balance_available: false,
      is_active: true,
      updated_at: "2026-08-25T02:30:00.000Z",
    },
  ];
  assert.equal(connectedCheckingBalance(connected), null);
  assert.equal(connectedCheckingObservedAnchor(connected, "America/Chicago"), null);
});

test("connected checking anchor uses the bank observation date instead of the device date", () => {
  const connected = [
    { account_subtype: "checking", current_balance: 800, is_active: true, updated_at: "2026-08-25T02:30:00.000Z" },
    { account_subtype: "checking", current_balance: 200, is_active: true, updated_at: "2026-08-25T02:29:00.000Z" },
  ];
  assert.deepEqual(connectedCheckingObservedAnchor(connected, "America/Chicago"), {
    balance: 1000,
    date: "2026-08-24",
  });
  assert.equal(connectedCheckingObservedAnchor(connected.map(account => ({ ...account, updated_at: null })), "America/Chicago"), null);
});

test("mixed-age checking observations never relabel an aggregate as the newest date", () => {
  const connected = [
    { account_subtype: "checking", current_balance: 800, is_active: true, updated_at: "2026-08-25T04:59:00.000Z" },
    { account_subtype: "checking", current_balance: 200, is_active: true, updated_at: "2026-08-25T05:01:00.000Z" },
  ];
  assert.equal(connectedCheckingObservedAnchor(connected, "America/Chicago"), null);
});

test("a 23:59 bank observation keeps its household-local date even when work completes after midnight", () => {
  const connected = [
    { account_subtype: "checking", current_balance: 1000, is_active: true, updated_at: "2026-08-25T04:59:59.000Z" },
  ];
  assert.deepEqual(connectedCheckingObservedAnchor(connected, "America/Chicago"), {
    balance: 1000,
    date: "2026-08-24",
  });
});

test("DST fallback observations on the same household-local date remain coherent", () => {
  const connected = [
    { account_subtype: "checking", current_balance: 700, is_active: true, updated_at: "2026-11-01T06:30:00.000Z" },
    { account_subtype: "checking", current_balance: 300, is_active: true, updated_at: "2026-11-01T07:30:00.000Z" },
  ];
  assert.deepEqual(connectedCheckingObservedAnchor(connected, "America/Chicago"), {
    balance: 1000,
    date: "2026-11-01",
  });
});

test("a mid-month saved balance is not reused as the first-day bank opening", () => {
  assert.equal(historicalMonthOpeningBalance(4_137.69, "2026-07-15", "2026-07-01"), undefined);
  assert.equal(historicalMonthOpeningBalance(3_007.76, "2026-07-01", "2026-07-01"), 3_007.76);
  assert.equal(historicalMonthOpeningBalance(3_007.76, "2026-06-29", "2026-07-01"), 3_007.76);
});
test("bank reconciliation adds one explicit adjustment without rewriting the opening balance", () => {
  const adjustment = bankBalanceAdjustment(600, 1000, "2026-06-24", [
    { date: "2026-06-20", amount: 500 },
    { date: "2026-06-24", amount: -100 },
    { date: "2026-06-25", amount: -50 },
  ]);
  assert.equal(adjustment, 0);
  assert.equal(600 + 500 - 100 + adjustment, 1000);
});
test("bank reconciliation exposes a ledger gap on the reconciliation day", () => {
  const adjustment = bankBalanceAdjustment(600, 1200, "2026-06-24", [
    { date: "2026-06-20", amount: 500 },
    { date: "2026-06-24", amount: -100 },
  ]);
  assert.equal(adjustment, 200);
});
test("confidence is high when balances and recurring inputs are current", () => {
  assert.equal(evaluateForecastConfidence(accounts, true, true, new Date("2026-06-24T12:00:00Z")).level, "high");
});
test("confidence explains stale reconciliation", () => {
  const result = evaluateForecastConfidence(accounts, true, true, new Date("2026-08-01T12:00:00Z"));
  assert.equal(result.level, "low");
  assert.match(result.reasons[0], /Reconcile/);
});
test("statement import handles common amount and debit-credit formats", () => {
  const amountRows = parseStatementCsv('Date,Description,Amount\n06/20/2026,"Coffee, Shop",-4.25\n2026-06-21,Paycheck,500', "a");
  assert.deepEqual(amountRows.map(row => [row.date, row.amount, row.description]), [["2026-06-20", -4.25, "Coffee, Shop"], ["2026-06-21", 500, "Paycheck"]]);
  const splitRows = parseStatementCsv("Posted Date,Description,Debit,Credit\n6/22/26,Utility,80,\n6/23/26,Refund,,12", "a");
  assert.deepEqual(splitRows.map(row => row.amount), [-80, 12]);
});
test("same statement row receives a stable duplicate key", () => {
  const csv = "Date,Description,Amount\n2026-06-20,Coffee,-4.25";
  assert.equal(parseStatementCsv(csv, "a")[0].importHash, parseStatementCsv(csv, "a")[0].importHash);
  assert.notEqual(parseStatementCsv(csv, "a")[0].importHash, parseStatementCsv(csv, "b")[0].importHash);
});

test("statement import rejects impossible calendar dates", () => {
  const csv = [
    "Date,Description,Amount",
    "2026-02-31,Impossible debit,-25.00",
    "02/29/2025,Impossible deposit,100.00",
    "02/29/2024,Leap day deposit,100.00",
  ].join("\n");

  assert.deepEqual(parseStatementCsv(csv, "checking-1").map(row => row.date), ["2024-02-29"]);
});
