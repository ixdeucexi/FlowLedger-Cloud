import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildForecastBillNotifications } from "./forecastBillNotifications";
import { calendarVisibleForecastEvents } from "./forecastDisplay";
import { createFinancialProjection } from "./financialProjection";
import type { Bill, FinancialProjectionSnapshot, Transaction } from "./financialProjectionTypes";
import type { FinancialEvent } from "./forecast";
import type { DebtMonthSettlement } from "./debtPlanDomain";
import { localDateInTimeZone } from "./dailyCheckingClose";
import { pendingOccurrenceKeySet, type PendingPlanMatch } from "./pendingPlanMatches";
import golden from "./financialProjection.golden.json";

const bill = (patch: Partial<Bill> = {}): Bill => ({ id: "utility", name: "Utility", amount: 50, category: "Utilities", priority: 1, is_debt: false, balance: 0, interest_rate: 0, due_day: 30, is_recurring: true, frequency: "monthly", created_at: "2026-01-01T00:00:00Z", start_date: "2026-01-01", ...patch });
const debt = bill({ id: "tesla", name: "Tesla", amount: 700, is_debt: true, balance: 34000, due_day: 28 });
const event = (patch: Partial<FinancialEvent> = {}): FinancialEvent => ({ id: "bill:utility:2026-09-30", sourceId: "utility", sourceType: "bill", kind: "bill", date: "2026-09-30", amount: -50, status: "planned", name: "Utility", ...patch });
function snapshot(patch: Partial<FinancialProjectionSnapshot> = {}): FinancialProjectionSnapshot {
  const base = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  return { ...base, bills: [], overrides: [], billDateMoves: [], transactions: [], deletedTransactions: [], incomes: [], goals: [], extraPayments: [], decisions: [], accounts: [], connectedBankAccounts: [], transactionAccountIdentities: [], pendingBankTransactions: [], pendingPlanMatches: [], ...patch };
}
function reminders(data: FinancialProjectionSnapshot, today = "2026-09-29") {
  const projection = createFinancialProjection(data, { now: new Date(`${today}T18:00:00Z`), timeZone: "America/Chicago" });
  return { projection, notifications: buildForecastBillNotifications({ today, bills: data.bills, ...projection, protectedOccurrences: pendingOccurrenceKeySet(data.pendingPlanMatches, data.pendingBankTransactions) }) };
}
function fromEvents(events: FinancialEvent[], options: { today?: string; bills?: Bill[]; settlements?: Map<string, DebtMonthSettlement>; protectedOccurrences?: Set<string> } = {}) {
  return buildForecastBillNotifications({ today: options.today ?? "2026-09-29", bills: options.bills ?? [bill(), debt], getDailyBalances: (month, year) => [{ events: events.filter(item => item.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) }], getDebtMonthSettlements: () => options.settlements ?? new Map(), protectedOccurrences: options.protectedOccurrences });
}
const payment = (occurrenceDate: string, amount: number, settlement: "partial" | "full" = "partial"): Transaction => ({ id: `payment:${occurrenceDate}`, date: occurrenceDate, amount: -amount, note: "Utility", category: "Utilities", linked_bill_id: "utility", source: "plaid", review_status: "matched", review_resolution: "bill", matched_occurrence_date: occurrenceDate, review_allocations: [{ type: "bill", targetId: "utility", occurrenceDate, amount, plannedAmount: 50, settlement }] });

test("Tesla reminder matches grouped Forecast: required4.40 plus targeted extra695.60 is700 on moved date", () => {
  const data = snapshot({ bills: [debt], overrides: [{ id: "sep-plan", bill_id: debt.id, month: 8, year: 2026, planned_debt_amount: 1395.60, paid_amount: 695.60, actual_amount: 695.60, paid_date: "2026-09-01" }], billDateMoves: [{ id: "move", bill_id: debt.id, from_date: "2026-09-28", to_date: "2026-09-30", created_at: "2026-09-20" }], transactions: [{ ...payment("2026-08-28", 695.60, "full"), id: "prior-cycle", date: "2026-09-01", linked_bill_id: debt.id, matched_occurrence_date: "2026-08-28", review_allocations: [{ type: "bill", targetId: debt.id, occurrenceDate: "2026-08-28", amount: 695.60, plannedAmount: 700, settlement: "full" }] }] });
  const { projection, notifications } = reminders(data);
  const dateEvents = projection.getDailyBalances(8, 2026).find(day => day.day === 30)!.events!;
  assert.deepEqual(dateEvents.filter(item => item.kind === "debt_payment").map(item => -item.amount).sort((a, b) => a - b), [4.4, 695.6]);
  assert.equal(calendarVisibleForecastEvents(dateEvents).find(item => item.debtTargetBillId === debt.id)!.amount, -700);
  assert.equal(notifications.length, 1); assert.equal(notifications[0].id, "bill-due:tesla:2026-09-30"); assert.match(notifications[0].body, /^\$700\.00 is planned/);
  assert.equal(notifications[0].title, "Tesla is due tomorrow"); assert.deepEqual(notifications[0].params, { view: "debt" });
});

test("ordinary partial settlement stays on its exact weekly occurrence, not the earliest date", () => {
  const data = snapshot({ bills: [bill({ frequency: "weekly", day_of_week: 1, start_date: "2026-09-14" })], transactions: [payment("2026-09-21", 20)], overrides: [{ id: "paid", bill_id: "utility", month: 8, year: 2026, paid_amount: 20 }] });
  const { notifications } = reminders(data, "2026-09-27");
  assert.match(notifications.find(item => item.id === "bill-overdue:utility:2026-09-14")!.body, /^\$50\.00 remains/);
  assert.match(notifications.find(item => item.id === "bill-overdue:utility:2026-09-21")!.body, /^\$30\.00 remains/);
  assert.match(notifications.find(item => item.id === "bill-due:utility:2026-09-28")!.body, /^\$50\.00 is planned/);
});

test("fully settled occurrence produces no reminder even if actual payment was below planned", () => {
  const { notifications } = reminders(snapshot({ bills: [bill({ due_day: 28 })], transactions: [payment("2026-09-28", 30, "full")] }), "2026-09-27");
  assert.equal(notifications.length, 0);
});

test("future partial ordinary payment uses the exact remaining Forecast amount", () => {
  const { notifications } = reminders(snapshot({ bills: [bill()], transactions: [{ ...payment("2026-09-30", 20), date: "2026-09-28" }] }));
  assert.equal(notifications.length, 1); assert.match(notifications[0].body, /^\$30\.00 is planned/);
});

test("cross-month moved occurrence and next-month due dates appear in inclusive rolling7day window", () => {
  const data = snapshot({ bills: [bill(), bill({ id: "next", name: "Next month", due_day: 6 }), bill({ id: "too-late", due_day: 7 })], billDateMoves: [{ id: "move", bill_id: "utility", from_date: "2026-09-30", to_date: "2026-10-03", created_at: "2026-09-25" }] });
  const { notifications } = reminders(data);
  assert.ok(notifications.some(item => item.id === "bill-due:utility:2026-10-03"));
  assert.ok(notifications.some(item => item.id === "bill-due:next:2026-10-06"));
  assert.ok(!notifications.some(item => item.id === "bill-due:too-late:2026-10-07" || item.id === "bill-due:utility:2026-09-30"));
});

test("weekly biweekly and quarterly reminder amount/date pairs equal canonical calendar events", () => {
  const data = snapshot({ bills: [bill({ id: "weekly", frequency: "weekly", day_of_week: 3 }), bill({ id: "biweekly", frequency: "biweekly", next_payment_date: "2026-09-18", due_day: 18 }), bill({ id: "quarterly", frequency: "quarterly", next_payment_date: "2026-07-03", due_day: 3 })] });
  const { notifications, projection } = reminders(data);
  const expected = [8, 9].flatMap(month => projection.getDailyBalances(month, 2026).flatMap(day => calendarVisibleForecastEvents(day.events).filter(item => item.date >= "2026-09-29" && item.date <= "2026-10-06" && item.sourceType === "bill")));
  const upcoming = notifications.filter(item => item.id.startsWith("bill-due:"));
  assert.equal(upcoming.length, expected.length); assert.equal(expected.length, 3);
  expected.forEach(item => assert.match(upcoming.find(note => note.id === `bill-due:${item.sourceId}:${item.date}`)!.body, new RegExp(`^\\$${(-item.amount).toFixed(2).replace(".", "\\.")} is planned`)));
});

test("paused, stopped, nonrecurring and closed debt schedules do not gain reminders", () => {
  const data = snapshot({ bills: [bill({ id: "paused", start_date: "2026-10-20" }), bill({ id: "stopped", end_date: "2026-09-20" }), bill({ id: "inactive", is_recurring: false }), { ...debt, balance: 0 }] });
  assert.equal(reminders(data).notifications.length, 0);
});

test("optional snowball and targeted extras never become debt-overdue amounts", () => {
  const data = snapshot({ bills: [debt], overrides: [{ id: "plan", bill_id: debt.id, month: 8, year: 2026, planned_debt_amount: 1400, paid_amount: 700, actual_amount: 700, paid_date: "2026-09-28" }] });
  const { projection, notifications } = reminders(data);
  assert.ok(projection.getDailyBalances(8, 2026).some(day => day.events?.some(item => item.debtTargetBillId === debt.id && item.amount < 0)));
  assert.equal(notifications.length, 0);
});

test("debt overdue retains lender requirement even when Forecast plan was lowered or skipped", () => {
  const data = snapshot({ bills: [debt], overrides: [{ id: "plan", bill_id: debt.id, month: 8, year: 2026, planned_debt_amount: 0, paid_amount: 100 }] });
  const { notifications } = reminders(data);
  assert.equal(notifications.length, 1); assert.equal(notifications[0].id, "bill-overdue:tesla:2026-09-28"); assert.match(notifications[0].body, /^\$600\.00 remains/);
});

test("actual finalized applied and pending entries do not trigger unpaid reminders", () => {
  const statuses = ["actual", "finalized", "applied", "pending"] as const;
  statuses.forEach(status => assert.equal(fromEvents([event({ status })]).length, 0));
  assert.equal(fromEvents([event()], { protectedOccurrences: new Set(["utility:2026-09-30"]) }).length, 0);
  assert.equal(fromEvents([event({ amount: 0 }), event({ id: "positive", amount: 50 }), event({ id: "nan", amount: NaN })]).length, 0);
});

test("pending source in a combined debt event protects the target instead of sending another payment reminder", () => {
  const events = [event({ id: "required", sourceType: "extra_payment", kind: "debt_payment", sourceId: "tesla", debtTargetBillId: "tesla", amount: -4.4, status: "pending", debtPlanAllocationKind: "required" }), event({ id: "extra", sourceType: "extra_payment", kind: "debt_payment", sourceId: "other-debt", debtTargetBillId: "tesla", amount: -695.6, status: "scheduled", debtPlanAllocationKind: "rollover" })];
  assert.equal(fromEvents(events).length, 0);
});

test("rollover reminder is named and linked to its target, not the debt that freed the money", () => {
  const result = fromEvents([event({ sourceType: "extra_payment", kind: "debt_payment", sourceId: "utility", debtTargetBillId: "tesla", amount: -25, debtPlanAllocationKind: "rollover" })]);
  assert.equal(result[0].id, "bill-due:tesla:2026-09-30"); assert.equal(result[0].title, "Tesla is due tomorrow"); assert.deepEqual(result[0].params, { view: "debt" });
  assert.equal(fromEvents([event({ sourceType: "extra_payment", kind: "debt_payment", sourceId: "utility" })]).length, 0, "no guessed target for unscoped legacy extra");
});

test("duplicate calendar bill rows and repeated event identities create only one reminder", () => {
  assert.equal(fromEvents([event(), event(), event({ id: "duplicate-chip" })]).length, 1);
  const required = event({ sourceType: "extra_payment", kind: "debt_payment", sourceId: "tesla", debtTargetBillId: "tesla", amount: -50, debtPlanAllocationKind: "required" });
  assert.match(fromEvents([required, required])[0].body, /^\$50\.00 is planned/);
});

test("household date uses today/tomorrow and year boundary without device-midnight drift", () => {
  const today = localDateInTimeZone(new Date("2027-01-01T02:00:00Z"), "America/Chicago");
  assert.equal(today, "2026-12-31");
  const result = fromEvents([event({ date: today }), event({ id: "jan", date: "2027-01-01" })], { today });
  assert.match(result[0].title, /today$/); assert.match(result[1].title, /tomorrow$/);
});

test("live and posted-review pending protection uses exact occurrence keys only", () => {
  const match: PendingPlanMatch = { id: "pending", pending_plaid_transaction_id: "bank-pending", target_type: "bill", target_id: "utility", target_name: "Utility", occurrence_date: "2026-09-30", planned_amount: 50, pending_amount: 50, pending_transaction_date: "2026-09-29", status: "active", created_at: "2026-09-29", updated_at: "2026-09-29" };
  assert.equal(fromEvents([event()], { protectedOccurrences: pendingOccurrenceKeySet([match], [{ plaid_transaction_id: "bank-pending" }]) }).length, 0);
  assert.equal(fromEvents([event()], { protectedOccurrences: pendingOccurrenceKeySet([match], []) }).length, 1, "expired bank pending does not suppress reminder forever");
  assert.equal(fromEvents([event()], { protectedOccurrences: pendingOccurrenceKeySet([{ ...match, status: "ready_review" }], []) }).length, 0);
});

test("AppDiscovery consumes shared Forecast reminders, no independent monthly paid redistribution", () => {
  const source = readFileSync("context/AppDiscoveryContext.tsx", "utf8");
  assert.match(source, /buildForecastBillNotifications\(\{ today: todayDate, bills, getDailyBalances, getDebtMonthSettlements, protectedOccurrences \}\)/);
  assert.match(source, /localDateInTimeZone\(now, householdTimeZone\)/);
  assert.doesNotMatch(source, /getPaidAmount|getBillMonthlyTotal|paid = Math\.max\(0, paid - settled\)/);
});
