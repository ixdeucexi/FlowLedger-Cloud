import assert from "node:assert/strict";
import test from "node:test";
import { previewTransactionSafetyStop } from "./transactionSafetyStop";
import { createFinancialProjection } from "./financialProjection";
import golden from "./financialProjection.golden.json";
import type { FinancialProjectionSnapshot } from "./financialProjectionTypes";

function fixture(): FinancialProjectionSnapshot {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  snapshot.settings = { ...snapshot.settings, starting_balance: 250, starting_balance_date: "2026-12-01", safety_floor: 200, forecast_horizon_months: 2 };
  snapshot.bills = []; snapshot.goals = []; snapshot.decisions = []; snapshot.overrides = []; snapshot.billDateMoves = []; snapshot.extraPayments = [];
  snapshot.accounts = []; snapshot.connectedBankAccounts = []; snapshot.pendingBankTransactions = []; snapshot.pendingPlanMatches = [];
  snapshot.incomes = [{ id: "pay", name: "Pay", amount: 500, frequency: "monthly", start_date: "2026-12-15", next_payment_date: "2026-12-15" }];
  snapshot.transactions = [{ id: "old", amount: -200, date: "2026-12-20", category: "Other", note: "Purchase" }];
  return snapshot;
}
const now = new Date("2026-12-01T12:00:00Z");
const preview = (snapshot: FinancialProjectionSnapshot, date: string, amount = -200) => previewTransactionSafetyStop({ snapshot, transaction: { ...snapshot.transactions[0], date, amount }, existingId: "old", now, timeZone: "UTC" });

test("same/smaller earlier expense edits warn before payday rather than relying on amount delta", () => {
  assert.equal(preview(fixture(), "2026-12-10")?.lowestBalance, 50);
  assert.equal(preview(fixture(), "2026-12-10", -100)?.lowestBalance, 150);
  assert.equal(preview(fixture(), "2026-12-10", -300)?.lowestBalance, -50);
  assert.equal(preview(fixture(), "2026-12-25"), null);
  assert.equal(preview(fixture(), "2026-12-20"), null);
});

test("replacement preserves bank anchor semantics and ignores absorbed posted bank edits", () => {
  const snapshot = fixture();
  snapshot.settings.starting_balance_date = "2026-12-12";
  snapshot.accounts = [{ id: "checking", name: "Checking", account_type: "checking", current_balance: 250, balance_as_of: "2026-12-12", is_active: true, created_at: "2026-12-01" }];
  snapshot.transactions[0] = { ...snapshot.transactions[0], source: "statement", date: "2026-12-05", account_id: "checking" };
  const warning = previewTransactionSafetyStop({ snapshot, transaction: { ...snapshot.transactions[0], date: "2026-12-10" }, existingId: "old", now: new Date("2026-12-12T12:00:00Z"), timeZone: "UTC" });
  // The bank balance has already absorbed the posted charge; editing its historical date cannot charge it twice.
  assert.equal(warning, null);
});

test("month/year replacement matches a full canonical recomputation without mutating snapshot", () => {
  const snapshot = fixture();
  snapshot.transactions[0].date = "2027-01-20";
  const before = JSON.stringify(snapshot);
  const transaction = { ...snapshot.transactions[0], date: "2026-12-10", amount: -150, user_edited_at: now.toISOString() };
  const actual = createFinancialProjection({ ...snapshot, transactions: [transaction] }, { now, timeZone: "UTC" }).getDailyBalances(11, 2026).find(day => day.day === 10)!;
  assert.equal(preview(snapshot, transaction.date, transaction.amount)?.lowestBalance, actual.balance);
  assert.equal(JSON.stringify(snapshot), before);
});

test("checking eligibility and matched allocation metadata remain canonical during edit previews", () => {
  for (const extra of [
    { pending: true },
    { removed_at: "2026-12-01" },
    { account_id: "savings" },
    { linked_bill_id: "bill", match_reason: "confirmed_bill_match", review_status: "matched" as const, review_resolution: "bill" as const, review_allocations: [{ type: "bill" as const, targetId: "bill", occurrenceDate: "2026-12-20", amount: 200, settlement: "exact" as const }] },
    { review_status: "matched" as const, review_resolution: "goal" as const, review_allocations: [{ type: "planned_expense" as const, targetId: "bucket", occurrenceDate: "2026-12-20", amount: 200, settlement: "exact" as const }] },
    { linked_bill_id: "debt", debt_applied_bill_id: "debt", debt_applied_amount: 200 },
  ]) {
    const snapshot = fixture();
    snapshot.accounts = [{ id: "savings", name: "Savings", account_type: "savings", current_balance: 1000, is_active: true, balance_as_of: "2026-12-01", created_at: "2026-12-01" }];
    snapshot.transactions[0] = { ...snapshot.transactions[0], ...extra };
    const tx = { ...snapshot.transactions[0], date: "2026-12-10", user_edited_at: now.toISOString() };
    const before = createFinancialProjection(snapshot, { now, timeZone: "UTC" }).getDailyBalances(11, 2026).find(day => day.day === 10)!;
    const after = createFinancialProjection({ ...snapshot, transactions: [tx] }, { now, timeZone: "UTC" }).getDailyBalances(11, 2026).find(day => day.day === 10)!;
    assert.equal(Boolean(preview(snapshot, tx.date)), after.balance < 200 && after.balance < before.balance - 0.005);
  }
});
