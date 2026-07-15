import test from "node:test";
import assert from "node:assert/strict";
import { evaluateForecastConfidence, openingBalanceForReconciledDay, operatingAccountAnchor, parseStatementCsv, totalForecastBalance, type AccountSnapshot } from "./accounts";

const accounts: AccountSnapshot[] = [
  { id: "checking", name: "Checking", type: "checking", currentBalance: 1200, balanceAsOf: "2026-06-23", lastReconciledAt: "2026-06-23", active: true },
  { id: "savings", name: "Savings", type: "savings", currentBalance: 300, balanceAsOf: "2026-06-23", lastReconciledAt: "2026-06-23", active: true },
];

test("account total combines checking and savings", () => assert.equal(totalForecastBalance(accounts), 1500));
test("calendar anchor uses checking cash without pulling savings into spendable money", () => {
  assert.deepEqual(operatingAccountAnchor(accounts), { balance: 1200, date: "2026-06-23" });
});
test("calendar anchor falls back to active accounts when no checking account exists", () => {
  assert.deepEqual(operatingAccountAnchor([accounts[1]]), { balance: 300, date: "2026-06-23" });
});
test("account balance anchor is the selected day's closing balance", () => {
  const opening = openingBalanceForReconciledDay(1000, "2026-06-24", [
    { date: "2026-06-20", amount: 500 },
    { date: "2026-06-24", amount: -100 },
    { date: "2026-06-25", amount: -50 },
  ]);
  assert.equal(opening, 600);
  assert.equal(opening + 500 - 100, 1000);
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
