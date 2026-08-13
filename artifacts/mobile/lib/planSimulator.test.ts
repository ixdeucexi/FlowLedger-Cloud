import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { FinancialEvent } from "./forecast";
import {
  buildCanonicalPlanSimulationBaseline,
  decodePlanSimulationChanges,
  normalizePlanSimulationRow,
  planSimulationStorageKey,
  planSimulationStoragePrefix,
  projectPlanSimulation,
  recurringSimulationDates,
  type CanonicalPlanSimulationDay,
  type PlanSimulationChange,
  type PlanSimulationReferences,
} from "./planSimulator";

function event(input: Partial<FinancialEvent> & Pick<FinancialEvent, "id" | "date" | "amount">): FinancialEvent {
  return {
    sourceType: "bill",
    sourceId: "bill-1",
    kind: "bill",
    status: "scheduled",
    name: "Bill",
    ...input,
  };
}

function baselineDays(): CanonicalPlanSimulationDay[] {
  return [
    { date: "2026-08-12", inflow: 1000, outflow: 100, net: 900, balance: 1900, events: [event({ id: "income:income-1:1", sourceType: "income", sourceId: "income-1", kind: "scheduled_income", date: "2026-08-12", amount: 1000, name: "Pay" }), event({ id: "bill:bill-1:1", date: "2026-08-12", amount: -100 })] },
    { date: "2026-08-13", inflow: 0, outflow: 0, net: 0, balance: 1900, events: [] },
    { date: "2026-08-14", inflow: 0, outflow: 0, net: 0, balance: 1900, events: [] },
    { date: "2026-08-15", inflow: 500, outflow: 80, net: 420, balance: 2320, events: [event({ id: "income:income-1:2", sourceType: "income", sourceId: "income-1", kind: "scheduled_income", date: "2026-08-15", amount: 500, name: "Pay" }), event({ id: "bill:bill-1:2", date: "2026-08-15", amount: -80 })] },
    { date: "2026-08-16", inflow: 0, outflow: 0, net: 0, balance: 2320, events: [] },
  ];
}

const references = {
  incomes: [{ id: "income-1", name: "Pay", amount: 500 }],
  bills: [{ id: "bill-1", name: "Bill", amount: 100, frequency: "monthly" as const, isDebt: false }],
  debts: [
    { id: "camera", name: "Camera", balance: 42.81, minimum: 103, apr: 0, dueDay: 11, included: true },
    { id: "concert", name: "Concert", balance: 60.19, minimum: 35, apr: 0, dueDay: 29, included: true },
  ],
  debtMethod: "snowball" as const,
};
const metrics = { flowScore: 72, protectedDays: 18, requiredMonthlyOutflow: 1000, forecastConfidence: "high" as const, currentDebtFreeDate: "2026-11" };

test("strictly decodes every supported version-one change and rejects loose or duplicate definitions", () => {
  const changes: PlanSimulationChange[] = [
    { id: "1", type: "income_add", name: "Side job", amount: 100, frequency: "weekly", startDate: "2026-08-12" },
    { id: "2", type: "income_edit", incomeId: "income-1", amount: 550, effectiveDate: "2026-08-12" },
    { id: "3", type: "income_pause", incomeId: "income-1", effectiveDate: "2026-09-01" },
    { id: "4", type: "income_once", name: "Refund", amount: 30, date: "2026-08-14" },
    { id: "5", type: "bill_add", name: "Storage", amount: 25, frequency: "monthly", startDate: "2026-08-13" },
    { id: "6", type: "bill_edit", billId: "bill-1", amount: 90, effectiveDate: "2026-08-12" },
    { id: "7", type: "bill_pause", billId: "bill-1", effectiveDate: "2026-09-01" },
    { id: "8", type: "bill_move", billId: "bill-1", occurrenceDate: "2026-08-15", newDate: "2026-08-16" },
    { id: "9", type: "spending_once", name: "Trip", amount: 200, date: "2026-08-14" },
    { id: "10", type: "savings_once", name: "Emergency fund", amount: 50, date: "2026-08-14" },
    { id: "11", type: "debt_extra", amount: 100, date: "2026-08-14" },
    { id: "12", type: "debt_payoff", debtId: "concert", date: "2026-08-14" },
  ];
  assert.deepEqual(decodePlanSimulationChanges(changes), changes);
  assert.equal(decodePlanSimulationChanges([{ ...changes[0], unexpected: true }]), null);
  assert.equal(decodePlanSimulationChanges([changes[0], { ...changes[0] }]), null);
  assert.equal(decodePlanSimulationChanges([{ id: "bad", type: "income_once", name: "Bad", amount: 1, date: "2026-02-31" }]), null);
  assert.equal(normalizePlanSimulationRow({ id: "s", household_id: "h", name: "Test", horizon_months: 6, changes, schema_version: 1, version: 0 }), null);
  assert.equal(normalizePlanSimulationRow({ id: "s", household_id: "h", name: "Test", horizon_months: 6, changes, schema_version: 2, version: 1 })?.invalidDefinition, true);
});

test("recurrence clamps month end, handles leap year, and preserves weekly cadence", () => {
  assert.deepEqual(recurringSimulationDates("2028-01-31", "2028-03-31", "monthly"), ["2028-01-31", "2028-02-29", "2028-03-31"]);
  assert.deepEqual(recurringSimulationDates("2026-01-31", "2026-04-30", "quarterly"), ["2026-01-31", "2026-04-30"]);
  assert.deepEqual(recurringSimulationDates("2026-08-12", "2026-08-26", "weekly"), ["2026-08-12", "2026-08-19", "2026-08-26"]);
});

test("zero-change baseline exactly preserves canonical Forecast totals, event dates, and balances", () => {
  const source = baselineDays();
  const baseline = buildCanonicalPlanSimulationBaseline({
    startDate: "2026-08-12",
    horizonMonths: 3,
    getDailyBalances: (month, year) => month === 7 && year === 2026
      ? source.map(day => ({ day: Number(day.date.slice(8)), net: day.net, balance: day.balance, projectedInflow: day.inflow, projectedOutflow: day.outflow, events: day.events }))
      : [],
  });
  const result = projectPlanSimulation({ baseline: { ...baseline, endDate: "2026-08-16" }, changes: [], references, metrics, safetyFloor: 200 });
  assert.deepEqual(result.days.map(day => ({ date: day.date, net: day.net, balance: day.balance })), source.map(day => ({ date: day.date, net: day.net, balance: day.balance })));
  assert.equal(result.flowScore, 72);
  assert.equal(result.protectedDays, 18);
  assert.equal(result.endingBalance, 2320);
});

test("all hypothetical cash changes overlay cloned Forecast days without mutating the live baseline", () => {
  const days = baselineDays();
  const original = structuredClone(days);
  const changes: PlanSimulationChange[] = [
    { id: "income-edit", type: "income_edit", incomeId: "income-1", amount: 600, effectiveDate: "2026-08-15" },
    { id: "bill-edit", type: "bill_edit", billId: "bill-1", amount: 60, effectiveDate: "2026-08-15" },
    { id: "spend", type: "spending_once", name: "Trip", amount: 200, date: "2026-08-14" },
    { id: "save", type: "savings_once", name: "Emergency", amount: 50, date: "2026-08-14" },
    { id: "debt", type: "debt_extra", amount: 500, date: "2026-08-14" },
  ];
  const result = projectPlanSimulation({ baseline: { startDate: "2026-08-12", endDate: "2026-08-16", openingBalance: 1000, days }, changes, references, metrics, safetyFloor: 200 });
  assert.deepEqual(days, original);
  assert.equal(result.savingsAdded, 50);
  assert.equal(result.debtExtraApplied, 103);
  assert.deepEqual(result.debtAllocations.map(item => [item.billId, item.amount]), [["camera", 42.81], ["concert", 60.19]]);
  assert.equal(result.days.find(day => day.date === "2026-08-15")?.net, 540);
  assert.equal(result.complete, true);
});

test("extra debt uses the debt remaining after earlier canonical payments and keeps cash equal to allocations", () => {
  const days = baselineDays();
  days[0].events.push(event({
    id: "camera-required",
    sourceType: "extra_payment",
    sourceId: "camera",
    kind: "debt_payment",
    debtPlanSource: "canonical",
    debtTargetBillId: "camera",
    date: "2026-08-12",
    amount: -42.81,
  }));
  days[0].outflow += 42.81;
  days[0].net -= 42.81;
  const result = projectPlanSimulation({
    baseline: { startDate: "2026-08-12", endDate: "2026-08-16", openingBalance: 1000, days },
    changes: [{ id: "debt", type: "debt_extra", amount: 500, date: "2026-08-14" }],
    references,
    metrics,
    safetyFloor: 200,
  });
  assert.equal(result.debtExtraApplied, 60.19);
  assert.deepEqual(result.debtAllocations.map(item => [item.billId, item.amount]), [["concert", 60.19]]);
  assert.equal(result.days.find(day => day.date === "2026-08-14")?.outflow, 60.19);
});

test("targeted payoff closes only the selected open debt at its remaining balance", () => {
  const result = projectPlanSimulation({
    baseline: { startDate: "2026-08-12", endDate: "2026-08-16", openingBalance: 1000, days: baselineDays() },
    changes: [{ id: "payoff", type: "debt_payoff", debtId: "concert", date: "2026-08-14" }],
    references,
    metrics,
    safetyFloor: 200,
  });
  assert.equal(result.debtExtraApplied, 60.19);
  assert.deepEqual(result.debtAllocations, [{ changeId: "payoff", billId: "concert", billName: "Concert", amount: 60.19, date: "2026-08-14" }]);
  assert.equal(result.days.find(day => day.date === "2026-08-14")?.outflow, 60.19);
  assert.ok(result.days.find(day => day.date === "2026-08-14")?.events.some(item => item.name === "Pay off Concert"));
});

test("targeted payoff fails closed for a closed or missing debt", () => {
  const result = projectPlanSimulation({
    baseline: { startDate: "2026-08-12", endDate: "2026-08-16", openingBalance: 1000, days: baselineDays() },
    changes: [{ id: "payoff", type: "debt_payoff", debtId: "missing", date: "2026-08-14" }],
    references,
    metrics,
    safetyFloor: 200,
  });
  assert.equal(result.debtExtraApplied, 0);
  assert.equal(result.complete, false);
  assert.match(result.issues[0]?.message ?? "", /closed, inactive, or no longer exists/i);
});

test("actual, finalized, and pending occurrences are immutable and stale references need attention", () => {
  const days = baselineDays();
  days[0].events[0] = { ...days[0].events[0], status: "actual" };
  days[0].events[1] = { ...days[0].events[1], status: "pending" };
  const result = projectPlanSimulation({
    baseline: { startDate: "2026-08-12", endDate: "2026-08-16", openingBalance: 1000, days },
    changes: [
      { id: "income", type: "income_edit", incomeId: "income-1", amount: 700, effectiveDate: "2026-08-12" },
      { id: "bill", type: "bill_pause", billId: "missing", effectiveDate: "2026-08-12" },
      { id: "move", type: "bill_move", billId: "bill-1", occurrenceDate: "2026-08-12", newDate: "2026-08-14" },
    ],
    references,
    metrics,
    safetyFloor: 200,
  });
  assert.ok(result.days[0].events.some(item => item.id === "income:income-1:1"));
  assert.ok(result.days[0].events.some(item => item.id === "bill:bill-1:1"));
  assert.equal(result.complete, false);
  assert.equal(result.issues.length, 2);
});

test("saved definitions recompute against changed live balances and viewer drafts are household isolated", () => {
  const change: PlanSimulationChange = { id: "spend", type: "spending_once", name: "Trip", amount: 50, date: "2026-08-14" };
  const first = projectPlanSimulation({ baseline: { startDate: "2026-08-12", endDate: "2026-08-16", openingBalance: 1000, days: baselineDays() }, changes: [change], references, metrics, safetyFloor: 200 });
  const updatedDays = baselineDays().map(day => ({ ...day, balance: day.balance + 100 }));
  const second = projectPlanSimulation({ baseline: { startDate: "2026-08-12", endDate: "2026-08-16", openingBalance: 1100, days: updatedDays }, changes: [change], references, metrics, safetyFloor: 200 });
  assert.equal(second.endingBalance - first.endingBalance, 100);
  assert.notEqual(planSimulationStorageKey("user", "household-a"), planSimulationStorageKey("user", "household-b"));
  assert.ok(planSimulationStorageKey("user", "household-a").startsWith(planSimulationStoragePrefix("user")));
});

test("future debt extras use their actual month in one comparable payoff engine", () => {
  const debtReferences: PlanSimulationReferences = {
    incomes: [],
    bills: [],
    debts: [{ id: "loan", name: "Loan", balance: 5000, minimum: 100, apr: 24, dueDay: 12, included: true, frequency: "monthly" }],
    debtMethod: "snowball",
    payoffStrategyExtrasByMonth: { "2026-11": 25, "2027-02": 40 },
  };
  const dates = ["2026-08-12", "2026-09-12", "2026-10-12", "2026-11-12", "2026-12-12", "2027-01-12", "2027-02-12", "2027-03-12", "2027-04-12", "2027-05-12", "2027-06-12", "2027-07-12"];
  let balance = 5000;
  const days = dates.map(date => {
    balance -= 100;
    return {
      date,
      inflow: 0,
      outflow: 100,
      net: -100,
      balance,
      events: [event({ id: `loan:${date}`, sourceType: "extra_payment", sourceId: "loan", kind: "debt_payment", debtPlanSource: "canonical", debtTargetBillId: "loan", date, amount: -100 })],
    } satisfies CanonicalPlanSimulationDay;
  });
  const baseline = { startDate: dates[0], endDate: dates.at(-1)!, openingBalance: 5000, days };
  const today = projectPlanSimulation({ baseline, changes: [{ id: "extra-now", type: "debt_extra", amount: 1000, date: "2026-08-12" }], references: debtReferences, metrics, safetyFloor: 200 });
  const monthSix = projectPlanSimulation({ baseline, changes: [{ id: "extra-later", type: "debt_extra", amount: 1000, date: "2027-01-12" }], references: debtReferences, metrics, safetyFloor: 200 });
  const multiple = projectPlanSimulation({ baseline, changes: [{ id: "extra-one", type: "debt_extra", amount: 400, date: "2026-08-12" }, { id: "extra-two", type: "debt_extra", amount: 600, date: "2027-01-12" }], references: debtReferences, metrics, safetyFloor: 200 });
  const baselineResult = projectPlanSimulation({ baseline, changes: [], references: debtReferences, metrics, safetyFloor: 200 });

  assert.equal(today.debtExtraApplied, 1000);
  assert.equal(monthSix.debtExtraApplied, 1000);
  assert.equal(multiple.debtExtraApplied, 1000);
  assert.ok(today.potentialDebtFreeDate && monthSix.potentialDebtFreeDate && today.potentialDebtFreeDate < monthSix.potentialDebtFreeDate);
  assert.deepEqual(multiple.debtAllocations.map(item => item.date), ["2026-08-12", "2027-01-12"]);
  assert.equal(baselineResult.payoffImpactMonths, 0);
  assert.equal(baselineResult.potentialDebtFreeDate, projectPlanSimulation({ baseline, changes: [{ id: "future-spend", type: "spending_once", name: "Later", amount: 1, date: "2027-01-12" }], references: debtReferences, metrics, safetyFloor: 200 }).potentialDebtFreeDate);
});

test("debt extras honor active dates while inactive balances remain available for later months", () => {
  const activeReferences: PlanSimulationReferences = {
    incomes: [],
    bills: [],
    debts: [
      { id: "ended", name: "Ended", balance: 10, minimum: 10, apr: 0, dueDay: 1, included: true, frequency: "monthly", endDate: "2026-07-31" },
      { id: "future", name: "Future", balance: 20, minimum: 20, apr: 0, dueDay: 12, included: true, frequency: "monthly", startDate: "2026-09-01" },
      { id: "active", name: "Active", balance: 100, minimum: 25, apr: 0, dueDay: 12, included: true, frequency: "monthly", startDate: "2026-01-01" },
    ],
    debtMethod: "snowball",
  };
  const baseline = { startDate: "2026-08-12", endDate: "2026-09-12", openingBalance: 1000, days: [
    { date: "2026-08-12", inflow: 0, outflow: 0, net: 0, balance: 1000, events: [] },
    { date: "2026-09-12", inflow: 0, outflow: 0, net: 0, balance: 1000, events: [] },
  ] };
  const result = projectPlanSimulation({
    baseline,
    changes: [
      { id: "aug-extra", type: "debt_extra", amount: 50, date: "2026-08-12" },
      { id: "sep-extra", type: "debt_extra", amount: 30, date: "2026-09-12" },
    ],
    references: activeReferences,
    metrics,
    safetyFloor: 200,
  });
  assert.deepEqual(result.debtAllocations.map(item => [item.changeId, item.billId, item.amount]), [
    ["aug-extra", "active", 50],
    ["sep-extra", "future", 20],
    ["sep-extra", "active", 10],
  ]);
  assert.ok(result.debtAllocations.every(item => item.billId !== "ended"));
});

test("payoff comparison waits for a future-start debt and never routes strategy money to an ended debt", () => {
  const payoffReferences: PlanSimulationReferences = {
    incomes: [], bills: [], debtMethod: "snowball", payoffStrategyExtrasByMonth: { "2026-08": 50 },
    debts: [
      { id: "ended", name: "Ended", balance: 10, minimum: 10, apr: 0, dueDay: 1, included: true, frequency: "monthly", endDate: "2026-07-31" },
      { id: "active", name: "Active", balance: 50, minimum: 0, apr: 0, dueDay: 12, included: true, frequency: "monthly" },
      { id: "future", name: "Future", balance: 100, minimum: 100, apr: 0, dueDay: 12, included: true, frequency: "monthly", startDate: "2026-09-01" },
    ],
  };
  const futurePayment = event({ id: "future-required", sourceType: "extra_payment", sourceId: "future", kind: "debt_payment", debtPlanSource: "canonical", debtTargetBillId: "future", date: "2026-09-12", amount: -100 });
  const result = projectPlanSimulation({
    baseline: { startDate: "2026-08-12", endDate: "2026-09-12", openingBalance: 1000, days: [
      { date: "2026-08-12", inflow: 0, outflow: 0, net: 0, balance: 1000, events: [] },
      { date: "2026-09-12", inflow: 0, outflow: 100, net: -100, balance: 900, events: [futurePayment] },
    ] },
    changes: [], references: payoffReferences, metrics, safetyFloor: 200,
  });
  assert.equal(result.potentialDebtFreeDate, "2026-09");
});

test("future-only changes and longer horizons do not change current Flow Score or Protected Days", () => {
  const currentDay: CanonicalPlanSimulationDay = { date: "2026-08-12", inflow: 0, outflow: 0, net: 0, balance: 1900, events: [] };
  const futureDay: CanonicalPlanSimulationDay = { date: "2026-09-12", inflow: 0, outflow: 0, net: 0, balance: 1900, events: [] };
  const change: PlanSimulationChange = { id: "future", type: "spending_once", name: "Future purchase", amount: 900, date: futureDay.date };
  const short = projectPlanSimulation({ baseline: { startDate: currentDay.date, endDate: "2026-10-31", openingBalance: 1900, days: [currentDay, futureDay] }, changes: [change], references: { ...references, debts: [] }, metrics, safetyFloor: 200 });
  const long = projectPlanSimulation({ baseline: { startDate: currentDay.date, endDate: "2028-07-31", openingBalance: 1900, days: [currentDay, futureDay] }, changes: [change], references: { ...references, debts: [] }, metrics, safetyFloor: 200 });

  assert.equal(short.flowScore, metrics.flowScore);
  assert.equal(short.protectedDays, metrics.protectedDays);
  assert.equal(long.flowScore, short.flowScore);
  assert.equal(long.protectedDays, short.protectedDays);
});

test("simulator baseline uses only post-anchor projection events and cannot revive an absorbed plan", () => {
  const plannedBill = event({ id: "absorbed-bill", sourceType: "bill", sourceId: "bill-1", date: "2026-08-12", amount: -100 });
  const bankEvent = event({ id: "bank-anchor", sourceType: "reconciliation", sourceId: "2026-08-12", kind: "bank_adjustment", status: "actual", date: "2026-08-12", amount: -100 });
  const baseline = buildCanonicalPlanSimulationBaseline({
    startDate: "2026-08-12",
    horizonMonths: 3,
    getDailyBalances: () => [{ day: 12, net: -100, balance: 900, projectedInflow: 0, projectedOutflow: 100, events: [plannedBill], projectionEvents: [bankEvent] }],
  });
  assert.deepEqual(baseline.days[0].events.map(item => item.id), ["bank-anchor"]);
  const result = projectPlanSimulation({ baseline: { ...baseline, endDate: "2026-08-12" }, changes: [{ id: "pause", type: "bill_pause", billId: "bill-1", effectiveDate: "2026-08-12" }], references: { ...references, debts: [] }, metrics, safetyFloor: 200 });
  assert.equal(result.days[0].net, -100);
  assert.deepEqual(result.days[0].events.map(item => item.id), ["bank-anchor"]);
  assert.equal(result.complete, false);
});

test("partial settlements stay immutable while edits replace only the remaining occurrence", () => {
  const actualIncome = event({ id: "actual-income", sourceType: "transaction", sourceId: "tx-income", kind: "transaction_income", status: "actual", date: "2026-08-15", amount: 40 });
  const remainingIncome = event({ id: "remaining-income", sourceType: "income", sourceId: "income-1", kind: "scheduled_income", status: "scheduled", date: "2026-08-15", amount: 60, configuredOccurrenceAmount: 100, settledOccurrenceAmount: 40 });
  const actualBill = event({ id: "actual-bill", sourceType: "transaction", sourceId: "tx-bill", kind: "transaction_expense", status: "actual", date: "2026-08-15", amount: -30 });
  const remainingBill = event({ id: "remaining-bill", sourceType: "bill", sourceId: "bill-1", kind: "bill", status: "scheduled", date: "2026-08-15", amount: -70, configuredOccurrenceAmount: 100, settledOccurrenceAmount: 30 });
  const baseline = { startDate: "2026-08-12", endDate: "2026-08-15", openingBalance: 1000, days: [{ date: "2026-08-15", inflow: 100, outflow: 100, net: 0, balance: 1000, events: [actualIncome, remainingIncome, actualBill, remainingBill] }] };
  const edited = projectPlanSimulation({ baseline, changes: [{ id: "income-edit", type: "income_edit", incomeId: "income-1", amount: 120, effectiveDate: "2026-08-15" }, { id: "bill-edit", type: "bill_edit", billId: "bill-1", amount: 120, effectiveDate: "2026-08-15" }], references: { ...references, debts: [] }, metrics, safetyFloor: 200 });
  const editedEvents = edited.days[0].events;
  assert.equal(editedEvents.find(item => item.id === "actual-income")?.amount, 40);
  assert.equal(editedEvents.find(item => item.id === "actual-bill")?.amount, -30);
  assert.equal(editedEvents.find(item => item.sourceType === "income" && item.sourceId === "income-1")?.amount, 80);
  assert.equal(editedEvents.find(item => item.sourceType === "bill" && item.sourceId === "bill-1")?.amount, -90);
  assert.equal(edited.days[0].inflow, 120);
  assert.equal(edited.days[0].outflow, 120);
  assert.equal(edited.requiredMonthlyOutflow, 1020);

  const paused = projectPlanSimulation({ baseline, changes: [{ id: "income-pause", type: "income_pause", incomeId: "income-1", effectiveDate: "2026-08-15" }, { id: "bill-pause", type: "bill_pause", billId: "bill-1", effectiveDate: "2026-08-15" }], references: { ...references, debts: [] }, metrics, safetyFloor: 200 });
  assert.deepEqual(paused.days[0].events.map(item => item.id).sort(), ["actual-bill", "actual-income"]);
  assert.equal(paused.days[0].inflow, 40);
  assert.equal(paused.days[0].outflow, 30);
});

test("required outflow uses exact current occurrences, overrides, and only open mid-month events", () => {
  const billReferences: PlanSimulationReferences = {
    incomes: [], debts: [], debtMethod: "snowball",
    bills: [
      { id: "weekly", name: "Weekly", amount: 50, frequency: "weekly", isDebt: false, currentMonthConfiguredTotal: 250, currentMonthEffectiveTotal: 250, currentMonthOccurrenceCount: 5, currentMonthOpenOccurrenceCount: 3 },
      { id: "biweekly", name: "Biweekly", amount: 30, frequency: "biweekly", isDebt: false, currentMonthConfiguredTotal: 90, currentMonthEffectiveTotal: 90, currentMonthOccurrenceCount: 3, currentMonthOpenOccurrenceCount: 2 },
      { id: "override", name: "Override", amount: 100, frequency: "monthly", isDebt: false, currentMonthConfiguredTotal: 75, currentMonthEffectiveTotal: 75, currentMonthOccurrenceCount: 1, currentMonthOpenOccurrenceCount: 1 },
    ],
  };
  const makeDay = (date: string, events: FinancialEvent[]): CanonicalPlanSimulationDay => {
    const outflow = events.reduce((sum, item) => sum + Math.abs(item.amount), 0);
    return { date, inflow: 0, outflow, net: -outflow, balance: 2000 - outflow, events };
  };
  const days = [
    makeDay("2026-08-15", [event({ id: "weekly-15", sourceId: "weekly", date: "2026-08-15", amount: -50 }), event({ id: "biweekly-15", sourceId: "biweekly", date: "2026-08-15", amount: -30 })]),
    makeDay("2026-08-20", [event({ id: "override-20", sourceId: "override", date: "2026-08-20", amount: -75 })]),
    makeDay("2026-08-22", [event({ id: "weekly-22", sourceId: "weekly", date: "2026-08-22", amount: -50 })]),
    makeDay("2026-08-29", [event({ id: "weekly-29", sourceId: "weekly", date: "2026-08-29", amount: -50 }), event({ id: "biweekly-29", sourceId: "biweekly", date: "2026-08-29", amount: -30 })]),
    makeDay("2026-09-12", [event({ id: "weekly-september", sourceId: "weekly", date: "2026-09-12", amount: -50 })]),
  ];
  const baseline = { startDate: "2026-08-11", endDate: "2026-09-12", openingBalance: 2000, days };
  const edited = projectPlanSimulation({ baseline, changes: [
    { id: "weekly-edit", type: "bill_edit", billId: "weekly", amount: 60, effectiveDate: "2026-08-11" },
    { id: "biweekly-edit", type: "bill_edit", billId: "biweekly", amount: 40, effectiveDate: "2026-08-11" },
    { id: "override-edit", type: "bill_edit", billId: "override", amount: 100, effectiveDate: "2026-08-11" },
  ], references: billReferences, metrics, safetyFloor: 200 });
  assert.equal(edited.requiredMonthlyOutflow, 1075);

  const futureOnly = projectPlanSimulation({ baseline, changes: [{ id: "future-edit", type: "bill_edit", billId: "weekly", amount: 75, effectiveDate: "2026-09-01" }], references: billReferences, metrics, safetyFloor: 200 });
  assert.equal(futureOnly.requiredMonthlyOutflow, 1000);

  const paused = projectPlanSimulation({ baseline, changes: [{ id: "weekly-pause", type: "bill_pause", billId: "weekly", effectiveDate: "2026-08-11" }], references: billReferences, metrics, safetyFloor: 200 });
  assert.equal(paused.requiredMonthlyOutflow, 850);
});

test("new weekly and biweekly bills use five and three exact monthly occurrences", () => {
  const dates = ["2026-08-01", "2026-08-02", "2026-08-09", "2026-08-15", "2026-08-16", "2026-08-23", "2026-08-29", "2026-08-30"];
  const days = dates.map(date => ({ date, inflow: 0, outflow: 0, net: 0, balance: 2000, events: [] }));
  const result = projectPlanSimulation({
    baseline: { startDate: "2026-08-01", endDate: "2026-08-31", openingBalance: 2000, days },
    changes: [
      { id: "weekly-add", type: "bill_add", name: "Weekly", amount: 50, frequency: "weekly", startDate: "2026-08-02" },
      { id: "biweekly-add", type: "bill_add", name: "Biweekly", amount: 30, frequency: "biweekly", startDate: "2026-08-01" },
    ],
    references: { incomes: [], bills: [], debts: [], debtMethod: "snowball" }, metrics, safetyFloor: 200,
  });
  assert.equal(result.requiredMonthlyOutflow, 1340);
  assert.equal(result.complete, true);
});

test("sequential edits retain canonical provenance so later edits and pauses compose", () => {
  const days: CanonicalPlanSimulationDay[] = [{ date: "2026-08-15", inflow: 100, outflow: 100, net: 0, balance: 1000, events: [
    event({ id: "income-open", sourceType: "income", sourceId: "income-1", kind: "scheduled_income", date: "2026-08-15", amount: 100 }),
    event({ id: "bill-open", sourceType: "bill", sourceId: "bill-1", kind: "bill", date: "2026-08-15", amount: -100 }),
  ] }];
  const result = projectPlanSimulation({
    baseline: { startDate: "2026-08-12", endDate: "2026-08-15", openingBalance: 1000, days },
    changes: [
      { id: "income-first", type: "income_edit", incomeId: "income-1", amount: 120, effectiveDate: "2026-08-15" },
      { id: "income-second", type: "income_edit", incomeId: "income-1", amount: 150, effectiveDate: "2026-08-15" },
      { id: "bill-first", type: "bill_edit", billId: "bill-1", amount: 130, effectiveDate: "2026-08-15" },
      { id: "bill-pause", type: "bill_pause", billId: "bill-1", effectiveDate: "2026-08-15" },
    ],
    references: { ...references, debts: [] },
    metrics,
    safetyFloor: 200,
  });
  const remaining = result.days[0].events;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].sourceType, "income");
  assert.equal(remaining[0].sourceId, "income-1");
  assert.equal(remaining[0].amount, 150);
  assert.equal(result.complete, true);
});

test("unsupported saved definitions stay incomplete until explicitly reset", () => {
  const result = projectPlanSimulation({
    baseline: { startDate: "2026-08-12", endDate: "2026-08-16", openingBalance: 1000, days: baselineDays() },
    changes: [],
    references,
    metrics,
    safetyFloor: 200,
    definitionIssue: "Unsupported saved definition",
  });
  assert.equal(result.complete, false);
  assert.equal(result.issues[0]?.changeId, "definition");
  assert.equal(result.issues[0]?.message, "Unsupported saved definition");
});

test("migration enforces Pro household RLS, editor writes, immutable audit fields, and bounded definitions", () => {
  const sql = readFileSync(path.resolve(process.cwd(), "../../supabase/migrations/20260811204342_create_plan_simulations.sql"), "utf8");
  assert.match(sql, /create table public\.plan_simulations/i);
  assert.match(sql, /jsonb_array_length\(changes\) <= 50/i);
  assert.match(sql, /octet_length\(changes::text\) <= 65536/i);
  assert.match(sql, /schema_version smallint not null default 1 check \(schema_version = 1\)/i);
  assert.match(sql, /plan\.tier = 'pro'/i);
  assert.match(sql, /is_household_member\(household_id\)/i);
  assert.match(sql, /member\.role in \('owner', 'manager', 'editor'\)/i);
  assert.match(sql, /for update to authenticated[\s\S]*using[\s\S]*with check/i);
  assert.match(sql, /new\.version is distinct from old\.version \+ 1/i);
  assert.match(sql, /grant update \(name, horizon_months, changes, version\)/i);
  assert.match(sql, /revoke all on table public\.plan_simulations from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(sql, /grant all on table public\.plan_simulations to service_role/i);
  assert.doesNotMatch(sql, /decisions/i);
});

test("Plan Simulator is a direct Pro route launched only from mobile and desktop Forecast", () => {
  const route = readFileSync(path.resolve(process.cwd(), "app/plan-simulator.tsx"), "utf8");
  const forecast = readFileSync(path.resolve(process.cwd(), "app/(tabs)/monthly.tsx"), "utf8");
  const desktopForecast = readFileSync(path.resolve(process.cwd(), "components/desktop/DesktopCalendarPage.tsx"), "utf8");
  const rootLayout = readFileSync(path.resolve(process.cwd(), "app/_layout.tsx"), "utf8");
  assert.match(route, /isFeatureLocked\("plan_simulator"\)/);
  assert.match(route, /getPlanSimulationBaseline/);
  assert.match(route, /projectPlanSimulation/);
  assert.match(route, /canEditHousehold/);
  assert.match(route, /planSimulationStorageKey\(user\.id, householdId\)/);
  assert.match(route, /Nothing in this workspace changes the real plan/);
  assert.match(route, /minHeight: 44[\s\S]*chip/);
  assert.doesNotMatch(route, /chip:\s*\{[^}]*minHeight:\s*40/);
  assert.match(route, /Reset unsupported changes/);
  assert.match(route, /Boolean\(draft\.invalidDefinition\)/);
  assert.match(route, /DatePickerField value=\{date\}/);
  assert.match(route, /label: "Pay off a debt"/);
  assert.match(route, /type: "debt_payoff"/);
  assert.doesNotMatch(route, /label=["']Apply["']/);
  assert.match(forecast, /router\.push\("\/plan-simulator"\)/);
  assert.match(desktopForecast, /Plan Simulator/);
  assert.match(rootLayout, /name="plan-simulator"/);
});
