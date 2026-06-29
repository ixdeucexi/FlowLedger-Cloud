import assert from "node:assert/strict";
import test from "node:test";

import { summarizeMonthlyBills } from "./monthlySummary";

type TestBill = { id: string; amount: number; paid: number };

test("summarizes monthly bill paid and unpaid counts from bill count, not dollars", () => {
  const bills: TestBill[] = [
    { id: "rent", amount: 1000, paid: 1000 },
    { id: "utilities", amount: 370, paid: 350 },
    { id: "phone", amount: 50, paid: 0 },
  ];

  const summary = summarizeMonthlyBills(bills, bill => bill.amount, bill => bill.paid);

  assert.equal(summary.totalDue, 1420);
  assert.equal(summary.totalPaid, 1350);
  assert.equal(summary.remaining, 70);
  assert.equal(summary.paidCount, 1);
  assert.equal(summary.unpaidCount, 2);
  assert.equal(summary.billCount, 3);
  assert.equal(summary.billProgressPercent, 33);
});

test("caps overpaid bills so dashboard and monthly totals cannot drift", () => {
  const bills: TestBill[] = [
    { id: "card", amount: 100, paid: 125 },
    { id: "internet", amount: 80, paid: 80 },
  ];

  const summary = summarizeMonthlyBills(bills, bill => bill.amount, bill => bill.paid);

  assert.equal(summary.totalDue, 180);
  assert.equal(summary.totalPaid, 180);
  assert.equal(summary.remaining, 0);
  assert.equal(summary.paidCount, 2);
  assert.equal(summary.billProgressPercent, 100);
});

test("ignores zero-amount bills when calculating progress", () => {
  const bills: TestBill[] = [
    { id: "review-only", amount: 0, paid: 0 },
    { id: "water", amount: 40, paid: 40 },
  ];

  const summary = summarizeMonthlyBills(bills, bill => bill.amount, bill => bill.paid);

  assert.equal(summary.billCount, 1);
  assert.equal(summary.paidCount, 1);
  assert.equal(summary.billProgressPercent, 100);
});
