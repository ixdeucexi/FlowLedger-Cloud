import assert from "node:assert/strict";
import test from "node:test";
import { pendingBudgetMatchingRows, postedBudgetMatchingRows, budgetMatchingMonth } from "./budgetMatching";
import { buildCategoryPlan } from "./categoryPlanning";
import { transactionCategoryParts, type ReviewTransactionLike } from "./reviewCenter";

const period = { month: 10, year: 2026 };
const accountRef = (row: { plaid_account_id?: string }) => row.plaid_account_id ? `bank:${row.plaid_account_id}` as const : null;
const pending = (id: string, date = "2026-11-16", amount = -48, account = "checking-a") => ({ plaid_transaction_id: id, plaid_account_id: account, transaction_date: date, amount, name: id });
const posted = (id: string, date = "2026-11-16", account = "checking-a"): ReviewTransactionLike => ({ id, date, amount: -48, note: id, category: "Food", source: "plaid", plaid_account_id: account, review_status: "needs_review" });

test("pending placement selects real outflows from the exact budget month and keeps matched rows available for undo", () => {
  const rows = [pending("new"), pending("already-linked"), pending("pending-hold:estimated"), pending("deposit", undefined, 200), pending("last-month", "2026-10-31"), pending("next-month", "2026-12-01")];
  const before = JSON.stringify(rows);
  assert.deepEqual(pendingBudgetMatchingRows(rows, period, null, accountRef).map(row => row.plaid_transaction_id), ["already-linked", "new"]);
  assert.equal(JSON.stringify(rows), before);
});

test("both matching tabs use the same account filter without touching other accounts", () => {
  const pendingRows = [pending("a"), pending("b", undefined, -48, "checking-b")];
  const postedRows = [posted("a"), posted("b", undefined, "checking-b"), { ...posted("unassigned"), plaid_account_id: undefined }];
  assert.deepEqual(pendingBudgetMatchingRows(pendingRows, period, "bank:checking-a", accountRef).map(row => row.plaid_transaction_id), ["a"]);
  assert.deepEqual(postedBudgetMatchingRows(postedRows, period, "bank:checking-a", accountRef).map(row => row.id), ["a"]);
  assert.deepEqual(postedBudgetMatchingRows(postedRows, period, "unassigned", accountRef).map(row => row.id), ["unassigned"]);
  assert.equal(pendingBudgetMatchingRows(pendingRows, period, "bank:missing", accountRef).length, 0);
});

test("selected periods handle year boundaries and never leak ordinary Review Center rollover rows", () => {
  const rows = [posted("december", "2026-12-31"), posted("january", "2027-01-01")];
  assert.deepEqual(postedBudgetMatchingRows(rows, { month: 0, year: 2027 }, null, accountRef).map(row => row.id), ["january"]);
  assert.deepEqual(postedBudgetMatchingRows(rows, { month: 11, year: 2026 }, null, accountRef).map(row => row.id), ["december"]);
  for (const invalid of [{ month: 12, year: 2026 }, { month: -1, year: 2026 }, { month: 0, year: NaN }]) {
    assert.equal(budgetMatchingMonth(invalid), null);
    assert.deepEqual(postedBudgetMatchingRows(rows, invalid, null, accountRef), []);
  }
});

test("posted badges only include imported posted activity that still needs review", () => {
  const rows = [posted("review"), { ...posted("manual"), source: "manual" }, { ...posted("pending"), pending: true }, { ...posted("removed"), removed_at: "2026-11-16" }, { ...posted("done"), review_status: "matched" }];
  assert.deepEqual(postedBudgetMatchingRows(rows, period, null, accountRef).map(row => row.id), ["review"]);
});

test("pending-to-posted review never spends category money twice or alters an unsaved budget draft", () => {
  const drafts = Object.freeze({ Food: "125.50" });
  const charge = pending("bank-charge");
  assert.equal(pendingBudgetMatchingRows([charge], period, null, accountRef).length, 1);
  const categoryPlan = (rows: ReviewTransactionLike[]) => buildCategoryPlan(["Food"], [], rows.flatMap(transactionCategoryParts), [{ category: "Food", amount: Number(drafts.Food) }])[0];
  assert.equal(categoryPlan([]).spent, 0);
  const bankPosted = posted("posted-charge");
  assert.equal(categoryPlan([bankPosted]).spent, 0); // Waiting for review.
  const reviewed: ReviewTransactionLike = { ...bankPosted, review_status: "matched", review_resolution: "category", review_allocations: [{ type: "category", amount: 48, category: "Food" }] };
  assert.equal(postedBudgetMatchingRows([reviewed], period, null, accountRef).length, 0);
  const plan = categoryPlan([reviewed]);
  assert.equal(plan.spent, 48);
  assert.equal(plan.remaining, 77.5);
  assert.deepEqual(drafts, { Food: "125.50" });
});
