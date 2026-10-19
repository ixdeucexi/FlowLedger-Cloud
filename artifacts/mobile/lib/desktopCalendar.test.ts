import assert from "node:assert/strict";
import test from "node:test";

import type { FinancialEvent } from "./forecast";
import {
  type CalendarForecastDay,
  calendarEventKind,
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

test("calendar categories keep debt distinct from generic plans", () => {
  const transferIds = new Set(["transfer"]);
  const overdueKeys = new Set(["bill:2026-08-05"]);
  assert.equal(calendarEventKind(event("paycheck", 2500, "income"), transferIds), "income");
  assert.equal(calendarEventKind(event("bill", -120, "bill"), transferIds), "bill");
  assert.equal(calendarEventKind({ ...event("debt", -120, "bill"), debtTargetBillId: "debt" }, transferIds), "debt");
  assert.equal(calendarEventKind(event("transfer", -400), transferIds), "plan");
  assert.equal(calendarEventKind(event("goal", -300, "goal"), transferIds), "plan");
  assert.equal(calendarEventKind(event("purchase", -85), transferIds), "spending");
  assert.equal(calendarEventKind(event("bill", -120, "bill"), transferIds, overdueKeys), "risk");
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

import { createCalendarEventLabelResolver } from "./desktopCalendar";
import type { ReviewTransactionLike } from "./reviewCenter";

const bankTransaction: ReviewTransactionLike & { match_reason?: string | null } = {
  id: "bank-charge", amount: -100, date: "2026-08-05", note: "BANK RAW NOTE", category: "Other",
  merchant_name: "Bank merchant", linked_bill_id: "utility", match_reason: "confirmed_bill_match",
};
const bankEvent = { ...event("forecast-row", -100), sourceId: bankTransaction.id, name: "STALE FORECAST NOTE" };

test("desktop transaction names match phone confirmed bill, debt and allocation policy", () => {
  for (const transaction of [
    bankTransaction,
    { ...bankTransaction, linked_bill_id: "debt", debt_applied_bill_id: "debt" },
    { ...bankTransaction, linked_bill_id: undefined, review_status: "matched", review_resolution: "bill", review_allocations: [{ type: "bill" as const, targetId: "utility", amount: 100 }] },
  ]) {
    const resolve = createCalendarEventLabelResolver([transaction], [{ id: "utility", name: "Electricity" }, { id: "debt", name: "Car loan" }]);
    assert.equal(resolve(bankEvent), transaction.linked_bill_id === "debt" ? "Car loan" : "Electricity");
  }
});

test("suggested and stale links never override canonical bank names; edited note wins", () => {
  const bills = [{ id: "utility", name: "Electricity" }];
  for (const match_reason of [undefined, "suggested_bill_match", "removed_match"]) {
    assert.equal(createCalendarEventLabelResolver([{ ...bankTransaction, match_reason }], bills)(bankEvent), "Bank merchant");
  }
  assert.equal(createCalendarEventLabelResolver([{ ...bankTransaction, user_edited_at: "2026-08-05", note: "My custom name" }], bills)(bankEvent), "My custom name");
  assert.equal(createCalendarEventLabelResolver([{ ...bankTransaction, linked_bill_id: undefined, review_status: "needs_review", review_resolution: "bill", review_allocations: [{ type: "bill", targetId: "utility", amount: 100 }] }], bills)(bankEvent), "Bank merchant");
});

test("missing rows and nontransaction events keep original labels without mutating forecast", () => {
  const original = structuredClone(bankEvent);
  assert.equal(createCalendarEventLabelResolver([], [])(bankEvent), "STALE FORECAST NOTE");
  assert.equal(createCalendarEventLabelResolver([bankTransaction], [])(bankEvent), "Bank merchant");
  const resolve = createCalendarEventLabelResolver([bankTransaction], [{ id: "utility", name: "Electricity" }]);
  assert.equal(resolve({ ...bankEvent, sourceType: "bill", name: "Forecast bill" }), "Forecast bill");
  assert.equal(resolve({ ...bankEvent, sourceType: "income", name: "" }), "Income");
  assert.deepEqual(bankEvent, original);
});

test("fresh scoped rows immediately reflect rename, rematch, unmatch and household switch", () => {
  const label = (transaction: typeof bankTransaction, bills: { id: string; name: string }[]) => createCalendarEventLabelResolver([transaction], bills)(bankEvent);
  assert.equal(label(bankTransaction, [{ id: "utility", name: "Original" }]), "Original");
  assert.equal(label(bankTransaction, [{ id: "utility", name: "Renamed" }]), "Renamed");
  assert.equal(label({ ...bankTransaction, linked_bill_id: "other" }, [{ id: "utility", name: "Renamed" }, { id: "other", name: "Rematched" }]), "Rematched");
  assert.equal(label({ ...bankTransaction, linked_bill_id: undefined, match_reason: undefined }, [{ id: "utility", name: "Renamed" }]), "Bank merchant");
  assert.equal(label(bankTransaction, [{ id: "different-household", name: "Private other bill" }]), "Bank merchant");
  assert.equal(createCalendarEventLabelResolver([], [{ id: "utility", name: "Private other bill" }])(bankEvent), "STALE FORECAST NOTE");
});

import { readFileSync } from "node:fs";
test("desktop grid and selected-day labels share the live scoped resolver for text and accessibility", () => {
  const desktop = readFileSync("components/desktop/DesktopCalendarPage.tsx", "utf8");
  const monthly = readFileSync("app/(tabs)/monthly.tsx", "utf8");
  assert.equal((desktop.match(/resolveEventLabel\(event\)/g) ?? []).length, 4);
  assert.equal((desktop.match(/resolveEventLabel=\{props.resolveEventLabel\}/g) ?? []).length, 2);
  assert.match(monthly, /createCalendarEventLabelResolver\(transactions, bills\),\s*\[transactions, bills\]/);
  assert.match(monthly, /resolveEventLabel=\{resolveDesktopEventLabel\}/);
});
