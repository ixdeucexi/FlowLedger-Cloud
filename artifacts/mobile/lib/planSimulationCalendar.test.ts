import assert from "node:assert/strict";
import test from "node:test";
import { projectPlanSimulation, type CanonicalPlanSimulationDay } from "./planSimulator";
import type { FinancialEvent } from "./forecast";
import { createCalendarEventLabelResolver } from "./desktopCalendar";
import { simulationCalendarCells, simulationCalendarDays, simulationCalendarDifference, simulationCalendarEventKind, simulationCalendarMonth, simulationCalendarMonths, simulationCalendarSelectedDay } from "./planSimulationCalendar";

const event = (id: string, date: string, amount: number, kind: FinancialEvent["kind"] = "bill"): FinancialEvent => ({ id, date, amount, kind, sourceType: "decision", sourceId: id, status: "scheduled", name: "Saved name " + id });
const day = (date: string, balance: number, events: FinancialEvent[] = []): CanonicalPlanSimulationDay => ({ date, balance, events, inflow: 20.25, outflow: 30.50, net: -10.25 });

test("calendar indexing retains exact financial rows and events without mutating inputs or filling dates", () => {
  const rows = [day("2026-11-14", 100.01), day("2026-11-15", -30.23, [event("pending", "2026-11-15", -10.25)]), day("2026-11-17", 70.44), day("2026-12-01", 90)];
  rows[1].events[0].status = "pending";
  rows.forEach(row => { row.events.forEach(Object.freeze);Object.freeze(row.events);Object.freeze(row); });Object.freeze(rows);
  const before = JSON.stringify(rows);
  const index = simulationCalendarDays(rows, "2026-11-15", "2026-11-30");
  assert.deepEqual([...index.keys()], ["2026-11-15", "2026-11-17"]);
  assert.equal(index.get("2026-11-15"), rows[1]);
  assert.equal(index.get("2026-11-15")!.events, rows[1].events);
  assert.equal(index.get("2026-11-15")!.events[0].status, "pending");
  assert.equal(index.has("2026-11-16"), false);
  assert.equal(JSON.stringify(rows), before);
});

test("month grid includes leap day, six stable weeks, and true December/January dates", () => {
  const feb = day("2028-02-29", 123.45);
  const febIndex = simulationCalendarDays([feb], "2028-02-01", "2028-02-29");
  const cells = simulationCalendarCells("2028-02", febIndex, new Map());
  assert.equal(cells.length, 42);
  assert.equal(cells.filter(cell => cell.inCurrentMonth).length, 29);
  assert.equal(cells.find(cell => cell.date === "2028-02-29")!.scenario, feb);
  assert.equal(cells.find(cell => cell.date === "2028-03-01")!.scenario, undefined);
  const january = simulationCalendarCells("2027-01", new Map(), new Map());
  assert.equal(january[0].date, "2026-12-27");
  assert.equal(january[6].date, "2027-01-02");
});

test("missing current plan does not hide an available scenario date or manufacture a zero comparison", () => {
  const scenario = day("2026-11-15", -25.75);
  const cells = simulationCalendarCells("2026-11", new Map([[scenario.date, scenario]]), new Map());
  const selected = simulationCalendarSelectedDay(cells, scenario.date)!;
  assert.equal(selected.scenario, scenario);
  assert.equal(selected.current, undefined);
  assert.equal(simulationCalendarDifference(selected.scenario, selected.current), null);
  assert.equal(cells.find(cell => cell.date === "2026-11-16")!.scenario, undefined);
});

test("selection only resolves actual finite scenario days and resets safely after coverage changes", () => {
  const valid = day("2026-11-15", 0);
  const invalid = day("2026-11-16", Number.NaN);
  const future = day("2026-11-20", 200);
  const index = simulationCalendarDays([valid, invalid, future], "2026-11-01", "2026-11-30");
  const cells = simulationCalendarCells("2026-11", index, new Map());
  assert.equal(simulationCalendarSelectedDay(cells, future.date)!.date, future.date);
  assert.equal(simulationCalendarSelectedDay(cells, invalid.date)!.date, valid.date);
  assert.equal(simulationCalendarSelectedDay(cells, "2026-12-01")!.date, valid.date);
  assert.equal(simulationCalendarSelectedDay(simulationCalendarCells("2027-01", new Map(), new Map()), valid.date), null);
});

test("available month navigation sorts dates, excludes outside horizon and clamps a shorter loaded option", () => {
  const index = simulationCalendarDays([day("2027-02-04", 20), day("2026-12-31", 10), day("2027-01-02", 30), day("2027-01-20", 40), day("2027-03-01", 50)], "2026-12-31", "2027-02-28");
  const months = simulationCalendarMonths(index);
  assert.deepEqual(months, ["2026-12", "2027-01", "2027-02"]);
  assert.equal(simulationCalendarMonth(months, null), "2026-12");
  assert.equal(simulationCalendarMonth(months, "2027-01"), "2027-01");
  assert.equal(simulationCalendarMonth(months.slice(0, 2), "2027-02"), "2027-01");
  assert.equal(simulationCalendarMonth(months, "2025-12"), "2026-12");
  assert.equal(simulationCalendarMonth([], "2027-02"), null);
  assert.deepEqual(simulationCalendarMonths(simulationCalendarDays([day("invalid", 10)], "2026-01-01", "2027-12-31")), []);
});

test("presentation differences preserve signed cents and unavailable values", () => {
  const a = day("2026-11-15", 100.10), b = day("2026-11-15", 100.30);
  assert.equal(simulationCalendarDifference(a, b), -.20);
  assert.equal(simulationCalendarDifference(b, a), .20);
  assert.equal(simulationCalendarDifference(a, a), 0);
  assert.equal(Object.is(simulationCalendarDifference(day(a.date, 100.101), day(a.date, 100.102)), -0), false);
  assert.equal(simulationCalendarDifference(a), null);
  assert.equal(simulationCalendarDifference(day(a.date, Number.POSITIVE_INFINITY), b), null);
});

test("simulator-specific income and bills keep semantic category colors despite decision source", () => {
  assert.equal(simulationCalendarEventKind(event("income", "2026-11-15", 100, "scheduled_income")), "income");
  assert.equal(simulationCalendarEventKind(event("bill", "2026-11-15", -100, "bill")), "bill");
  assert.equal(simulationCalendarEventKind(event("debt", "2026-11-15", -100, "debt_payment")), "debt");
  assert.equal(simulationCalendarEventKind(event("goal", "2026-11-15", -100, "goal")), "plan");
  assert.equal(simulationCalendarEventKind(event("purchase", "2026-11-15", -100, "transaction_expense")), "spending");
  assert.equal(simulationCalendarEventKind({ ...event("pending", "2026-11-15", -10), sourceType: "transaction", kind: "transaction_expense", status: "pending" }), "spending");
});

test("calendar event labels use current saved transaction names while preserving synthetic labels and event provenance", () => {
  const bank = { ...event("bank", "2026-11-15", -20), sourceType: "transaction" as const, sourceId: "tx", name: "BANK RAW NAME" };
  const transaction = { id: "tx", amount: -20, date: bank.date, category: "Other", note: "BANK RAW NAME", merchant_name: "Bank merchant", linked_bill_id: "bill", match_reason: "confirmed_bill_match" };
  const resolver = createCalendarEventLabelResolver([transaction], [{ id: "bill", name: "My electric bill" }]);
  const rows = simulationCalendarDays([day(bank.date, 50, [bank])], bank.date, bank.date);
  const resultEvent = rows.get(bank.date)!.events[0];
  assert.equal(resultEvent, bank);
  assert.equal(resolver(resultEvent), "My electric bill");
  assert.equal(resultEvent.name, "BANK RAW NAME", "Label resolution cannot rewrite financial snapshots.");
  assert.equal(resolver(event("hypothetical", bank.date, 100, "scheduled_income")), "Saved name hypothetical");
  assert.equal(createCalendarEventLabelResolver([{ ...transaction, user_edited_at: bank.date, note: "My custom label" }], [{ id: "bill", name: "My electric bill" }])(bank), "My custom label");
});

test("calendar uses actual mixed what-if projection rows, signed amounts and live recomputed results", () => {
  const rows = [day("2026-11-15", 1000), day("2026-11-16", 1000), day("2026-11-17", 1000)];
  rows.forEach(row => { row.inflow = 0;row.outflow = 0;row.net = 0; });
  const shared = { baseline: { startDate: "2026-11-15", endDate: "2026-11-17", openingBalance: 1000, days: rows }, references: { incomes: [], bills: [], debts: [], debtMethod: "snowball" as const }, metrics: { flowScore: 85, flowScoreRequiredAmountDue: 0, flowScoreRequiredAmountCovered: 0, protectedDays: 3, requiredMonthlyOutflow: 0, forecastConfidence: "high" as const, currentDebtFreeDate: null }, safetyFloor: 200 };
  const current = projectPlanSimulation({ ...shared, changes: [] });
  const changed = projectPlanSimulation({ ...shared, changes: [{ id: "pay", type: "income_once", name: "Side work", amount: 50.25, date: "2026-11-16" }, { id: "storage", type: "bill_add", name: "Storage", amount: 12.10, frequency: "monthly", startDate: "2026-11-16" }] });
  assert.equal(changed.complete, true);
  const currentIndex = simulationCalendarDays(current.days, shared.baseline.startDate, shared.baseline.endDate);
  const changedIndex = simulationCalendarDays(changed.days, shared.baseline.startDate, shared.baseline.endDate);
  const selected = simulationCalendarSelectedDay(simulationCalendarCells("2026-11", changedIndex, currentIndex), "2026-11-16")!;
  assert.equal(selected.scenario, changed.days[1]);
  assert.equal(selected.scenario!.balance, 1038.15);
  assert.equal(selected.scenario!.inflow, 50.25);
  assert.equal(selected.scenario!.outflow, 12.10);
  assert.equal(simulationCalendarDifference(selected.scenario, selected.current), 38.15);
  assert.deepEqual(selected.scenario!.events.map(row => [row.name, row.amount, simulationCalendarEventKind(row)]), [["Side work", 50.25, "income"], ["Storage", -12.10, "bill"]]);
  const reset = projectPlanSimulation({ ...shared, changes: [] });
  assert.equal(simulationCalendarDays(reset.days, shared.baseline.startDate, shared.baseline.endDate).get("2026-11-16")!.balance, 1000);
  assert.equal(selected.scenario!.balance, 1038.15, "Refreshing the calendar cannot mutate earlier result snapshots.");
});
