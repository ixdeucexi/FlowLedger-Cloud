import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildDayForecastFloPrompt, calendarVisibleForecastEvents, debtPaymentStatusLabel, formatCalendarBalance, groupForecastEvents, plannedDebtEditorParams } from "./forecastDisplay";
import type { FinancialEvent } from "./forecast";

const event = (overrides: Partial<FinancialEvent> & Pick<FinancialEvent, "id" | "sourceType" | "sourceId" | "kind" | "date" | "amount" | "status">): FinancialEvent => ({
  ...overrides,
  name: overrides.name,
});

test("calendar balances round cents to the nearest whole dollar", () => {
  assert.equal(formatCalendarBalance(1689.49), "$1,689");
  assert.equal(formatCalendarBalance(1689.50), "$1,690");
  assert.equal(formatCalendarBalance(1689.99), "$1,690");
  assert.equal(formatCalendarBalance(-12.75), "-$13");
  assert.equal(formatCalendarBalance(0.49), "$0");
});

test("groups forecast events into plain-language sections", () => {
  const groups = groupForecastEvents([
    event({ id: "income", sourceType: "income", sourceId: "pay", kind: "scheduled_income", date: "2026-07-01", amount: 1000, status: "scheduled", name: "Paycheck" }),
    event({ id: "bill", sourceType: "bill", sourceId: "rent", kind: "bill", date: "2026-07-01", amount: -900, status: "planned", name: "Rent" }),
    event({ id: "extra", sourceType: "extra_payment", sourceId: "snowball", kind: "debt_payment", date: "2026-07-04", amount: -20, status: "scheduled", name: "Snowball payment to Camera" }),
    event({ id: "decision", sourceType: "decision", sourceId: "plan", kind: "transaction_expense", date: "2026-07-04", amount: -50, status: "planned", name: "Dinner" }),
  ]);

  assert.deepEqual(groups.map(group => group.title), ["Income", "Bills", "Debt payments", "Saved plans"]);
  assert.equal(groups[0].events[0].statusLabel, "scheduled");
  assert.equal(groups[2].events[0].label, "Snowball payment to Camera");
  assert.equal(groups[2].events[0].amountLabel, "-$20.00");
});

test("labels an authoritative bank commitment as payment pending", () => {
  const groups = groupForecastEvents([
    event({ id: "pending-camera", sourceType: "extra_payment", sourceId: "camera", kind: "debt_payment", date: "2026-08-11", amount: -42.81, status: "pending", name: "Camera debt payment", debtPlanSource: "canonical" }),
  ]);

  assert.equal(groups[0].events[0].statusLabel, "PAYMENT PENDING");
  assert.equal(groups[0].events[0].event.sourceId, "camera");
  assert.equal(groups[0].events[0].event.debtPlanSource, "canonical");
});

test("keeps bank synchronization out of calendar items without removing real activity", () => {
  const events = calendarVisibleForecastEvents([
    event({ id: "bank-anchor", sourceType: "reconciliation", sourceId: "2026-08-11", kind: "bank_adjustment", date: "2026-08-11", amount: 205.78, status: "actual", name: "Bank balance update" }),
    event({ id: "car-wash", sourceType: "transaction", sourceId: "car-wash", kind: "transaction_expense", date: "2026-08-11", amount: -49.97, status: "actual", name: "Car Wash" }),
  ]);

  assert.deepEqual(events.map(item => item.id), ["car-wash"]);
});

test("desktop Forecast and Flo consume only calendar-visible event sources", () => {
  const desktop = readFileSync(path.resolve(process.cwd(), "components/desktop/DesktopCalendarPage.tsx"), "utf8");
  const flo = readFileSync(path.resolve(process.cwd(), "app/(tabs)/flo.tsx"), "utf8");

  assert.match(desktop, /calendarVisibleForecastEvents\(balance\?\.events\)/);
  assert.match(desktop, /calendarVisibleForecastEvents\(selectedDay\?\.events\)/);
  assert.match(flo, /groupForecastEvents\(calendarVisibleForecastEvents\(todayForecastDay\?\.events\)\)/);
});

test("a canonical child opens the editor for its source debt and occurrence", () => {
  const rolloverChild = event({
    id: "camera-to-concert",
    sourceType: "extra_payment",
    sourceId: "camera",
    kind: "debt_payment",
    date: "2026-08-11",
    amount: -60.19,
    status: "planned",
    name: "Concert debt payment",
    debtPlanSource: "canonical",
    debtTargetBillId: "concert",
  });
  assert.deepEqual(plannedDebtEditorParams(rolloverChild), { billId: "camera", date: "2026-08-11" });
  assert.equal(plannedDebtEditorParams({ ...rolloverChild, debtPlanSource: "saved_extra" }), undefined);
});

test("labels debt payments scheduled until the selected date arrives", () => {
  const today = new Date("2026-07-01T12:00:00");
  assert.equal(debtPaymentStatusLabel("2026-07-04", false, today), "scheduled");
  assert.equal(debtPaymentStatusLabel("2026-07-01", false, today), "applied");
  assert.equal(debtPaymentStatusLabel("2026-06-30", false, today), "applied");
  assert.equal(debtPaymentStatusLabel("2026-06-30", true, today), "scheduled");
});

test("builds a day-specific Flo prompt from forecast groups", () => {
  const groups = groupForecastEvents([
    event({ id: "income", sourceType: "income", sourceId: "pay", kind: "scheduled_income", date: "2026-07-03", amount: 1500, status: "scheduled", name: "Paycheck" }),
    event({ id: "bill", sourceType: "bill", sourceId: "utilities", kind: "bill", date: "2026-07-03", amount: -350, status: "finalized", name: "Utilities" }),
    event({ id: "tx", sourceType: "transaction", sourceId: "camera", kind: "transaction_expense", date: "2026-07-03", amount: -20, status: "actual", name: "Camera Snowball" }),
  ]);

  const prompt = buildDayForecastFloPrompt("Friday, Jul 3", "2026-07-03", 4412.74, groups);

  assert.match(prompt, /Friday, Jul 3/);
  assert.match(prompt, /Projected close is \$4412\.74/);
  assert.match(prompt, /Income: Paycheck \+\$1500\.00 \(scheduled\)/);
  assert.match(prompt, /Bills: Utilities -\$350\.00 \(finalized\)/);
  assert.match(prompt, /Transactions: Camera Snowball -\$20\.00 \(actual\)/);
});

test("builds a clear Flo prompt for a day with no activity", () => {
  const prompt = buildDayForecastFloPrompt("Thursday, Jul 2", "2026-07-02", 4470, []);

  assert.match(prompt, /No dated income, bills, transactions, goals, debt payments, or saved plans/);
});
