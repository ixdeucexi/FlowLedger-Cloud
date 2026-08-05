import assert from "node:assert/strict";
import test from "node:test";

import type { FinancialEvent } from "./forecast";
import {
  type CalendarForecastDay,
  desktopCalendarCells,
  desktopCalendarWeekDates,
  summarizeCalendarEvents,
  summarizeCalendarMonth,
} from "./desktopCalendar";

function event(
  id: string,
  amount: number,
  sourceType: FinancialEvent["sourceType"] = "transaction",
): FinancialEvent {
  return {
    id,
    sourceId: id,
    sourceType,
    date: "2026-08-05",
    kind: amount >= 0 ? "transaction_income" : "transaction_expense",
    amount,
    status: "actual",
    name: id,
  };
}

test("calendar summaries exclude transfers and balance reconciliations", () => {
  const summary = summarizeCalendarEvents(
    [
      event("income", 2500),
      event("expense", -300),
      event("transfer", -400),
      event("anchor", 125, "reconciliation"),
    ],
    new Set(["transfer"]),
  );
  assert.deepEqual(summary, {
    income: 2500,
    expenses: 300,
    net: 2200,
    incomeCount: 1,
    expenseCount: 1,
  });
});

test("calendar month summary uses unique forecast events and the lowest daily balance", () => {
  const income = event("income", 1200, "income");
  const days: CalendarForecastDay[] = [
    { day: 1, balance: 2400, events: [income] },
    { day: 2, balance: 2200, events: [income, event("expense", -200)] },
    { day: 3, balance: 1800, events: [] },
  ];
  const summary = summarizeCalendarMonth(days, 2026, 7, new Set());
  assert.equal(summary.income, 1200);
  assert.equal(summary.expenses, 200);
  assert.equal(summary.lowestBalance, 1800);
  assert.equal(summary.lowestBalanceDate, "2026-08-03");
});

test("desktop calendar always has a Sunday-first six-week grid", () => {
  const cells = desktopCalendarCells(2026, 7);
  assert.equal(cells.length, 42);
  assert.equal(cells[0]?.date, "2026-07-26");
  assert.equal(cells[6]?.date, "2026-08-01");
  assert.equal(cells[41]?.date, "2026-09-05");
});

test("weekly summary range begins Sunday and ends Saturday", () => {
  assert.deepEqual(desktopCalendarWeekDates("2026-08-05"), [
    "2026-08-02",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08",
  ]);
});
