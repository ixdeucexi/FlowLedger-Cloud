import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialEvent } from "./forecast";
import { readFileSync } from "node:fs";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import golden from "./financialProjection.golden.json";
import { createFinancialProjection } from "./financialProjection";
import type { FinancialProjectionSnapshot } from "./financialProjectionTypes";
import { decodeScenarioDraft, decodeScenarioLibrary, decodeScenarioWorking, emptyScenarioLibrary, putDeviceScenario } from "./planSimulationLibrary";
import { compareSavedPlanScenarios } from "./planSimulationComparison";
import {
  buildCanonicalPlanSimulationBaseline, decodePlanSimulationChanges, normalizePlanSimulationRow, projectPlanSimulation, simulationDebtReference,
  type PlanSimulationBaseline, type PlanSimulationChange, type PlanSimulationReferences,
} from "./planSimulator";

const metrics = { flowScore: 85, flowScoreRequiredAmountDue: 100, flowScoreRequiredAmountCovered: 100, protectedDays: 10, requiredMonthlyOutflow: 100, forecastConfidence: "high" as const, currentDebtFreeDate: null };
const debtEvent = (date: string, amount: number, source = "loan", target = source): FinancialEvent => ({
  id: source + ":" + target + ":" + date,
  date, amount: -amount, sourceType: "extra_payment", sourceId: source,
  kind: "debt_payment", status: "scheduled", name: target + " payment",
  debtTargetBillId: target, debtPlanSource: "canonical", debtPlanAllocationKind: "required",
});
function baseline(events: FinancialEvent[] = [], endDate = "2026-03-31", startDate = "2026-01-01"): PlanSimulationBaseline {
  const days: PlanSimulationBaseline["days"] = [];
  let balance = 10_000;
  for (let date = new Date(startDate + "T12:00:00Z"); date.toISOString().slice(0, 10) <= endDate; date.setUTCDate(date.getUTCDate() + 1)) {
    const iso = date.toISOString().slice(0, 10);
    const rows = events.filter(event => event.date === iso);
    const inflow = rows.reduce((sum, event) => sum + Math.max(0, event.amount), 0);
    const outflow = rows.reduce((sum, event) => sum + Math.max(0, -event.amount), 0);
    const net = inflow - outflow;
    balance = Math.round((balance + net) * 100) / 100;
    days.push({ date: iso, inflow, outflow, net, balance, events: rows });
  }
  return { startDate, endDate, openingBalance: 10_000, days };
}
function fixture(apr = 0) {
  const dates = ["2026-01-15", "2026-02-15", "2026-03-15"];
  const refs: PlanSimulationReferences = {
    incomes: [], bills: [{ id: "loan", name: "Loan", amount: 100, frequency: "monthly", isDebt: true }],
    debts: [{ id: "loan", name: "Loan", balance: 1000, minimum: 100, apr, dueDay: 15, frequency: "monthly", included: true,
      occurrences: dates.map(date => ({ date, configuredAmount: 100, settledAmount: 0, remainingAmount: 100 })) }],
    debtMethod: "snowball", payoffStrategyExtrasAreSavedPlans: true,
  };
  return { baseline: baseline(dates.map(date => debtEvent(date, 100))), references: refs, metrics, safetyFloor: 200 };
}
const run = (changes: PlanSimulationChange[], data = fixture()) => projectPlanSimulation({ ...data, changes, useDebtControlTimeline: true });
const total = (result: ReturnType<typeof run>) => result.months.reduce((sum, month) => sum + month.outflows, 0);
const add: Extract<PlanSimulationChange, { type: "debt_add" }> = {
  id: "new", type: "debt_add", name: "New loan", balance: 500, apr: 0, amount: 100, frequency: "monthly", startDate: "2026-01-15",
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Exercise the actual Forecast and UI-reference boundary: future allocations
// credit freed source money to a different target, and carry rows retain their
// original occurrence provenance. Synthetic source schedules miss both facts.
function realFixture(options: { asof?: string; amount?: number; balance?: number; largeBalance?: number; apr?: number; frequency?: "monthly" | "weekly" | "biweekly"; single?: boolean; pending?: boolean; override?: number; boost?: number; savedDate?: string } = {}) {
  const asof = options.asof ?? "2026-10-01";
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  const template = snapshot.bills[0];
  snapshot.bills = [{ ...template, id: "small", name: "Small", is_debt: true, balance: options.balance ?? 70,
    amount: options.amount ?? 100, interest_rate: options.apr ?? 0, due_day: 15, include_in_snowball: true,
    snowball_minimum_boost: options.boost ?? 0, frequency: options.frequency ?? "monthly",
    ...(options.frequency && options.frequency !== "monthly" ? { day_of_week: 5, next_payment_date: "2026-10-02" } : {}) }];
  if (!options.single) snapshot.bills.push({ ...template, id: "large", name: "Large", is_debt: true, balance: options.largeBalance ?? 3000,
    amount: 50, interest_rate: 0, due_day: 20, include_in_snowball: true, snowball_minimum_boost: 0 });
  snapshot.incomes = []; snapshot.goals = []; snapshot.decisions = []; snapshot.transactions = [];
  snapshot.overrides = []; snapshot.billDateMoves = []; snapshot.extraPayments = []; snapshot.accounts = [];
  if (options.override !== undefined) snapshot.overrides = [{ id: "override", bill_id: "small", year: 2026, month: 9, planned_debt_amount: options.override, paid_amount: 0 }];
  if (options.savedDate) snapshot.extraPayments = [{ id: "saved", month: Number(options.savedDate.slice(5, 7)) - 1, year: Number(options.savedDate.slice(0, 4)), amount: 100, payment_date: options.savedDate,
    allocations: [{ billId: options.single ? "small" : "large", billName: options.single ? "Small" : "Large", payment: 100, balanceBefore: 3000, balanceAfter: 2900, paidOff: false }],
    sources: [{ type: "manual", amount: 100, pendingBalanceApply: true }] }];
  if (options.pending) {
    snapshot.pendingBankTransactions = [{ plaid_transaction_id: "pending", transaction_date: "2026-10-01", amount: 100, name: "Small payment", category: "Debt" }];
    snapshot.pendingPlanMatches = [{ id: "match", pending_plaid_transaction_id: "pending", target_type: "bill", target_id: "small", target_name: "Small", occurrence_date: options.frequency === "weekly" ? "2026-10-02" : "2026-10-15", planned_amount: 100, pending_amount: 100, pending_transaction_date: "2026-10-01", status: "active", created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z" }];
  }
  snapshot.connectedBankAccounts = [{ id: "bank", name: "Checking", current_balance: 10000, is_active: true,
    account_type: "depository", account_subtype: "checking", updated_at: asof + "T12:00:00Z" }];
  Object.assign(snapshot.settings, { starting_balance: 10000, starting_balance_date: asof, debtPayoffEnabled: true, paymentMethod: "snowball" });
  const projection = createFinancialProjection(snapshot, { now: new Date(asof + "T12:00:00Z"), timeZone: "America/Chicago" });
  const sourceBaseline = buildCanonicalPlanSimulationBaseline({ startDate: asof, horizonMonths: 3, getDailyBalances: projection.getDailyBalances });
  const app = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = app.indexOf("  const buildReferences =");
  assert.ok(start > 0);
  const script = transpileModule(app.slice(start, app.indexOf("  const references =", start)), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const bindings: Record<string, unknown> = { useCallback: (callback: unknown) => callback, bills: snapshot.bills,
    incomes: [], currentMonth: 9, currentYear: 2026, livePayoffPreview: null, settings: snapshot.settings };
  for (const name of ["getBillEffectiveMonthlyTotal", "getBillMonthlyTotal", "getBillOccurrenceAmount", "getBillOccurrencesInMonth", "getDebtMonthSettlements", "getDebtSourceCommitment", "getExtraPayment"] as const) bindings[name] = projection[name];
  const references = new Function(...Object.keys(bindings), script + ";return buildReferences;")(...Object.values(bindings))(sourceBaseline) as PlanSimulationReferences;
  return { baseline: sourceBaseline, references, metrics, safetyFloor: 0 };
}
function datedAllocations(value: PlanSimulationBaseline | ReturnType<typeof run>) {
  const grouped = new Map<string, number>();
  value.days.flatMap(day => day.events).forEach(event => {
    const id = [event.date, event.debtTargetBillId ?? event.sourceId, event.debtPlanAllocationKind ?? event.kind].join("|");
    grouped.set(id, Math.round(((grouped.get(id) ?? 0) + event.amount) * 100) / 100);
  });
  return [...grouped].filter(([, amount]) => Math.abs(amount) > .005).sort(([a], [b]) => a.localeCompare(b));
}

test("real Forecast source lifecycle preserves exact dated no-op cash and full-month interest", () => {
  for (const frequency of ["monthly", "weekly", "biweekly"] as const) {
    const data = realFixture({ frequency });
    const current = run([], data), same = run([{ id: "same", type: "debt_edit", debtId: "small", amount: 100, effectiveDate: data.baseline.startDate }], data);
    assert.equal(same.complete, true);
    assert.deepEqual(datedAllocations(same), datedAllocations(data.baseline));
    assert.equal(same.endingBalance, current.endingBalance);
    assert.equal(same.potentialDebtFreeDate, current.potentialDebtFreeDate);
    if (frequency === "monthly") assert.equal(same.potentialDebtFreeDate, "2028-06");
  }
  const interest = realFixture({ balance: 100, apr: 12, single: true });
  const same = run([{ id: "same", type: "debt_edit", debtId: "small", amount: 100, effectiveDate: "2026-10-01" }], interest);
  assert.deepEqual(same.months.map(month => month.outflows), [100, 1.01, 0]);
  assert.deepEqual(datedAllocations(same), datedAllocations(interest.baseline));
  assert.equal(same.potentialDebtFreeDate, "2026-11");
});

test("real carried requirements respect full selected payments, caps and source monthly rollover", () => {
  for (const asof of ["2026-10-01", "2026-10-31"]) for (const amount of [50, 100, 150]) {
    const input = realFixture({ asof });
    const actual = run([{ id: "edit", type: "debt_edit", debtId: "small", amount, effectiveDate: asof }], input);
    const expected = realFixture({ asof, amount }).baseline;
    assert.equal(actual.complete, true);
    assert.deepEqual(datedAllocations(actual), datedAllocations(expected), `${asof}: ${amount}`);
  }
  for (const asof of ["2026-10-15", "2026-10-16", "2026-10-30", "2026-10-31"]) for (const amount of [50, 100, 150]) {
    const input = realFixture({ asof, frequency: "weekly", balance: 350 });
    const changed = run([{ id: "edit", type: "debt_edit", debtId: "small", amount, effectiveDate: asof }], input);
    assert.equal(changed.complete, true);
    assert.deepEqual(datedAllocations(changed), datedAllocations(realFixture({ asof, frequency: "weekly", balance: 350, amount }).baseline), `${asof} weekly: ${amount}`);
  }
});

test("a real paused payoff source frees no budget until its actual resumed payoff", () => {
  const data = realFixture();
  const result = run([{ id: "pause", type: "debt_pause", debtId: "small", effectiveDate: "2026-10-01", resumeDate: "2026-11-01" }], data);
  assert.equal(result.complete, true);
  assert.deepEqual(datedAllocations(result), [
    ["2026-10-20|large|required", -50],
    ["2026-11-15|large|rollover", -30],
    ["2026-11-15|small|required", -70],
    ["2026-11-20|large|required", -50],
    ["2026-12-20|large|required", -50],
    ["2026-12-20|large|rollover", -100],
  ]);
  assert.equal(result.payoffImpactMonths, -1);
});

test("a payoff overlapping an immutable pending bank payment fails closed with no fabricated payoff date", () => {
  const data = realFixture({ balance: 1000, single: true, pending: true });
  const fixed = data.baseline.days.flatMap(day => day.events).filter(event => event.status === "pending");
  assert.equal(fixed.length, 1);
  const result = run([
    { id: "edit", type: "debt_edit", debtId: "small", amount: 100, effectiveDate: "2026-10-01" },
    { id: "payoff", type: "debt_payoff", debtId: "small", date: "2026-10-10" },
  ], data);
  assert.deepEqual(result.days.flatMap(day => day.events).filter(event => fixed.some(item => item.id === event.id)), fixed);
  assert.equal(result.complete, false);
  assert.equal(result.potentialDebtFreeDate, null);
  assert.equal(result.payoffImpactMonths, null);
  assert.equal(result.payoffStatus, "unavailable");
  assert.match(result.issues.map(issue => issue.message).join(" "), /existing bank payment/);
});

test("pre-anchor source rollover advances canonical principal while only required cash carries forward", () => {
  for (const asof of ["2026-10-15", "2026-10-16", "2026-10-30", "2026-10-31"]) {
    const input = realFixture({ asof, largeBalance: 100 });
    const same = run([{ id: "same", type: "debt_edit", debtId: "small", amount: 100, effectiveDate: asof }], input);
    assert.equal(same.complete, true);
    assert.deepEqual(datedAllocations(same), datedAllocations(input.baseline));
    assert.equal(same.endingBalance, run([], input).endingBalance);
  }
  // Only the original $30 rollover was absorbed before October31. Changing
  // today's capped source commitment cannot create another invisible payment.
  const input = realFixture({ asof: "2026-10-31", largeBalance: 100 });
  for (const amount of [50, 100, 150]) {
    const result = run([{ id: "edit", type: "debt_edit", debtId: "small", amount, effectiveDate: "2026-10-31" }], input);
    assert.equal(result.complete, true);
    assert.equal(total(result), 140);
    assert.equal(result.potentialDebtFreeDate, "2026-11");
  }
});

test("unedited exact planned overrides retain required versus targeted-extra allocations before and after the anchor", () => {
  for (const asof of ["2026-10-01", "2026-10-31"]) {
    const input = realFixture({ asof, balance: 150, override: 200 });
    const result = run([{ id: "same", type: "debt_edit", debtId: "large", amount: 50, effectiveDate: asof }], input);
    assert.equal(result.complete, true);
    assert.deepEqual(datedAllocations(result), datedAllocations(input.baseline));
    assert.equal(result.potentialDebtFreeDate, run([], input).potentialDebtFreeDate);
  }
  const withPool = realFixture({ balance: 150, override: 200, boost: 100 });
  const same = run([{ id: "same", type: "debt_edit", debtId: "large", amount: 50, effectiveDate: "2026-10-01" }], withPool);
  assert.equal(same.complete, true);
  assert.deepEqual(datedAllocations(same), datedAllocations(withPool.baseline));
});

test("saved extra before the anchor advances principal once and adds no absorbed cash again", () => {
  const input = realFixture({ asof: "2026-10-31", balance: 150, savedDate: "2026-10-10" });
  const result = run([{ id: "same", type: "debt_edit", debtId: "large", amount: 50, effectiveDate: "2026-10-31" }], input);
  assert.equal(result.complete, true);
  assert.deepEqual(datedAllocations(result), datedAllocations(input.baseline));
  assert.equal(result.potentialDebtFreeDate, run([], input).potentialDebtFreeDate);
  assert.equal(result.days.flatMap(day => day.events).filter(event => event.debtPlanAllocationKind === "extra").length, 0);
});

test("saved extra beyond the cash horizon retains its actual date across an earlier pause window", () => {
  const input = realFixture({ balance: 1000, single: true, savedDate: "2027-01-20" });
  const current = run([], input);
  const scenario = run([{ id: "pause", type: "debt_pause", debtId: "small", effectiveDate: "2026-12-31", resumeDate: "2027-01-15" }], input);
  assert.equal(input.references.payoffSavedPaymentsByMonth?.["2027-01"]?.date, "2027-01-20");
  assert.equal(current.potentialDebtFreeDate, "2027-06");
  assert.equal(scenario.complete, true);
  assert.equal(scenario.potentialDebtFreeDate, current.potentialDebtFreeDate);
  assert.equal(scenario.payoffImpactMonths, 0);
  assert.equal(scenario.endingBalance, current.endingBalance);
});

test("an overdue pending weekly origin stays fixed while sibling origins edit, pause and cap independently", () => {
  const input = realFixture({ asof: "2026-10-31", frequency: "weekly", balance: 350, single: true, pending: true });
  const fixed = input.baseline.days.flatMap(day => day.events).filter(event => event.status === "pending");
  for (const [amount, expected] of [[20, 180], [50, 300], [100, 350], [150, 350], [300, 350]]) {
    const result = run([{ id: "edit", type: "debt_edit", debtId: "small", amount, effectiveDate: "2026-10-31" }], input);
    assert.equal(result.complete, true);
    assert.equal(result.months[0].outflows, expected);
    assert.deepEqual(result.days.flatMap(day => day.events).filter(event => fixed.some(item => item.id === event.id)), fixed);
  }
  const paused = run([{ id: "pause", type: "debt_pause", debtId: "small", effectiveDate: "2026-10-31", resumeDate: "2026-12-01" }], input);
  assert.equal(paused.complete, true);
  assert.equal(paused.months[0].outflows, 100);
});

test("debt controls use strict additive version-one definitions and bounded values", () => {
  const changes: PlanSimulationChange[] = [
    add,
    { id: "edit", type: "debt_edit", debtId: "loan", amount: 150, effectiveDate: "2026-02-01" },
    { id: "pause", type: "debt_pause", debtId: "loan", effectiveDate: "2026-02-01", resumeDate: "2026-04-01" },
  ];
  assert.deepEqual(decodePlanSimulationChanges(changes), changes);
  for (const invalid of [
    { ...add, apr: NaN }, { ...add, apr: Infinity }, { ...add, apr: -1 }, { ...add, apr: 1001 },
    { ...add, balance: 0 }, { ...add, balance: 1_000_000_001 }, { ...add, amount: 0 },
    { ...changes[1], amount: 0 }, { ...changes[1], unexpected: "discard me" },
    { ...changes[2], resumeDate: "2026-02-01" }, { ...changes[2], resumeDate: "2026-02-31" },
  ]) assert.equal(decodePlanSimulationChanges([invalid]), null);
});

test("new debt works without existing debts, adds no deposit and stops cash at payoff", () => {
  const data = { baseline: baseline([], "2026-06-30"), references: { incomes: [], bills: [], debts: [], debtMethod: "snowball" as const }, metrics, safetyFloor: 200 };
  const current = run([], data);
  const result = run([add], data);
  assert.equal(current.payoffStatus, "paid_off");
  assert.equal(current.potentialDebtFreeDate, "2026-01");
  assert.equal(result.potentialDebtFreeDate, "2026-05");
  assert.equal(result.payoffStatus, "paid_off");
  assert.equal(result.complete, true);
  assert.equal(total(result), 500);
  assert.equal(result.days.reduce((sum, day) => sum + day.inflow, 0), 0);
  assert.equal(result.endingBalance, 9500);
  assert.deepEqual(result.days.flatMap(day => day.events).map(event => event.date), ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15"]);
  assert.equal(simulationDebtReference(add).id, "simulation-debt:new");
});

test("a future added debt has no pre-start payment or prior origination-month interest", () => {
  const data = { baseline: baseline(), references: { incomes: [], bills: [], debts: [], debtMethod: "snowball" as const }, metrics, safetyFloor: 200 };
  const result = run([{ ...add, startDate: "2026-02-15", apr: 120 }], data);
  assert.equal(result.months[0].outflows, 0);
  assert.equal(result.months[1].outflows, 100);
  assert.equal(result.potentialDebtFreeDate, "2026-08");
  assert.equal(result.complete, true);
});

test("per-occurrence payment changes alter both cash and payoff with the same dated model", () => {
  const current = run([]);
  const higher = run([{ id: "up", type: "debt_edit", debtId: "loan", amount: 200, effectiveDate: "2026-02-01" }]);
  const lower = run([{ id: "down", type: "debt_edit", debtId: "loan", amount: 50, effectiveDate: "2026-02-01" }]);
  assert.equal(current.potentialDebtFreeDate, "2026-10");
  assert.equal(total(higher), 500);
  assert.equal(higher.endingBalance - current.endingBalance, -200);
  assert.equal(higher.potentialDebtFreeDate, "2026-06");
  assert.equal(higher.payoffImpactMonths, 4);
  assert.equal(total(lower), 200);
  assert.equal(lower.endingBalance - current.endingBalance, 100);
  assert.equal(lower.potentialDebtFreeDate, "2027-07");
  assert.equal(lower.payoffImpactMonths, -9);
});

test("a temporary pause frees its scheduled cash and resumes on the exclusive end date", () => {
  const current = run([]);
  const pause = run([{ id: "pause", type: "debt_pause", debtId: "loan", effectiveDate: "2026-01-01", resumeDate: "2026-02-15" }]);
  assert.equal(pause.months[0].outflows, 0);
  assert.equal(pause.months[1].outflows, 100);
  assert.equal(pause.potentialDebtFreeDate, "2026-11");
  assert.equal(pause.payoffImpactMonths, -1);
  assert.equal(pause.endingBalance - current.endingBalance, 100);
});

test("pause interest continues and an explicit payoff during the pause uses grown remaining principal", () => {
  const data = fixture(12);
  const changes: PlanSimulationChange[] = [
    { id: "pause", type: "debt_pause", debtId: "loan", effectiveDate: "2026-01-01", resumeDate: "2026-03-01" },
    { id: "payoff", type: "debt_payoff", debtId: "loan", date: "2026-02-15" },
  ];
  const result = run(changes, data);
  // Forecast accrues both January's $10 and February's $10.10 interest.
  assert.equal(result.debtExtraApplied, 1020.1);
  assert.equal(total(result), 1020.1);
  assert.equal(result.potentialDebtFreeDate, "2026-02");
  assert.equal(result.complete, true);
  const paused = run(changes.slice(0, 1), data);
  assert.ok(paused.potentialDebtFreeDate && run([], data).potentialDebtFreeDate! < paused.potentialDebtFreeDate);
});

test("a resume date beyond the visible cash horizon still computes the later payoff", () => {
  const result = run([{ id: "pause", type: "debt_pause", debtId: "loan", effectiveDate: "2026-01-01", resumeDate: "2026-07-01" }]);
  assert.equal(total(result), 0);
  assert.equal(result.potentialDebtFreeDate, "2027-04");
  assert.equal(result.payoffStatus, "paid_off");
});

test("overlapping pauses union their windows; same-date edits are deterministic last-in-list", () => {
  const pauses: PlanSimulationChange[] = [
    { id: "p1", type: "debt_pause", debtId: "loan", effectiveDate: "2026-01-01", resumeDate: "2026-03-01" },
    { id: "p2", type: "debt_pause", debtId: "loan", effectiveDate: "2026-02-01", resumeDate: "2026-04-01" },
  ];
  assert.equal(run(pauses).potentialDebtFreeDate, "2027-01");
  const edits: PlanSimulationChange[] = [
    { id: "first", type: "debt_edit", debtId: "loan", amount: 100, effectiveDate: "2026-02-01" },
    { id: "last", type: "debt_edit", debtId: "loan", amount: 200, effectiveDate: "2026-02-01" },
  ];
  assert.equal(total(run(edits)), 500);
  assert.equal(total(run([...edits].reverse())), 300);
});

test("new debts preserve weekly, biweekly, quarter and month-end calendar cadence", () => {
  const data = { baseline: baseline([], "2026-06-30"), references: { incomes: [], bills: [], debts: [], debtMethod: "snowball" as const }, metrics, safetyFloor: 200 };
  for (const [frequency, startDate, expected] of [
    ["weekly", "2026-01-05", "2026-02"],
    ["biweekly", "2026-01-05", "2026-03"],
    ["monthly", "2026-01-31", "2026-05"],
    ["quarterly", "2026-01-31", "2027-01"],
  ] as const) {
    const result = run([{ ...add, frequency, startDate }], data);
    assert.equal(result.potentialDebtFreeDate, expected, frequency);
    assert.equal(result.complete, true);
  }
  const leap = run([{ ...add, startDate: "2028-01-31" }], { ...data, baseline: baseline([], "2028-03-31", "2028-01-01") });
  assert.deepEqual(leap.days.flatMap(day => day.events).map(event => event.date), ["2028-01-31", "2028-02-29", "2028-03-31"]);
});

test("settled payment is subtracted from the new commitment, never from owed principal twice", () => {
  const data = fixture();
  data.references.debts[0].balance = 970;
  data.references.debts[0].occurrences = [{ date: "2026-01-15", configuredAmount: 100, settledAmount: 30, remainingAmount: 70 }, ...data.references.debts[0].occurrences!.slice(1)];
  data.baseline = baseline([debtEvent("2026-01-15", 70), debtEvent("2026-02-15", 100), debtEvent("2026-03-15", 100)]);
  const result = run([
    { id: "edit", type: "debt_edit", debtId: "loan", amount: 150, effectiveDate: "2026-01-01" },
    { id: "payoff", type: "debt_payoff", debtId: "loan", date: "2026-01-16" },
  ], data);
  assert.equal(result.days.find(day => day.date === "2026-01-15")?.outflow, 120);
  assert.equal(result.debtExtraApplied, 850);
  assert.equal(total(result), 970);
});

test("pending commitments stay identical under pause/edit and reduce future principal once", () => {
  const data = fixture();
  const pending = { ...debtEvent("2026-01-15", 100), status: "pending" as const };
  data.baseline = baseline([pending, debtEvent("2026-02-15", 100), debtEvent("2026-03-15", 100)]);
  data.references.debts[0].occurrences = [{ date: "2026-01-15", configuredAmount: 100, settledAmount: 0, remainingAmount: 100, immutable: true }, ...data.references.debts[0].occurrences!.slice(1)];
  const result = run([
    { id: "pause", type: "debt_pause", debtId: "loan", effectiveDate: "2026-01-01", resumeDate: "2026-02-01" },
    { id: "edit", type: "debt_edit", debtId: "loan", amount: 150, effectiveDate: "2026-01-01" },
    { id: "payoff", type: "debt_payoff", debtId: "loan", date: "2026-02-16" },
  ], data);
  assert.ok(result.days[14].events.some(event => event.id === pending.id && event.status === "pending" && event.amount === -100));
  assert.equal(result.debtExtraApplied, 750);
  assert.equal(total(result), 1000);
});

test("generic extra payments skip paused debts, while explicit payoff can override a scheduled pause", () => {
  const none = run([
    { id: "pause", type: "debt_pause", debtId: "loan", effectiveDate: "2026-01-01", resumeDate: "2026-04-01" },
    { id: "extra", type: "debt_extra", amount: 50, date: "2026-01-10" },
  ]);
  assert.equal(none.complete, false);
  assert.match(none.issues.find(issue => issue.changeId === "extra")!.message, /unpaused/);
  const other = run([
    { ...add, amount: 25, startDate: "2026-01-05" },
    { id: "pause", type: "debt_pause", debtId: "loan", effectiveDate: "2026-01-01", resumeDate: "2026-04-01" },
    { id: "extra", type: "debt_extra", amount: 50, date: "2026-01-10" },
  ]);
  assert.equal(other.debtAllocations[0].billId, "simulation-debt:new");
  assert.equal(other.debtExtraApplied, 50);
});

test("later payoff of a hypothetical debt uses its balance after earlier simulated payments", () => {
  const data = { baseline: baseline(), references: { incomes: [], bills: [], debts: [], debtMethod: "snowball" as const }, metrics, safetyFloor: 200 };
  const result = run([add, { id: "payoff", type: "debt_payoff", debtId: "simulation-debt:new", date: "2026-01-20" }], data);
  assert.equal(result.debtExtraApplied, 400);
  assert.equal(total(result), 500);
  assert.equal(result.days.flatMap(day => day.events).length, 2);
});

test("non-amortizing and long-paused debts remain outstanding, rather than showing false completion", () => {
  const result = run([
    { id: "edit", type: "debt_edit", debtId: "loan", amount: 1, effectiveDate: "2026-01-01" },
  ], fixture(24));
  assert.equal(result.potentialDebtFreeDate, null);
  assert.equal(result.payoffStatus, "projection_limit");
  assert.equal(result.complete, true);
  assert.ok(result.days.every(day => Number.isFinite(day.balance)));
});

test("stale targets fail closed and projection never mutates frozen inputs", () => {
  const data = fixture();
  const original = structuredClone(data);
  const changes: PlanSimulationChange[] = [{ id: "edit", type: "debt_edit", debtId: "missing", amount: 150, effectiveDate: "2026-01-01" }];
  const result = run(freeze(changes), freeze(data));
  assert.equal(result.complete, false);
  assert.equal(result.payoffStatus, "unavailable");
  assert.equal(result.potentialDebtFreeDate, null);
  assert.equal(result.payoffImpactMonths, null);
  assert.deepEqual(data, original);
  const future = fixture();
  future.references.debts[0].startDate = "2026-02-01";
  const invalidPause = run([{ id: "early", type: "debt_pause", debtId: "loan", effectiveDate: "2026-01-01", resumeDate: "2026-03-01" }], future);
  assert.equal(invalidPause.payoffStatus, "unavailable");
  assert.equal(invalidPause.potentialDebtFreeDate, null);
  assert.equal(invalidPause.payoffImpactMonths, null);
});

test("tagged saved-fund lineage counts future extra once and same-value edit is a true cash/payoff identity", () => {
  const data = fixture();
  const saved = { ...debtEvent("2026-02-10", 100), id: "saved-extra", sourceId: "saved-plan", debtPlanSource: "saved_extra" as const, debtPlanAllocationKind: "extra" as const };
  data.baseline = baseline([debtEvent("2026-01-15", 100), debtEvent("2026-02-15", 100), debtEvent("2026-03-15", 100), saved]);
  data.references.payoffStrategyExtrasByMonth = { "2026-02": 100 };
  const current = run([], data);
  const same = run([{ id: "same", type: "debt_edit", debtId: "loan", amount: 100, effectiveDate: "2026-01-01" }], data);
  assert.equal(same.endingBalance, current.endingBalance);
  assert.equal(same.potentialDebtFreeDate, current.potentialDebtFreeDate);
  assert.equal(same.payoffImpactMonths, 0);
  assert.equal(same.months[1].outflows, 200);
  const legacyTagged = projectPlanSimulation({ ...data, changes: [] });
  const legacySeparate = projectPlanSimulation({ ...data, references: { ...data.references, payoffStrategyExtrasByMonth: {} }, changes: [] });
  assert.equal(legacyTagged.potentialDebtFreeDate, legacySeparate.potentialDebtFreeDate);
  const untagged = projectPlanSimulation({ ...data, references: { ...data.references, payoffStrategyExtrasAreSavedPlans: false }, changes: [] });
  assert.ok(untagged.potentialDebtFreeDate! < legacyTagged.potentialDebtFreeDate!);
});

test("mixed saved comparisons pair their current and both options with the same debt model", () => {
  const data = fixture();
  const change: PlanSimulationChange = { id: "same", type: "debt_edit", debtId: "loan", amount: 100, effectiveDate: "2026-01-01" };
  const compared = compareSavedPlanScenarios({ ...data, options: [
    { key: "new", source: "On this device", draft: { name: "New", horizonMonths: 3, changes: [change] } },
    { key: "old", source: "On this device", draft: { name: "Old", horizonMonths: 3, changes: [] } },
  ] });
  assert.equal(compared.current.potentialDebtFreeDate, compared.options[0].result.potentialDebtFreeDate);
  assert.equal(compared.options[0].result.endingBalance, compared.options[1].result.endingBalance);
});

test("committed automatic rollover remains separate from a changed regular payment", () => {
  const data = fixture();
  data.references.debts[0].monthlyRolloverExtra = 100;
  const dates = ["2026-01-15", "2026-02-15", "2026-03-15"];
  data.baseline = baseline(dates.flatMap(date => [
    debtEvent(date, 100),
    { ...debtEvent(date, 100), id: "rollover:" + date, debtPlanAllocationKind: "rollover" as const },
  ]));
  data.references.debts[0].occurrences = dates.map(date => ({ date, configuredAmount: 100, settledAmount: 0, remainingAmount: 200, regular: true }));
  const current = run([], data);
  const same = run([{ id: "same", type: "debt_edit", debtId: "loan", amount: 100, effectiveDate: "2026-01-01" }], data);
  assert.equal(total(same), 600);
  assert.equal(same.endingBalance, current.endingBalance);
  assert.equal(same.potentialDebtFreeDate, current.potentialDebtFreeDate);
  assert.equal(same.payoffImpactMonths, 0);
  const higher = run([{ id: "higher", type: "debt_edit", debtId: "loan", amount: 150, effectiveDate: "2026-01-01" }], data);
  assert.equal(total(higher), 750, "The regular payment changes; the already-committed automatic pool is not lost or counted twice.");
});

test("a rollover-only date is never invented as a regular payment occurrence", () => {
  const data = fixture();
  const regularDates = ["2026-02-01", "2026-03-01"];
  const poolDates = ["2026-01-31", "2026-02-28", "2026-03-31"];
  data.references.debts[0].balance = 2000;
  data.references.debts[0].dueDay = 1;
  data.references.debts[0].monthlyRolloverExtra = 200;
  data.references.debts[0].occurrences = [
    ...regularDates.map(date => ({ date, configuredAmount: 100, settledAmount: 0, remainingAmount: 100, regular: true })),
    ...poolDates.map(date => ({ date, configuredAmount: 0, settledAmount: 0, remainingAmount: 200, regular: false })),
  ];
  data.baseline = baseline([
    ...regularDates.map(date => debtEvent(date, 100)),
    ...poolDates.map(date => ({ ...debtEvent(date, 200), debtPlanAllocationKind: "rollover" as const })),
  ], "2026-03-31", "2026-01-15");
  const current = run([], data);
  const same = run([{ id: "same", type: "debt_edit", debtId: "loan", amount: 100, effectiveDate: "2026-01-31" }], data);
  assert.equal(total(same), 800);
  assert.equal(same.days.find(day => day.date === "2026-01-31")!.outflow, 200);
  assert.equal(same.endingBalance, current.endingBalance);
  assert.equal(same.potentialDebtFreeDate, current.potentialDebtFreeDate);
});

test("canonical source rollover targets are not treated as another creditor's new source money", () => {
  const data = fixture();
  data.references.debts = [
    { id: "small", name: "Small", balance: 70, minimum: 100, apr: 0, dueDay: 15, included: true, frequency: "monthly",
      occurrences: ["2026-01-15", "2026-02-15", "2026-03-15"].map(date => ({ date, configuredAmount: 100, settledAmount: 0, remainingAmount: 100, regular: true })) },
    { id: "large", name: "Large", balance: 500, minimum: 50, apr: 0, dueDay: 20, included: true, frequency: "monthly",
      occurrences: ["2026-01-20", "2026-02-20", "2026-03-20"].map(date => ({ date, configuredAmount: 50, settledAmount: 0, remainingAmount: 50, regular: true })) },
  ];
  data.baseline = baseline([
    debtEvent("2026-01-15", 70, "small"),
    { ...debtEvent("2026-01-15", 30, "small", "large"), debtPlanAllocationKind: "rollover" },
    debtEvent("2026-01-20", 50, "large"),
    { ...debtEvent("2026-02-15", 100, "small", "large"), debtPlanAllocationKind: "rollover" },
    debtEvent("2026-02-20", 50, "large"),
    { ...debtEvent("2026-03-15", 100, "small", "large"), debtPlanAllocationKind: "rollover" },
    debtEvent("2026-03-20", 50, "large"),
  ]);
  const same = run([{ id: "same", type: "debt_edit", debtId: "small", amount: 100, effectiveDate: "2026-01-01" }], data);
  assert.equal(total(same), 450);
  assert.equal(same.endingBalance, run([], data).endingBalance);
  assert.equal(same.potentialDebtFreeDate, "2026-04");
});

test("new debt types round-trip through working, device, household JSON and the actual export document", () => {
  const changes: PlanSimulationChange[] = [
    add,
    { id: "edit", type: "debt_edit", debtId: "simulation-debt:new", amount: 150, effectiveDate: "2026-02-01" },
    { id: "pause", type: "debt_pause", debtId: "simulation-debt:new", effectiveDate: "2026-02-01", resumeDate: "2026-04-01" },
  ];
  const draft = { name: "Debt choices", horizonMonths: 3 as const, changes };
  const now = "2026-01-01T12:00:00Z";
  const saved = putDeviceScenario(emptyScenarioLibrary(), draft, now, "device-debt");
  assert.deepEqual(decodeScenarioLibrary(JSON.stringify(saved.library))!.scenarios[0].changes, changes);
  const working = { schemaVersion: 1, selectedKey: "device:device-debt", draft };
  assert.deepEqual(decodeScenarioWorking(JSON.stringify(working))!.draft.changes, changes);
  const household = normalizePlanSimulationRow({
    id: "household-debt", household_id: "home", name: draft.name, horizon_months: 3,
    changes: JSON.parse(JSON.stringify(changes)), schema_version: 1, version: 1,
    created_by: "actor", updated_by: "actor", created_at: now, updated_at: now,
  });
  assert.deepEqual(household!.changes, changes);
  assert.equal(household!.invalidDefinition, false);
  const source = readFileSync("lib/planSimulationExport.ts", "utf8");
  const functionSource = source.slice(source.indexOf("export function scenarioExportDocument"), source.indexOf("/** Exporting"));
  const script = transpileModule(functionSource, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const exportDocument = new Function("exports", "decodeScenarioDraft", script + "; return exports.scenarioExportDocument;")({}, decodeScenarioDraft);
  const document = exportDocument(draft);
  const exported = JSON.parse(document.content);
  assert.equal(exported.kind, "flowledger-plan-scenario");
  assert.deepEqual(exported.changes, changes);
  assert.equal("results" in exported, false);
});

test("bounded debt continuation handles a realistic many-debt non-amortizing case without daily 30-year snapshots", () => {
  const data = fixture(24);
  data.references.debts = Array.from({ length: 30 }, (_, index) => ({
    id: "debt-" + index, name: "Debt " + index, balance: 1_000_000, minimum: 100,
    apr: 24, dueDay: index % 28 + 1, included: true, frequency: "monthly",
  }));
  data.baseline = baseline();
  const started = performance.now();
  const result = run([{ id: "low", type: "debt_edit", debtId: "debt-0", amount: 101, effectiveDate: "2026-01-01" }], data);
  assert.equal(result.payoffStatus, "projection_limit");
  assert.equal(result.days.length, 90, "Only the visible cash horizon is materialized as day snapshots.");
  assert.ok(result.days.every(day => Number.isFinite(day.balance)));
  assert.ok(performance.now() - started < 5000, "Thirty debts and a 360-month continuation should remain interactive.");
});
