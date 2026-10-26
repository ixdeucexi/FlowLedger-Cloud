import assert from "node:assert/strict";
import test from "node:test";
import golden from "./financialProjection.golden.json";
import type { FinancialProjectionSnapshot, Goal, Transaction } from "./financialProjectionTypes";
import { bucketPurchaseAllocation, bucketPurchaseCandidates, bucketPurchaseHistory, bucketPurchaseTransaction, isBucketLinkedManualPurchase } from "./bucketPurchases";
import { previewBucketBudget, previewBucketPurchase } from "./bucketPurchasePreview";
import { previewTransactionSafetyStop } from "./transactionSafetyStop";
import { manualActivityMatchCandidates } from "./billMatching";
import { pendingManualReplacementIds } from "./pendingManualReplacement";
import { createFinancialProjection } from "./financialProjection";
const now = new Date("2026-12-01T12:00:00Z");
const bucket: Goal = { id: "bucket", name: "Trip", created_at: "2026-12-01", goal_type: "planned_expense", target_amount: 200, current_amount: 0, target_date: "2026-12-20" };
const purchase: Transaction = { id: "purchase", amount: -100, date: "2026-12-20", category: "Other", note: "Tickets", source: "manual" };
function fixture(): FinancialProjectionSnapshot {
  const s = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  s.settings = { ...s.settings, starting_balance: 350, starting_balance_date: "2026-12-01", safety_floor: 200, forecast_horizon_months: 2 };
  s.bills = []; s.decisions = []; s.overrides = []; s.billDateMoves = []; s.extraPayments = [];
  s.accounts = []; s.connectedBankAccounts = []; s.transactionAccountIdentities = []; s.pendingBankTransactions = []; s.pendingPlanMatches = [];
  s.incomes = [{ id: "pay", name: "Pay", amount: 500, frequency: "monthly", start_date: "2026-12-15", next_payment_date: "2026-12-15" }];
  s.goals = [{ ...bucket }]; s.transactions = []; return s;
}
const preview = (snapshot: FinancialProjectionSnapshot, transaction: Transaction) => previewBucketPurchase({ snapshot, bucketId: "bucket", transaction, now, timeZone: "UTC" });
test("reserved purchase replaces its reservation rather than double reserving cash", () => {
  const s = fixture(); s.incomes = [];
  assert.ok(previewTransactionSafetyStop({ snapshot: s, transaction: purchase, now, timeZone: "UTC" }));
  assert.equal(preview(s, purchase), null); assert.equal(s.goals[0].current_amount, 0); assert.equal(s.transactions.length, 0);
});
test("spending before payday still warns when it uses cash reserved for later", () => {
  const s = fixture(); s.settings.starting_balance = 250;
  assert.equal(preview(s, { ...purchase, date: "2026-12-10" })?.lowestBalance, 150);
});
test("bucket purchase edit preview preserves other purchases and old date context", () => {
  const s = fixture(); s.settings.starting_balance = 250;
  s.transactions = [bucketPurchaseTransaction(purchase, bucket), bucketPurchaseTransaction({ ...purchase, id: "other", amount: -25 }, bucket)]; s.goals[0].current_amount = 125;
  assert.equal(preview(s, { ...s.transactions[0], date: "2026-12-10" })?.lowestBalance, 150);
  assert.equal(preview(s, { ...s.transactions[0], amount: -75 }), null); assert.equal(s.goals[0].current_amount, 125);
});
test("budget adjustment previews only additional reservation and retains authoritative spent", () => {
  const s = fixture(); s.incomes = []; s.settings.starting_balance = 450; s.goals[0].current_amount = 100; s.transactions = [bucketPurchaseTransaction(purchase, bucket)];
  const warning = previewBucketBudget({ snapshot: s, goal: { ...bucket, target_amount: 300, current_amount: 0 }, now, timeZone: "UTC" });
  assert.equal(warning?.lowestBalance, 150); assert.equal(warning?.amount, 100);
  assert.equal(previewBucketBudget({ snapshot: s, goal: { ...bucket, target_amount: 150 }, now, timeZone: "UTC" }), null);
});
test("legacy split history reports own allocation rather than full transaction cost", () => {
  const tx = bucketPurchaseTransaction({ ...purchase, amount: -150 }, bucket);
  tx.review_allocations = [{ type: "planned_expense", source: "goal", targetId: "bucket", amount: 50, settlement: "partial" }, { type: "category", category: "Other", amount: 100 }];
  assert.equal(bucketPurchaseAllocation(tx, "bucket"), 50); assert.equal(bucketPurchaseAllocation(tx, "another"), 0);
  assert.deepEqual(bucketPurchaseHistory([tx, { ...tx, id: "removed", removed_at: "today" }, { ...tx, id: "pending", pending: true }], "bucket").map(p => p.allocated), [50]); assert.equal(tx.amount, -150);
});
test("picker excludes pending, removed, transfer, income, debt and already owned money", () => {
  const invalid: Transaction[] = [{ ...purchase, id: "pending", pending: true }, { ...purchase, id: "removed", removed_at: "today" }, { ...purchase, id: "deleted", deleted_at: "today" }, { ...purchase, id: "transfer", category: "Transfer" }, { ...purchase, id: "income", amount: 100 }, { ...purchase, id: "debt", linked_bill_id: "debt" }, { ...purchase, id: "invalid", amount: NaN }, bucketPurchaseTransaction({ ...purchase, id: "assigned" }, bucket)];
  const bank: Transaction = { ...purchase, id: "bank", source: "plaid", note: "Hotel" };
  assert.deepEqual(bucketPurchaseCandidates([purchase, bank, ...invalid], "manual").map(t => t.id), [purchase.id]);
  assert.deepEqual(bucketPurchaseCandidates([purchase, bank, ...invalid], "bank", "hotel").map(t => t.id), [bank.id]);
  assert.deepEqual(bucketPurchaseCandidates([purchase, bank], "bank", "missing"), []);
});
test("posted replacement supports bucket manual purchases while pending chooser keeps existing policy", () => {
  const tx = bucketPurchaseTransaction(purchase, bucket);
  assert.equal(isBucketLinkedManualPurchase(tx), true); assert.equal(isBucketLinkedManualPurchase({ ...tx, linked_bill_id: "debt" }), false);
  assert.deepEqual(manualActivityMatchCandidates([tx], tx.date), []);
  assert.deepEqual(manualActivityMatchCandidates([tx], tx.date, "posted", [], true).map(t => t.billId), [tx.id]);
  assert.deepEqual(manualActivityMatchCandidates([tx], "2027-01-01", "posted", [], true), []);
});
test("existing pending link survives bucket attachment with one cash event across posted handoff", () => {
  const s = fixture(); s.incomes = []; s.settings.starting_balance = 1000;
  const manual = bucketPurchaseTransaction({ ...purchase, date: "2026-12-31" }, bucket);
  const bank: Transaction = { ...purchase, id: "bank", source: "plaid", date: "2027-01-01", plaid_transaction_id: "posted-provider", plaid_account_id: "checking", review_status: "needs_review" };
  s.transactions = [manual, bank]; s.goals[0].current_amount = 100;
  s.transactionAccountIdentities = [{ id: "internal", plaid_account_id: "checking", name: "Checking", current_balance: 0, is_active: true, account_type: "depository", account_subtype: "checking" }];
  s.pendingPlanMatches = [{ id: "match", pending_plaid_transaction_id: "pending-provider", pending_account_id: "internal", target_type: "manual", target_id: manual.id, target_name: "Tickets", occurrence_date: manual.date, planned_amount: 100, pending_amount: 100, pending_transaction_date: manual.date, status: "ready_review", posted_transaction_id: bank.id, posted_plaid_transaction_id: "posted-provider", posted_amount: 100, created_at: manual.date, updated_at: bank.date }];
  assert.deepEqual([...pendingManualReplacementIds(s.transactions, s.pendingPlanMatches, s.transactionAccountIdentities)], [manual.id]);
  assert.deepEqual(manualActivityMatchCandidates(s.transactions, bank.date, bank.id, [], true, s.pendingPlanMatches).map(t => t.billId), [manual.id]);
  const clock = { now: new Date("2027-01-02T12:00:00Z"), timeZone: "UTC" }; const before = createFinancialProjection(s, clock);
  s.transactions = [bucketPurchaseTransaction(bank, bucket)]; s.pendingPlanMatches[0].status = "completed"; const after = createFinancialProjection(s, clock);
  assert.equal(before.getDailyBalances(0, 2027)[0].balance, 800); assert.equal(after.getDailyBalances(0, 2027)[0].balance, 800);
  assert.equal(before.transactionLedger.cashTransactions.length, 1); assert.equal(after.transactionLedger.cashTransactions.length, 1);
});
