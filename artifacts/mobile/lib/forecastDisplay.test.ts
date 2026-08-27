import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildDayForecastFloPrompt, calendarVisibleForecastEvents, combineSameDayDebtPaymentEvents, debtPaymentStatusLabel, forecastItemBadgeLabel, forecastItemTypeLabel, formatCalendarBalance, groupForecastEvents, plannedDebtEditorParams } from "./forecastDisplay";
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

test("mobile calendar displays and announces the full balance", () => {
  const calendar = readFileSync(path.resolve(process.cwd(), "components/CalendarView.tsx"), "utf8");

  assert.match(calendar, /accessibilityLabel=\{`Balance \$\{formatCalendarBalance\(db\.balance\)\}`\}/);
  assert.doesNotMatch(calendar, /Actual close|Actual bank close|Closing balance/i);
  assert.doesNotMatch(calendar, />Projected</);
  assert.match(calendar, /\{formatCalendarBalance\(db\.balance\)\}/);
  assert.doesNotMatch(calendar, /formatCompactCalendarBalance/);
});

test("selected-day and desktop details show balance amounts without source labels", () => {
  const monthly = readFileSync(path.resolve(process.cwd(), "app/(tabs)/monthly.tsx"), "utf8");
  const desktop = readFileSync(path.resolve(process.cwd(), "components/desktop/DesktopCalendarPage.tsx"), "utf8");

  assert.match(monthly, /selectedForecastDay\.balance\.toFixed\(2\)/);
  assert.doesNotMatch(monthly, /actual bank close|closing balance/i);
  assert.match(desktop, /money\(selectedDay\?\.balance \?\? 0\)/);
  assert.doesNotMatch(desktop, /actual close|actual bank close|closing balance|last verified bank balance/i);
});

test("Forecast day details use the canonical debt occurrence instead of the current recurring minimum", () => {
  const monthly = readFileSync(path.resolve(process.cwd(), "app/(tabs)/monthly.tsx"), "utf8");

  assert.match(monthly, /debtSettlement\?\.status === "settled"[\s\S]+isPaid: true, isPartial: false/);
  assert.match(monthly, /const debtOccurrence = bill\.is_debt[\s\S]+occurrence\.occurrenceDate === occurrenceDate/);
  assert.match(monthly, /debtOccurrence\?\.configuredObligation/);
  assert.match(monthly, /debtOccurrence\?\.paidAmount/);
  assert.match(monthly, /debtOccurrence\?\.remainingRequired/);
});

test("calendar never substitutes empty financial arrays while cached data is available", () => {
  const monthly = readFileSync(path.resolve(process.cwd(), "app/(tabs)/monthly.tsx"), "utf8");
  const workspace = readFileSync(path.resolve(process.cwd(), "components/desktop/DesktopWorkspacePage.tsx"), "utf8");

  assert.doesNotMatch(monthly, /calendarDataReady/);
  assert.match(monthly, /dailyBalances=\{dailyBalances\}/);
  assert.match(monthly, /transactions=\{calendarTransactions\}/);
  assert.match(monthly, /selectedDay === null/);
  assert.doesNotMatch(workspace, /dataUpdatedAt \? getDailyBalances/);
  assert.match(workspace, /const balances = getDailyBalances\(month, selectedYear\)/);
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
  assert.doesNotMatch(desktop, /palette\.purple\s*\+\s*["']55["']/);
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

test("planned badges name the money type while real statuses stay intact", () => {
  const bill = event({ id: "apple", sourceType: "bill", sourceId: "apple", kind: "bill", date: "2026-08-28", amount: -10.99, status: "scheduled" });
  const debt = event({ id: "tesla-required", sourceType: "extra_payment", sourceId: "tesla", kind: "debt_payment", date: "2026-08-28", amount: -695.51, status: "scheduled", debtPlanAllocationKind: "required" });
  const snowball = event({ id: "tesla-extra", sourceType: "extra_payment", sourceId: "tesla", kind: "debt_payment", date: "2026-08-28", amount: -50, status: "planned", debtPlanAllocationKind: "extra" });

  assert.equal(forecastItemBadgeLabel(bill, "scheduled"), "Bill");
  assert.equal(forecastItemTypeLabel(debt), "Debt");
  assert.equal(forecastItemBadgeLabel(debt, "scheduled"), "Debt");
  assert.equal(forecastItemBadgeLabel(snowball, "planned"), "Snowball");
  assert.equal(forecastItemBadgeLabel(debt, "PAYMENT PENDING"), "PAYMENT PENDING");
});

test("combines a routed surplus with the same debt's planned payment on that date", () => {
  const combined = combineSameDayDebtPaymentEvents([
    event({
      id: "concert-required",
      sourceType: "extra_payment",
      sourceId: "concert",
      kind: "debt_payment",
      date: "2026-08-29",
      amount: -103,
      status: "scheduled",
      name: "Concert debt payment",
      debtPlanSource: "canonical",
      debtTargetBillId: "concert",
    }),
    event({
      id: "concert-surplus",
      sourceType: "extra_payment",
      sourceId: "extra-plan-august",
      kind: "debt_payment",
      date: "2026-08-29",
      amount: -9.11,
      status: "planned",
      name: "Concert debt payment",
      debtPlanSource: "saved_extra",
      debtTargetBillId: "concert",
    }),
  ]);

  assert.equal(combined.length, 1);
  assert.equal(combined[0].amount, -112.11);
  assert.equal(combined[0].status, "scheduled");
  assert.equal(combined[0].sourceId, "extra-plan-august");
  assert.equal(combined[0].debtPlanSource, "saved_extra");
});

test("does not combine debt payments for different dates or debts", () => {
  const combined = combineSameDayDebtPaymentEvents([
    event({ id: "concert", sourceType: "extra_payment", sourceId: "concert", kind: "debt_payment", date: "2026-08-29", amount: -35, status: "scheduled", debtTargetBillId: "concert" }),
    event({ id: "discover", sourceType: "extra_payment", sourceId: "discover", kind: "debt_payment", date: "2026-08-29", amount: -113, status: "scheduled", debtTargetBillId: "discover" }),
    event({ id: "concert-later", sourceType: "extra_payment", sourceId: "concert", kind: "debt_payment", date: "2026-09-29", amount: -35, status: "scheduled", debtTargetBillId: "concert" }),
  ]);

  assert.equal(combined.length, 3);
});

test("Forecast closes the selected-day modal before opening a planned debt editor", () => {
  const monthly = readFileSync(path.resolve(process.cwd(), "app/(tabs)/monthly.tsx"), "utf8");
  assert.match(monthly, /const openPlannedDebtPaymentEditor[\s\S]*setSelectedDate\(null\)[\s\S]*pathname: "\/planned-debt-payment"/);
  assert.equal(monthly.match(/pathname: "\/planned-debt-payment"/g)?.length, 1);
  assert.match(monthly, /PAYMENT STILL PLANNED/);
  assert.match(monthly, /configuredDebtAmountForRemainingPayment\(remainingAmount, settledForOccurrence\)/);
  assert.match(monthly, /payment already made stays recorded/);
  assert.match(monthly, /Keep \$\$\{inlineEdit\.originalPlanned\.toFixed\(2\)\} scheduled/);
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
  assert.match(prompt, /Closing balance is \$4412\.74/);
  assert.match(prompt, /Income: Paycheck \+\$1500\.00 \(scheduled\)/);
  assert.match(prompt, /Bills: Utilities -\$350\.00 \(finalized\)/);
  assert.match(prompt, /Transactions: Camera Snowball -\$20\.00 \(actual\)/);
});

test("builds a clear Flo prompt for a day with no activity", () => {
  const prompt = buildDayForecastFloPrompt("Thursday, Jul 2", "2026-07-02", 4470, []);

  assert.match(prompt, /No dated income, bills, transactions, goals, debt payments, or saved plans/);
});
