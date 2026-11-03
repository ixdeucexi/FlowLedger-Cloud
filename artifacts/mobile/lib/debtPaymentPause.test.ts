import assert from "node:assert/strict";
import test from "node:test";
import golden from "./financialProjection.golden.json";
import { editDebtPaymentPauseHistory, normalizeDebtPaymentPauses, isDebtPaymentPaused, resumeDebtPaymentPause, type DebtPaymentPause } from "./debtPaymentPause";
import { normalizeBillRow } from "./financialProjectionInput";
import { createFinancialProjection } from "./financialProjection";
import { buildSnowballPlannerRows } from "./snowballPlanner";
import type { FinancialProjectionSnapshot } from "./financialProjectionTypes";
import { buildCanonicalPlanSimulationBaseline, projectPlanSimulation, type PlanSimulationReferences } from "./planSimulator";
import { previewCanonicalDebtSnowball } from "./debtSnowballPreview";
import { readFileSync } from "node:fs";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const clock = { now: new Date("2026-10-01T12:00:00Z"), timeZone: "UTC" };
const pause = (patch: Partial<DebtPaymentPause> = {}): DebtPaymentPause => ({ id: "pause-1", start_date: "2026-10-01", resume_date: "2026-12-01", redirect_payment: true, ...patch });
function fixture(): FinancialProjectionSnapshot {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  snapshot.bills = [
    { ...snapshot.bills[0], id: "donor", name: "Paused loan", is_debt: true, amount: 100, balance: 1000, interest_rate: 0,
      due_day: 15, frequency: "monthly", is_recurring: true, start_date: "2026-01-01", end_date: undefined,
      next_payment_date: undefined, include_in_snowball: true, snowball_minimum_boost: 0, debt_payment_pauses: [pause()] },
    { ...snapshot.bills[0], id: "recipient", name: "Other loan", is_debt: true, amount: 50, balance: 2000, interest_rate: 0,
      due_day: 15, frequency: "monthly", is_recurring: true, start_date: "2026-01-01", end_date: undefined,
      next_payment_date: undefined, include_in_snowball: true, snowball_minimum_boost: 0, debt_payment_pauses: [] },
  ];
  snapshot.incomes = [];
  snapshot.goals = [];
  snapshot.decisions = [];
  snapshot.transactions = [];
  snapshot.deletedTransactions = [];
  snapshot.overrides = [];
  snapshot.billDateMoves = [];
  snapshot.extraPayments = [];
  snapshot.accounts = [];
  snapshot.connectedBankAccounts = [];
  snapshot.transactionAccountIdentities = [];
  snapshot.pendingBankTransactions = [];
  snapshot.pendingPlanMatches = [];
  snapshot.settings.starting_balance = 10_000;
  snapshot.settings.starting_balance_date = "2026-10-01";
  snapshot.settings.debtPayoffEnabled = true;
  return snapshot;
}
function pending(snapshot: FinancialProjectionSnapshot, billId: string, amount: number, date = "2026-10-15") {
  const id = "pending-" + billId;
  snapshot.pendingBankTransactions.push({ plaid_transaction_id: id, transaction_date: date, amount: -amount, name: billId, category: "Debt" });
  snapshot.pendingPlanMatches.push({ id, pending_plaid_transaction_id: id, target_type: "bill", target_id: billId, target_name: billId,
    occurrence_date: date, planned_amount: 100, pending_amount: amount, pending_transaction_date: date, status: "active",
    created_at: date + "T12:00:00Z", updated_at: date + "T12:00:00Z" });
}
const project = (snapshot: FinancialProjectionSnapshot, options = clock) => createFinancialProjection(snapshot, options);

test("saved pause validation rejects malformed history and uses real exclusive dates", () => {
  assert.deepEqual(normalizeDebtPaymentPauses(undefined), []);
  assert.deepEqual(normalizeDebtPaymentPauses(null), []);
  const leap = pause({ start_date: "2028-02-29", resume_date: "2028-03-31" });
  assert.equal(isDebtPaymentPaused([leap], "2028-02-28"), false);
  assert.equal(isDebtPaymentPaused([leap], "2028-02-29"), true);
  assert.equal(isDebtPaymentPaused([leap], "2028-03-30"), true);
  assert.equal(isDebtPaymentPaused([leap], "2028-03-31"), false);
  for (const value of ["bad", [pause({ start_date: "2026-02-29" })], [pause({ id: "bad:identifier" })],
    [pause(), pause()], [pause(), pause({ id: "overlap", start_date: "2026-11-01" })],
    [pause({ resume_date: "2026-10-01" })], [{ ...pause(), redirect_payment: "true" }], Array(121).fill(pause())]) {
    assert.throws(() => normalizeDebtPaymentPauses(value));
  }
  assert.throws(() => normalizeBillRow({ ...fixture().bills[0], debt_payment_pauses: [pause({ resume_date: "2026-02-30" })] }));
  assert.deepEqual(normalizeDebtPaymentPauses([pause({ id: "later", start_date: "2026-12-01", resume_date: "2027-01-01" }), pause()]).map(item => item.id), ["pause-1", "later"]);
});

test("paused debts retain order, lender truth and interest while dated cash redirects once", () => {
  const snapshot = fixture();
  snapshot.bills[0].interest_rate = 12;
  const projection = project(snapshot);
  const plan = projection.getDebtPlanForMonth(9, 2026)!;
  assert.equal(plan.interest, 10);
  assert.equal(plan.balances.get("donor"), 1010);
  assert.equal(plan.balances.get("recipient"), 1850);
  assert.equal(plan.plannedPayment, 150);
  const redirect = plan.allocations.find(item => item.pauseRedirect)!;
  assert.equal(redirect.amount, 100);
  assert.equal(redirect.sourceBillId, undefined);
  assert.equal(redirect.externalPaymentId, "debt-pause-redirect:pause-1:donor:2026-10-15");
  assert.equal(plan.rolledPayment, 0);
  const settlements = projection.getDebtMonthSettlements(9, 2026);
  assert.equal(settlements.get("donor")?.remainingRequired, 100);
  assert.equal(projection.getCashFlow(9, 2026).totalBillsDue, 150);
  assert.equal(projection.getDailyBalances(9, 2026).at(-1)?.balance, 9850);
  const events = projection.getDailyBalances(9, 2026).flatMap(day => day.events ?? []);
  assert.equal(events.filter(event => event.debtPauseRedirect).length, 1);
  assert.equal(events.find(event => event.debtPauseRedirect)?.status, "scheduled");
  const rows = buildSnowballPlannerRows(snapshot.bills.map(bill => ({ id: bill.id, name: bill.name, balance: bill.balance, minimum: bill.amount,
    apr: bill.interest_rate, dueDay: bill.due_day, included: true, debt_payment_pauses: bill.debt_payment_pauses })), "snowball", projection.getRemainingDebtPlanForMonth(9, 2026), plan, settlements);
  assert.deepEqual(rows.map(row => row.id), ["donor", "recipient"]);
  assert.equal(rows[0].plannedToDebt, 0);
  assert.equal(rows[0].rolloverSent, 100);
  assert.equal(rows[0].minimum, 100);
});

test("temporary redirects stop at resume and never free the paused donor minimum", () => {
  const snapshot = fixture();
  const projection = project(snapshot);
  for (const month of [9, 10]) assert.equal(projection.getDebtPlanForMonth(month, 2026)?.allocations.filter(item => item.pauseRedirect).reduce((sum, item) => sum + item.amount, 0), 100);
  const resumed = projection.getDebtPlanForMonth(11, 2026)!;
  assert.equal(resumed.allocations.some(item => item.pauseRedirect), false);
  assert.equal(resumed.allocations.find(item => item.targetBillId === "donor")?.amount, 100);
  assert.equal(resumed.rolledPayment, 0);
  snapshot.bills[0].debt_payment_pauses = resumeDebtPaymentPause(snapshot.bills[0].debt_payment_pauses, "pause-1", "2026-10-10");
  const early = project(snapshot).getDebtPlanForMonth(9, 2026)!;
  assert.equal(early.allocations.some(item => item.pauseRedirect), false);
  assert.equal(early.allocations.find(item => item.targetBillId === "donor")?.amount, 100);
});

test("a pause follows the moved cash date and exact edited amount", () => {
  const snapshot = fixture();
  snapshot.bills[0].debt_payment_pauses = [pause({ start_date: "2026-10-20", resume_date: "2026-11-01" })];
  snapshot.billDateMoves = [{ id: "move", bill_id: "donor", from_date: "2026-10-15", to_date: "2026-10-25", custom_amount: 75, created_at: "2026-10-01T12:00:00Z" }];
  const projection = project(snapshot);
  const redirect = projection.getDebtPlanForMonth(9, 2026)?.allocations.find(item => item.pauseRedirect)!;
  assert.equal(redirect.date, "2026-10-25");
  assert.equal(redirect.amount, 75);
  assert.equal(projection.getDebtMonthSettlements(9, 2026).get("donor")?.configuredObligation, 100);
  snapshot.billDateMoves[0].to_date = "2026-10-19";
  assert.equal(project(snapshot).getDebtPlanForMonth(9, 2026)?.allocations.some(item => item.pauseRedirect), false);
});

test("weekly and biweekly pauses suppress only dated occurrences inside a partial month", () => {
  for (const frequency of ["weekly", "biweekly"] as const) {
    const snapshot = fixture();
    Object.assign(snapshot.bills[0], { frequency, day_of_week: 5, start_date: "2026-10-02", next_payment_date: "2026-10-02",
      debt_payment_pauses: [pause({ start_date: "2026-10-09", resume_date: "2026-10-23" })] });
    snapshot.overrides = [{ id: "exact", bill_id: "donor", month: 9, year: 2026, planned_debt_amount: 125, paid_amount: 0 }];
    const plan = project(snapshot).getDebtPlanForMonth(9, 2026)!;
    const redirects = plan.allocations.filter(item => item.pauseRedirect);
    assert.deepEqual(redirects.map(item => item.date), frequency === "weekly" ? ["2026-10-09", "2026-10-16"] : ["2026-10-16"]);
    assert.ok(redirects.every(item => item.amount === 125));
    assert.ok(plan.allocations.filter(item => item.targetBillId === "donor").every(item => item.date < "2026-10-09" || item.date >= "2026-10-23"));
    assert.equal(plan.plannedPayment, (frequency === "weekly" ? 5 : 3) * 125 + 50);
  }
});

test("donor partial/pending cash stays with the creditor and only its remainder redirects", () => {
  for (const state of ["reviewed", "pending"] as const) {
    const snapshot = fixture();
    if (state === "pending") pending(snapshot, "donor", 40);
    else {
      snapshot.bills[0].balance = 960;
      snapshot.transactions.push({ id: "paid", date: "2026-10-15", amount: -40, category: "Debt", note: "Paid", linked_bill_id: "donor", review_status: "matched",
        review_allocations: [{ type: "bill", targetId: "donor", amount: 40, plannedAmount: 100, occurrenceDate: "2026-10-15", settlement: "partial" }] });
    }
    const projection = project(snapshot);
    const remaining = projection.getRemainingDebtPlanForMonth(9, 2026)!;
    assert.equal(remaining.allocations.filter(item => item.pauseRedirect).reduce((sum, item) => sum + item.amount, 0), 60);
    assert.equal(remaining.allocations.filter(item => item.targetBillId === "donor").reduce((sum, item) => sum + item.amount, 0), state === "pending" ? 40 : 0);
    assert.equal(projection.getDailyBalances(9, 2026).at(-1)?.balance, 9850);
    assert.equal(projection.getCashFlow(9, 2026).remaining, -150);
  }
});

test("recipient bank extra credit is consumed once across automatic rollover and redirects", () => {
  const snapshot = fixture();
  snapshot.bills[1].snowball_minimum_boost = 20;
  // The automatic target remains donor by rank, but cannot receive payoff extra
  // while paused. This recipient's own $50 requirement still occurs the same day.
  pending(snapshot, "recipient", 90);
  const projection = project(snapshot);
  const plan = projection.getRemainingDebtPlanForMonth(9, 2026)!;
  assert.equal(plan.allocations.filter(item => item.sourceBillId === "recipient").reduce((sum, item) => sum + item.amount, 0), 90);
  assert.equal(plan.plannedPayment, 170);
  assert.equal(projection.getDailyBalances(9, 2026).at(-1)?.balance, 9830);
  assert.equal(plan.allocations.filter(item => item.pauseRedirect).reduce((sum, item) => sum + item.amount, 0), 80);
});

test("redirects cap to eligible balances and unused funding stays cash", () => {
  const snapshot = fixture();
  snapshot.bills[1].balance = 75;
  const projection = project(snapshot);
  const plan = projection.getDebtPlanForMonth(9, 2026)!;
  assert.equal(plan.plannedPayment, 75);
  assert.equal(plan.unusedAmount, 75);
  assert.equal(plan.balances.get("donor"), 1000);
  assert.equal(plan.rolledPayment, 50);
  snapshot.bills[1].debt_payment_pauses = [pause({ id: "recipient-pause", redirect_payment: false })];
  const noRecipient = project(snapshot);
  assert.equal(noRecipient.getDebtPlanForMonth(9, 2026)?.plannedPayment, 0);
  assert.equal(noRecipient.getCashFlow(9, 2026).remaining, 0);
  assert.equal(noRecipient.getDailyBalances(9, 2026).at(-1)?.balance, 10_000);
});

test("turning the plan off keeps pauses effective, protects pending and emits no redirects", () => {
  for (const protectedAmount of [0, 40]) {
    const snapshot = fixture();
    snapshot.settings.debtPayoffEnabled = false;
    if (protectedAmount) pending(snapshot, "donor", protectedAmount);
    const projection = project(snapshot);
    assert.equal(projection.getDebtPlanForMonth(9, 2026), null);
    assert.equal(projection.getCashFlow(9, 2026).totalBillsDue, 50 + protectedAmount);
    assert.equal(projection.getDailyBalances(9, 2026).at(-1)?.balance, 9950 - protectedAmount);
    assert.equal(projection.getDailyBalances(9, 2026).flatMap(day => day.events ?? []).some(event => event.debtPauseRedirect), false);
  }
});

test("redirect-off pauses preserve paid history and income without introducing plan cash", () => {
  const snapshot = fixture();
  snapshot.bills[0].debt_payment_pauses![0].redirect_payment = false;
  snapshot.overrides = [{ id: "paid", bill_id: "donor", month: 9, year: 2026, paid_amount: 40, actual_amount: 40, paid_date: "2026-10-15" }];
  snapshot.incomes = [{ id: "pay", name: "Pay", amount: 300, frequency: "monthly", start_date: "2026-10-01", next_payment_date: "2026-10-01" }];
  const projection = project(snapshot);
  assert.equal(projection.getCashFlow(9, 2026).monthlyIncome, 300);
  assert.equal(projection.getCashFlow(9, 2026).totalPaid, 40);
  assert.equal(projection.getCashFlow(9, 2026).totalBillsDue, 50);
  assert.equal(projection.getDailyBalances(9, 2026).at(-1)?.balance, 10_210);
  assert.equal(projection.getDebtMonthSettlements(9, 2026).get("donor")?.remainingRequired, 60);
});

test("direct future reads preserve paused cash and manual actual history in carryover", () => {
  for (const planEnabled of [true, false]) {
    const snapshot = fixture();
    snapshot.settings.debtPayoffEnabled = planEnabled;
    snapshot.bills[0].debt_payment_pauses![0].redirect_payment = false;
    snapshot.overrides = [{ id: "paid", bill_id: "donor", month: 9, year: 2026, paid_amount: 40, actual_amount: 40, paid_date: "2026-10-15" }];
    const projection = project(snapshot);
    const direct = projection.getDailyBalances(10, 2026).at(-1)?.balance;
    const sequential = project(snapshot);
    sequential.getDailyBalances(9, 2026);
    assert.equal(direct, sequential.getDailyBalances(10, 2026).at(-1)?.balance);
    assert.equal(direct, 9860);
  }
});

test("month ends and leap-day resumes follow the scheduled cash date", () => {
  const snapshot = fixture();
  snapshot.settings.starting_balance_date = "2028-01-01";
  snapshot.bills[0].due_day = 31;
  snapshot.bills[0].debt_payment_pauses = [pause({ start_date: "2028-01-31", resume_date: "2028-02-29" })];
  const projection = project(snapshot, { now: new Date("2028-01-01T12:00:00Z"), timeZone: "UTC" });
  assert.equal(projection.getDebtPlanForMonth(0, 2028)?.allocations.find(item => item.pauseRedirect)?.date, "2028-01-31");
  const february = projection.getDebtPlanForMonth(1, 2028)!;
  assert.equal(february.allocations.some(item => item.pauseRedirect), false);
  assert.equal(february.allocations.find(item => item.targetBillId === "donor")?.date, "2028-02-29");
});

function simulationFixture(snapshot: FinancialProjectionSnapshot) {
  const projection = project(snapshot);
  const baseline = buildCanonicalPlanSimulationBaseline({ startDate: "2026-10-01", horizonMonths: 3, getDailyBalances: projection.getDailyBalances });
  const app = readFileSync("app/plan-simulator.tsx", "utf8");
  const start = app.indexOf("  const buildReferences =");
  const script = transpileModule(app.slice(start, app.indexOf("  const references =", start)), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const bindings: Record<string, unknown> = { useCallback: (callback: unknown) => callback, bills: snapshot.bills,
    incomes: snapshot.incomes, currentMonth: 9, currentYear: 2026, livePayoffPreview: null, settings: snapshot.settings };
  for (const name of ["getBillEffectiveMonthlyTotal", "getBillMonthlyTotal", "getBillOccurrenceAmount", "getBillOccurrencesInMonth", "getDebtMonthSettlements", "getDebtSourceCommitment", "getExtraPayment"] as const) bindings[name] = projection[name];
  const references = new Function(...Object.keys(bindings), script + ";return buildReferences;")(...Object.values(bindings))(baseline) as PlanSimulationReferences;
  return { baseline, references, safetyFloor: 0,
    metrics: { flowScore: 85, flowScoreRequiredAmountDue: 150, flowScoreRequiredAmountCovered: 0, protectedDays: 10, requiredMonthlyOutflow: 150,
      forecastConfidence: "high" as const, currentDebtFreeDate: null } };
}

test("simulator baseline honors saved pauses and redirects without restoring required cash", () => {
  for (const withPending of [false, true]) {
    const snapshot = fixture();
    if (withPending) { snapshot.bills[1].snowball_minimum_boost = 20; pending(snapshot, "recipient", 90); }
    const input = simulationFixture(snapshot);
    const result = projectPlanSimulation({ ...input, changes: [] });
    assert.equal(result.complete, true);
    assert.deepEqual(result.days.map(day => [day.date, day.outflow, day.balance]), input.baseline.days.map(day => [day.date, day.outflow, day.balance]));
    assert.equal(result.days.flatMap(day => day.events).some(event => event.debtTargetBillId === "donor"
      && event.date < "2026-12-01" && event.debtPlanAllocationKind === "required"), false);
    assert.ok(result.days.flatMap(day => day.events).some(event => event.debtPauseRedirect));
    const union = projectPlanSimulation({ ...input, changes: [{ id: "overlap", type: "debt_pause", debtId: "donor", effectiveDate: "2026-11-10", resumeDate: "2027-01-01" },
      { id: "extra", type: "debt_extra", amount: 10, date: "2026-10-20" }] });
    assert.equal(union.complete, true);
    assert.equal(union.days.flatMap(day => day.events).some(event => event.debtTargetBillId === "donor"), false);
    assert.ok(union.debtAllocations.every(item => item.billId !== "donor"));
  }
});

test("plan-off simulator keeps saved pauses when an unrelated expense changes", () => {
  const snapshot = fixture();
  snapshot.settings.debtPayoffEnabled = false;
  const input = simulationFixture(snapshot);
  const result = projectPlanSimulation({ ...input, changes: [{ id: "coffee", type: "spending_once", name: "Coffee", date: "2026-10-20", amount: 1 }] });
  assert.equal(result.complete, true);
  assert.equal(result.endingBalance, input.baseline.days.at(-1)!.balance - 1);
  assert.equal(result.days.flatMap(day => day.events).some(event => event.debtPauseRedirect), false);
});

test("pending recipient principal is reserved before redirect routing and excess credit is consumed once", () => {
  for (const recipientDueDay of [15, 20]) {
    const snapshot = fixture();
    snapshot.bills[1].balance = 75;
    snapshot.bills[1].due_day = recipientDueDay;
    snapshot.bills.push({ ...snapshot.bills[1], id: "third", name: "Third", due_day: 15, balance: 3000, debt_payment_pauses: [] });
    pending(snapshot, "recipient", 90, `2026-10-${recipientDueDay}`);
    const projection = project(snapshot);
    const plan = projection.getRemainingDebtPlanForMonth(9, 2026)!;
    assert.equal(plan.allocations.filter(item => item.sourceBillId === "recipient").reduce((sum, item) => sum + item.amount, 0), 90);
    assert.equal(plan.allocations.filter(item => item.pauseRedirect).reduce((sum, item) => sum + item.amount, 0), 60);
    assert.ok(plan.allocations.filter(item => item.pauseRedirect).every(item => item.targetBillId === "third"));
    assert.equal(plan.plannedPayment, 200);
    assert.equal(projection.getDailyBalances(9, 2026).at(-1)?.balance, 9800);
  }
});

test("settling the lender minimum leaves an exact planned extra available to redirect", () => {
  const snapshot = fixture();
  snapshot.bills[0].balance = 900;
  snapshot.overrides = [{ id: "exact", bill_id: "donor", month: 9, year: 2026, planned_debt_amount: 150, paid_amount: 0 }];
  snapshot.transactions = [{ id: "paid", date: "2026-10-15", amount: -100, category: "Debt", note: "Paid", linked_bill_id: "donor", review_status: "matched",
    review_allocations: [{ type: "bill", targetId: "donor", amount: 100, plannedAmount: 100, occurrenceDate: "2026-10-15", settlement: "full" }] }];
  const projection = project(snapshot);
  assert.equal(projection.getDebtMonthSettlements(9, 2026).get("donor")?.status, "settled");
  assert.equal(projection.getRemainingDebtPlanForMonth(9, 2026)?.allocations.find(item => item.pauseRedirect)?.amount, 50);
  assert.equal(projection.getCashFlow(9, 2026).remaining, -200);
  assert.equal(projection.getDailyBalances(9, 2026).at(-1)?.balance, 9800);
  const input = simulationFixture(snapshot);
  const changed = projectPlanSimulation({ ...input, changes: [{ id: "coffee", type: "spending_once", name: "Coffee", date: "2026-10-20", amount: 1 }] });
  assert.equal(changed.complete, true);
  assert.equal(changed.endingBalance, input.baseline.days.at(-1)!.balance - 1);
});

test("reviewed recipient principal is capped after applying its partial source payment once", () => {
  const snapshot = fixture();
  snapshot.bills[1].balance = 35;
  snapshot.transactions = [{ id: "paid", date: "2026-10-15", amount: -40, category: "Debt", note: "Paid", linked_bill_id: "recipient", review_status: "matched",
    review_allocations: [{ type: "bill", targetId: "recipient", amount: 40, plannedAmount: 50, occurrenceDate: "2026-10-15", settlement: "partial" }] }];
  const projection = project(snapshot);
  const plan = projection.getRemainingDebtPlanForMonth(9, 2026)!;
  assert.equal(plan.allocations.filter(item => item.kind === "required").reduce((sum, item) => sum + item.amount, 0), 10);
  assert.equal(plan.allocations.find(item => item.pauseRedirect)?.amount, 25);
  assert.equal(plan.plannedPayment, 35);
  assert.equal(projection.getCashFlow(9, 2026).remaining, -75);
  assert.equal(projection.getDailyBalances(9, 2026).at(-1)?.balance, 9925);
});

test("all-paused previews retain later payoff dates while current extra eligibility is zero", () => {
  const snapshot = fixture();
  snapshot.bills[1].debt_payment_pauses = [pause({ id: "other-pause" })];
  snapshot.settings.forecast_horizon_months = 1;
  const preview = previewCanonicalDebtSnowball(snapshot, clock, 9, 2026, 0);
  assert.equal(preview.safeMaximum, 0);
  assert.equal(preview.allocations.length, 0);
  assert.ok(preview.debtFreeDate);
  assert.ok(preview.debtFreeDate! >= "2026-12");
  assert.equal(preview.months[0].endingDebt, 3000);
});

test("a manually paid partial remains cash while its plan is off and the unpaid remainder is paused", () => {
  const snapshot = fixture();
  snapshot.settings.debtPayoffEnabled = false;
  snapshot.overrides = [{ id: "paid", bill_id: "donor", month: 9, year: 2026, paid_amount: 40, paid_date: "2026-10-15" }];
  pending(snapshot, "donor", 20);
  const projection = project(snapshot);
  assert.equal(projection.getCashFlow(9, 2026).remaining, -110);
  assert.equal(projection.getDailyBalances(9, 2026).at(-1)?.balance, 9890);
  assert.equal(project(snapshot).getDailyBalances(10, 2026).at(-1)?.balance, 9840);
});

test("protected recipient cash states reserve principal and consume redirect credits consistently", () => {
  for (const state of ["pending", "posted", "reviewed", "manual"] as const) {
    for (const balance of [35, 75]) for (const paid of [40, 90]) {
      const label = `${state} principal=${balance} paid=${paid}`;
      const snapshot = fixture();
      snapshot.bills[1].balance = balance;
      snapshot.bills.push({ ...snapshot.bills[1], id: "third", name: "Third", balance: 3000, debt_payment_pauses: [] });
      if (state === "pending" || state === "posted") pending(snapshot, "recipient", paid);
      if (state === "posted") {
        snapshot.pendingBankTransactions = [];
        Object.assign(snapshot.pendingPlanMatches[0], { status: "ready_review", posted_transaction_id: "posted", posted_plaid_transaction_id: "posted-plaid", posted_amount: paid });
        snapshot.transactionAccountIdentities = [{ id: "bank", plaid_account_id: "checking", name: "Checking", account_type: "depository", account_subtype: "checking", current_balance: 10_000, is_active: true }];
        snapshot.transactions = [{ id: "posted", plaid_transaction_id: "posted-plaid", plaid_account_id: "checking", source: "plaid", date: "2026-10-15", amount: -paid,
          category: "Debt", note: "Posted", review_status: "needs_review" }];
      } else if (state === "reviewed") {
        snapshot.transactions = [{ id: "reviewed", date: "2026-10-15", amount: -paid, category: "Debt", note: "Paid", linked_bill_id: "recipient", review_status: "matched",
          review_allocations: [{ type: "bill", targetId: "recipient", amount: paid, plannedAmount: 50, occurrenceDate: "2026-10-15", settlement: paid < 50 ? "partial" : "full" }] }];
      } else if (state === "manual") {
        snapshot.overrides = [{ id: "paid", bill_id: "recipient", month: 9, year: 2026, paid_amount: paid, actual_amount: paid, paid_date: "2026-10-15" }];
      }
      const projection = project(snapshot);
      const remaining = projection.getRemainingDebtPlanForMonth(9, 2026)!;
      const bankState = state === "pending" || state === "posted";
      const required = bankState ? paid : Math.max(0, 50 - paid);
      const redirectToRecipient = remaining.allocations.filter(item => item.pauseRedirect && item.targetBillId === "recipient").reduce((sum, item) => sum + item.amount, 0);
      assert.ok(redirectToRecipient <= Math.max(0, balance - required), label);
      // An explicitly full reviewed bill records its actual as the historical
      // requirement; manual surplus and bank commitments retain the saved $50.
      const expectedCash = bankState && paid < 50 ? 190 : state === "reviewed" && paid > 50 ? 150 + paid : 200;
      assert.equal(projection.getCashFlow(9, 2026).remaining, -expectedCash, label);
      assert.equal(projection.getDailyBalances(9, 2026).at(-1)?.balance, 10_000 - expectedCash, label);
      assert.equal(projection.getDebtPlanForMonth(10, 2026)?.balances.get("recipient"), 0, label);
      const input = simulationFixture(snapshot);
      const result = projectPlanSimulation({ ...input, changes: [{ id: "coffee", type: "spending_once", name: "Coffee", date: "2026-10-20", amount: 1 }] });
      assert.equal(result.complete, true, label + ": " + JSON.stringify(result.issues));
      assert.equal(result.endingBalance, input.baseline.days.at(-1)!.balance - 1, label);
    }
  }
});

test("unelapsed pause edits keep the original ID and validate inclusive start and exclusive resume dates", () => {
  for (const start of ["2026-11-03", "2026-11-10"]) {
    const selected = pause({ start_date: start, resume_date: "2026-12-10" });
    const history = [selected];
    const before = structuredClone(history);
    assert.deepEqual(editDebtPaymentPauseHistory(history, selected, {
      startDate: "2026-11-05", resumeDate: "2028-02-29", redirectPayment: false,
    }, "2026-11-03", selected.id), [{ ...selected, start_date: "2026-11-05", resume_date: "2028-02-29", redirect_payment: false }]);
    assert.deepEqual(history, before);
    assert.throws(() => editDebtPaymentPauseHistory(history, selected, { startDate: "2026-11-02", resumeDate: "2026-12-10", redirectPayment: true }, "2026-11-03", "new"), /today or later/);
    assert.throws(() => editDebtPaymentPauseHistory(history, selected, { startDate: start, resumeDate: start, redirectPayment: true }, "2026-11-03", "new"), /after the pause starts/);
    assert.throws(() => editDebtPaymentPauseHistory(history, selected, { startDate: start, resumeDate: "2027-02-29", redirectPayment: true }, "2026-11-03", "new"), /valid pause dates/);
  }
});

test("elapsed edits lock the original start and split only when the transfer choice changes", () => {
  const selected = pause({ start_date: "2026-10-01", resume_date: "2026-12-01" });
  const history = [selected];
  assert.deepEqual(editDebtPaymentPauseHistory(history, selected, { startDate: selected.start_date, resumeDate: "2027-01-01", redirectPayment: true }, "2026-11-03", "unused"), [{ ...selected, resume_date: "2027-01-01" }]);
  assert.deepEqual(editDebtPaymentPauseHistory(history, selected, { startDate: selected.start_date, resumeDate: "2026-12-15", redirectPayment: false }, "2026-11-03", "new-choice"), [
    { ...selected, resume_date: "2026-11-03" },
    { id: "new-choice", start_date: "2026-11-03", resume_date: "2026-12-15", redirect_payment: false },
  ]);
  assert.throws(() => editDebtPaymentPauseHistory(history, selected, { startDate: "2026-10-02", resumeDate: "2026-12-01", redirectPayment: true }, "2026-11-03", "new"), /original start date/);
  assert.throws(() => editDebtPaymentPauseHistory(history, selected, { startDate: selected.start_date, resumeDate: "2026-11-03", redirectPayment: true }, "2026-11-03", "new"), /Resume now/);
  assert.throws(() => editDebtPaymentPauseHistory(history, selected, { startDate: selected.start_date, resumeDate: "2026-12-01", redirectPayment: false }, "2026-11-03", selected.id), /unique valid ID/);
});

test("editing a stale, missing or expired captured interval never creates a replacement pause", () => {
  const selected = pause({ start_date: "2026-11-01", resume_date: "2026-12-01" });
  const input = { startDate: selected.start_date, resumeDate: "2026-12-15", redirectPayment: true };
  for (const current of [[], [{ ...selected, id: "replacement" }], [{ ...selected, start_date: "2026-10-31" }],
    [{ ...selected, resume_date: "2026-12-02" }], [{ ...selected, redirect_payment: false }]]) {
    const before = structuredClone(current);
    assert.throws(() => editDebtPaymentPauseHistory(current, selected, input, "2026-11-03", "new"), /changed or ended.*Reopen/);
    assert.deepEqual(current, before);
  }
  assert.throws(() => editDebtPaymentPauseHistory([selected], selected, input, selected.resume_date, "new"), /changed or ended/);
});

test("full-history edits reject overlap and allow date-only or no-op edits at interval capacity", () => {
  const selected = pause({ start_date: "2026-11-01", resume_date: "2026-12-01" });
  const previous = Array.from({ length: 119 }, (_, index) => pause({ id: `history-${index}`, start_date: `${1900 + index}-01-01`, resume_date: `${1900 + index}-02-01` }));
  const history = [...previous, selected];
  const before = structuredClone(history);
  assert.deepEqual(editDebtPaymentPauseHistory(history, selected, { startDate: selected.start_date, resumeDate: selected.resume_date, redirectPayment: selected.redirect_payment }, "2026-11-03", "unused"), history);
  const extended = editDebtPaymentPauseHistory(history, selected, { startDate: selected.start_date, resumeDate: "2026-12-15", redirectPayment: true }, "2026-11-03", "unused");
  assert.equal(extended.length, 120);
  assert.equal(extended.at(-1)?.id, selected.id);
  assert.throws(() => editDebtPaymentPauseHistory(history, selected, { startDate: selected.start_date, resumeDate: "2026-12-15", redirectPayment: false }, "2026-11-03", "split"), /at most 120/);
  assert.deepEqual(history, before);
  const neighbor = pause({ id: "next", start_date: "2026-12-10", resume_date: "2027-01-01" });
  assert.throws(() => editDebtPaymentPauseHistory([selected, neighbor], selected, { startDate: selected.start_date, resumeDate: "2026-12-15", redirectPayment: false }, "2026-11-03", "split"), /overlap/);
});

test("changing the transfer choice preserves every projection day before the edit date", () => {
  for (const originalChoice of [true, false]) {
    const snapshot = fixture();
    const selected = { ...snapshot.bills[0].debt_payment_pauses![0], redirect_payment: originalChoice };
    snapshot.bills[0].debt_payment_pauses = [selected];
    const edited = structuredClone(snapshot);
    edited.bills[0].debt_payment_pauses = editDebtPaymentPauseHistory(snapshot.bills[0].debt_payment_pauses, selected, {
      startDate: selected.start_date, resumeDate: "2026-12-15", redirectPayment: !originalChoice,
    }, "2026-11-03", "new-choice");
    const before = project(snapshot), after = project(edited);
    const previousDays = (projection: ReturnType<typeof project>) => [9, 10].flatMap(month => projection.getDailyBalances(month, 2026))
      .filter(day => day.balanceDate < "2026-11-03");
    assert.deepEqual(previousDays(after), previousDays(before));
    const futureRedirect = after.getRemainingDebtPlanForMonth(10, 2026)?.allocations.find(allocation => allocation.pauseRedirect);
    assert.equal(Boolean(futureRedirect), !originalChoice);
    assert.equal(isDebtPaymentPaused(edited.bills[0], "2026-11-02"), true);
    assert.equal(isDebtPaymentPaused(edited.bills[0], "2026-11-03"), true);
  }
});
