import assert from "node:assert/strict";
import test from "node:test";
import golden from "./financialProjection.golden.json";
import { createFinancialProjection } from "./financialProjection";
import { buildTransactionLedger } from "./ledgerEngine";
import { pendingManualReplacementIds } from "./pendingManualReplacement";
import type { Bill, FinancialProjectionSnapshot } from "./financialProjectionTypes";

const clock = { now: new Date("2026-10-23T12:00:00Z"), timeZone: "UTC" };
function fixture(): FinancialProjectionSnapshot {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  snapshot.settings = { ...snapshot.settings, starting_balance: 3000, starting_balance_date: "2026-10-01", forecast_horizon_months: 1, debtPayoffEnabled: false };
  snapshot.bills = []; snapshot.goals = []; snapshot.decisions = []; snapshot.overrides = []; snapshot.billDateMoves = []; snapshot.extraPayments = [];
  snapshot.accounts = []; snapshot.connectedBankAccounts = []; snapshot.pendingBankTransactions = []; snapshot.deletedTransactions = []; snapshot.incomes = [];
  snapshot.transactionAccountIdentities = [{ id: "internal-checking", plaid_account_id: "external-checking", name: "Checking", current_balance: 0, is_active: true, account_type: "depository", account_subtype: "checking" }];
  snapshot.transactions = [
    { id: "manual", date: "2026-10-22", amount: -50, source: "manual", category: "Debt", note: "Discover Payment", review_status: "legacy_reviewed" },
    { id: "posted", plaid_transaction_id: "posted-provider", plaid_account_id: "external-checking", date: "2026-10-22", amount: -50, source: "plaid", category: "Other", note: "Electronic withdrawal", review_status: "needs_review" },
  ];
  snapshot.pendingPlanMatches = [{ id: "match", pending_plaid_transaction_id: "pending-provider", pending_account_id: "internal-checking", target_type: "manual", target_id: "manual", target_name: "Discover Payment", occurrence_date: "2026-10-22", planned_amount: 50, pending_amount: 50, pending_transaction_date: "2026-10-22", status: "ready_review", posted_transaction_id: "posted", posted_plaid_transaction_id: "posted-provider", posted_amount: 50, created_at: "2026-10-22", updated_at: "2026-10-22" }];
  return snapshot;
}
const ids = (snapshot: FinancialProjectionSnapshot) => pendingManualReplacementIds(snapshot.transactions, snapshot.pendingPlanMatches, snapshot.transactionAccountIdentities, snapshot.bills);

test("explicit ready-review replacement counts one posted cash event while retaining raw manual review data", () => {
  const snapshot = fixture();
  const original = JSON.stringify(snapshot);
  assert.deepEqual([...ids(snapshot)], ["manual"]);
  const projection = createFinancialProjection(snapshot, clock);
  const day = projection.getDailyBalances(9, 2026).find(item => item.day === 22)!;
  assert.equal(day.balance, 2950);
  assert.equal(day.expense, 50);
  assert.deepEqual(projection.transactionLedger.cashTransactions.map(item => item.id), ["posted"]);
  assert.deepEqual(projection.transactionLedger.visibleCheckingTransactions.map(item => item.id), ["posted"]);
  assert.deepEqual(day.events?.filter(event => event.sourceType === "transaction").map(event => event.sourceId), ["posted"]);
  assert.equal(JSON.stringify(snapshot), original);
});

test("posted actual amounts and dates are authoritative before manual confirmation", () => {
  for (const amount of [40, 60]) {
    const snapshot = fixture();
    snapshot.transactions[0].date = "2026-10-21";
    snapshot.pendingPlanMatches[0].occurrence_date = "2026-10-21";
    snapshot.transactions[1].amount = -amount;
    const projection = createFinancialProjection(snapshot, clock);
    const days = projection.getDailyBalances(9, 2026);
    assert.equal(days.find(day => day.day === 21)?.expense, 0);
    assert.equal(days.find(day => day.day === 22)?.expense, amount);
    assert.equal(days.find(day => day.day === 22)?.balance, 3000 - amount);
  }
});

test("bank anchors absorb posted cash once without replaying a hidden manual representation", () => {
  const snapshot = fixture();
  snapshot.connectedBankAccounts = [{ ...snapshot.transactionAccountIdentities[0], current_balance: 2950, updated_at: "2026-10-23T12:00:00Z" }];
  const projection = createFinancialProjection(snapshot, clock);
  const days = projection.getDailyBalances(9, 2026);
  assert.equal(days.find(day => day.day === 23)?.balance, 2950);
  assert.equal(days.find(day => day.day === 24)?.balance, 2950);
});

test("an explicit link survives posting across a month boundary and either posted identity", () => {
  for (const identity of ["id", "plaid"] as const) {
    const snapshot = fixture();
    snapshot.transactions[0].date = "2026-10-31";
    snapshot.transactions[1].date = "2026-11-01";
    Object.assign(snapshot.pendingPlanMatches[0], { occurrence_date: "2026-10-31", pending_transaction_date: "2026-10-31" });
    if (identity === "id") snapshot.pendingPlanMatches[0].posted_plaid_transaction_id = undefined;
    else snapshot.pendingPlanMatches[0].posted_transaction_id = undefined;
    const projection = createFinancialProjection(snapshot, { now: new Date("2026-11-02T12:00:00Z"), timeZone: "UTC" });
    assert.equal(projection.getDailyBalances(9, 2026).find(day => day.day === 31)?.expense, 0);
    assert.equal(projection.getDailyBalances(10, 2026).find(day => day.day === 1)?.balance, 2950);
  }
});

test("manual debt audit and the existing settled minimum survive provisional cash consolidation", () => {
  const snapshot = fixture();
  const template = structuredClone(golden.cases[0].snapshot.bills[0]) as unknown as Bill;
  snapshot.settings.debtPayoffEnabled = true;
  snapshot.bills = [{ ...template, id: "card", name: "Discover", amount: 50, category: "Debt", is_debt: true, balance: 950, interest_rate: 0, due_day: 22, start_date: "2026-01-01", include_in_snowball: true }];
  snapshot.overrides = [{ id: "paid", bill_id: "card", month: 9, year: 2026, paid_amount: 50, actual_amount: 50, paid_date: "2026-10-22", required_debt_amount: 50 }];
  snapshot.transactions[0] = { ...snapshot.transactions[0], linked_bill_id: "card", debt_applied_bill_id: "card", debt_applied_amount: 50 };
  for (const amount of [40, 50, 60]) {
    snapshot.transactions[1].amount = -amount;
    const projection = createFinancialProjection(snapshot, clock);
    assert.equal(projection.getDailyBalances(9, 2026).find(day => day.day === 22)?.balance, 3000 - amount);
    const settlement = projection.getDebtMonthSettlements(9, 2026).get("card")!;
    assert.equal(settlement.paidAmount, 50);
    assert.equal(settlement.remainingRequired, 0);
    assert.equal(projection.getRemainingDebtPlanForMonth(9, 2026)?.allocations.length, 0);
    assert.equal(snapshot.bills[0].balance, 950);
    assert.equal(snapshot.transactions[0].debt_applied_amount, 50);
    assert.equal(snapshot.transactions[1].debt_applied_amount, undefined);
  }
});

test("invalid, stale, removed, wrong-scope or non-checking links cannot hide manual cash", () => {
  const variants: Array<(snapshot: FinancialProjectionSnapshot) => void> = [
    snapshot => { snapshot.pendingPlanMatches[0].status = "cancelled"; },
    snapshot => { snapshot.pendingPlanMatches[0].status = "expired"; },
    snapshot => { snapshot.pendingPlanMatches[0].status = "active"; },
    snapshot => { snapshot.pendingPlanMatches[0].status = "completed"; },
    snapshot => { snapshot.pendingPlanMatches[0].posted_transaction_id = "missing"; },
    snapshot => { snapshot.pendingPlanMatches[0].posted_plaid_transaction_id = "mismatch"; },
    snapshot => { snapshot.pendingPlanMatches[0].pending_account_id = "different-checking"; },
    snapshot => { snapshot.pendingPlanMatches[0].planned_amount = 60; },
    snapshot => { snapshot.transactions[0].date = "2026-10-21"; },
    snapshot => { snapshot.transactions[0].deleted_at = "2026-10-23"; },
    snapshot => { snapshot.transactions[1].removed_at = "2026-10-23"; },
    snapshot => { snapshot.transactions[1].pending = true; },
    snapshot => { snapshot.transactions[1].review_status = "matched"; },
    snapshot => { snapshot.transactions[1].amount = Number.NaN; },
    snapshot => { snapshot.transactions[1].plaid_account_id = "unknown"; },
    snapshot => { snapshot.transactionAccountIdentities[0].account_subtype = "savings"; },
    snapshot => { Object.assign(snapshot.transactions[0], { household_id: "home-a" }); Object.assign(snapshot.transactions[1], { household_id: "home-b" }); },
    snapshot => { Object.assign(snapshot.transactions[0], { budget_id: "budget-a" }); Object.assign(snapshot.transactions[1], { budget_id: "budget-b" }); },
  ];
  for (const change of variants) { const snapshot = fixture(); change(snapshot); assert.deepEqual([...ids(snapshot)], []); }
});

test("ambiguous explicit links fail closed and duplicate records of the same pair suppress only once", () => {
  const snapshot = fixture();
  snapshot.pendingPlanMatches.push({ ...snapshot.pendingPlanMatches[0], id: "same-pair" });
  assert.deepEqual([...ids(snapshot)], ["manual"]);
  snapshot.transactions.push({ ...snapshot.transactions[1], id: "other-posted", plaid_transaction_id: "other-provider" });
  snapshot.pendingPlanMatches[1] = { ...snapshot.pendingPlanMatches[1], posted_transaction_id: "other-posted", posted_plaid_transaction_id: "other-provider" };
  assert.deepEqual([...ids(snapshot)], []);
  snapshot.transactions = [snapshot.transactions[0], snapshot.transactions[1], { ...snapshot.transactions[0], id: "other-manual" }];
  snapshot.pendingPlanMatches[1] = { ...snapshot.pendingPlanMatches[0], id: "other-target", target_id: "other-manual" };
  assert.deepEqual([...ids(snapshot)], []);
});

test("completed confirmation and undo restore normal ledger behavior without mutating or deleting rows", () => {
  const snapshot = fixture();
  const originalManual = snapshot.transactions[0];
  snapshot.transactions = [{ ...snapshot.transactions[1], review_status: "matched", review_resolution: "manual" }];
  snapshot.pendingPlanMatches[0].status = "completed";
  assert.deepEqual([...ids(snapshot)], []);
  assert.equal(createFinancialProjection(snapshot, clock).getDailyBalances(9, 2026).find(day => day.day === 22)?.balance, 2950);
  snapshot.transactions = [originalManual, { ...snapshot.transactions[0], review_status: "needs_review", review_resolution: undefined }];
  snapshot.pendingPlanMatches[0].status = "ready_review";
  assert.equal(createFinancialProjection(snapshot, clock).getDailyBalances(9, 2026).find(day => day.day === 22)?.balance, 2950);
  snapshot.pendingPlanMatches = [];
  const untouched = buildTransactionLedger(snapshot.transactions, snapshot.transactions, snapshot.transactionAccountIdentities);
  assert.equal(untouched.cashTransactions.length, 2, "ordinary ledger callers must retain their existing semantics");
});
