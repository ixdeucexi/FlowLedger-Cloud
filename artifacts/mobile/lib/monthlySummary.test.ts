import assert from "node:assert/strict";
import test from "node:test";

import {
  activityAmountOutsidePlannedBill,
  listActivityMonths,
  summarizeActivityMonth,
  summarizeMonthlyBills,
} from "./monthlySummary";

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

test("activity summary includes the full month's income without counting transfers or pending activity", () => {
  const summary = summarizeActivityMonth([
    { date: "2026-07-01", amount: 1500 },
    { date: "2026-07-09", amount: 2308 },
    { date: "2026-07-23", amount: 2308 },
    { date: "2026-07-09", amount: 167, excludeFromCashFlow: true },
    { date: "2026-07-08", amount: -100 },
    { date: "2026-07-16", amount: -50, excludeFromCashFlow: true },
    { date: "2026-07-16", amount: 999, pending: true },
    { date: "2026-08-01", amount: 1000 },
  ], 2026, 6);

  assert.equal(summary.income, 6116);
  assert.equal(summary.out, 100);
  assert.equal(summary.net, 6016);
  assert.equal(summary.weeks[1]?.total, 2208);
  assert.equal(summary.weeks[3]?.total, 2308);
});

test("activity month filter only offers the current month and earlier months with data", () => {
  assert.deepEqual(listActivityMonths([
    "2026-07-31",
    "2026-05-10",
    "2026-07-01",
    "2026-09-01",
    "not-a-date",
  ], "2026-08"), ["2026-08", "2026-07", "2026-05"]);
});

test("activity summary can combine planned bills with non-bill spending without counting a matched payment twice", () => {
  const summary = summarizeActivityMonth([
    { date: "2026-08-03", amount: 1500 },
    { date: "2026-08-07", amount: -180 },
    { date: "2026-08-10", amount: -370 },
    { date: "2026-08-10", amount: -370, excludeFromCashFlow: true },
  ], 2026, 7);

  assert.equal(summary.income, 1500);
  assert.equal(summary.out, 550);
  assert.equal(summary.net, 950);
});

test("activity summary keeps the category portion of a split bill payment", () => {
  const splitRemainder = activityAmountOutsidePlannedBill(-390, true, [
    { type: "bill", amount: 370 },
    { type: "category", amount: 20 },
  ]);
  assert.equal(splitRemainder, -20);
  assert.equal(activityAmountOutsidePlannedBill(-390, false, [
    { type: "bill", amount: 370 },
    { type: "category", amount: 20 },
  ]), -390);
  assert.equal(activityAmountOutsidePlannedBill(-370, true, [
    { type: "bill", amount: 370 },
  ]), 0);

  const summary = summarizeActivityMonth([
    { date: "2026-08-10", amount: -370 },
    { date: "2026-08-10", amount: splitRemainder },
  ], 2026, 7);
  assert.equal(summary.out, 390);
});
