import assert from "node:assert/strict";
import test from "node:test";

import { allocationTotal, buildCurrentMonthReviewQueue, matchedOccurrenceAllocations, occurrenceKey, rankReviewTargets, reviewAllocationsAreBalanced, reviewQueueAfterSkips, transactionCategoryParts } from "./reviewCenter";

test("queues only active current-month posted Plaid transactions oldest first", () => {
  const queue = buildCurrentMonthReviewQueue([
    { id: "newer", date: "2026-07-12", amount: -20, category: "Other", note: "B", source: "plaid", review_status: "needs_review" },
    { id: "older", date: "2026-07-02", amount: -10, category: "Other", note: "A", source: "plaid", review_status: "needs_review" },
    { id: "pending", date: "2026-07-01", amount: -5, category: "Other", note: "P", source: "plaid", review_status: "needs_review", pending: true },
    { id: "past", date: "2026-06-30", amount: -8, category: "Other", note: "Past", source: "plaid", review_status: "needs_review" },
    { id: "done", date: "2026-07-03", amount: -9, category: "Other", note: "Done", source: "plaid", review_status: "categorized" },
    { id: "manual", date: "2026-07-04", amount: -7, category: "Other", note: "Manual", source: "manual", review_status: "needs_review" },
  ], "2026-07-14");
  assert.deepEqual(queue.map(transaction => transaction.id), ["older", "newer"]);
});

test("skip moves an item aside without changing its review state", () => {
  const queue = [
    { id: "first", review_status: "needs_review" },
    { id: "second", review_status: "needs_review" },
  ];
  assert.deepEqual(reviewQueueAfterSkips(queue, ["first"]).map(transaction => transaction.id), ["second"]);
  assert.equal(queue[0]?.review_status, "needs_review");
  assert.deepEqual(reviewQueueAfterSkips(queue, ["first", "second"]), []);
});

test("ranks exact same-day calendar matches first", () => {
  const targets = rankReviewTargets(
    { amount: -370, date: "2026-07-02", note: "Huntsv Utilities", merchant_name: "Huntsv Utilities", category: "Utilities" },
    [
      { type: "bill", id: "rent", name: "Rent", category: "Housing", plannedAmount: 1400, occurrenceDate: "2026-07-01" },
      { type: "bill", id: "utilities", name: "Utilities", category: "Utilities", plannedAmount: 370, occurrenceDate: "2026-07-02" },
    ],
  );
  assert.equal(targets[0]?.id, "utilities");
  assert.ok((targets[0]?.score ?? 0) > (targets[1]?.score ?? 0));
});

test("uses the meaningful bank name to break equal amount and date ties", () => {
  const targets = rankReviewTargets(
    { amount: -14, date: "2026-07-08", note: "Electronic Withdrawal CAPITAL / ONE - ONLINE PMT", category: "Loan payments" },
    [
      { type: "bill", id: "other", name: "Kids Transfer", category: "Other", plannedAmount: 14, occurrenceDate: "2026-07-08" },
      { type: "bill", id: "capital-one", name: "John Capital One 1", category: "Debt", plannedAmount: 14, occurrenceDate: "2026-07-08" },
    ],
  );
  assert.equal(targets[0]?.id, "capital-one");
  assert.ok(targets[0]?.reasons.includes("Name strongly matches"));
});

test("split allocations must equal the single bank transaction", () => {
  const transaction = {
    amount: -390,
    review_allocations: [
      { type: "bill" as const, amount: 370 },
      { type: "category" as const, category: "Fees", amount: 20 },
    ],
  };
  assert.equal(allocationTotal(transaction.review_allocations), 390);
  assert.equal(reviewAllocationsAreBalanced(transaction), true);
  assert.equal(reviewAllocationsAreBalanced({ ...transaction, review_allocations: [{ type: "bill", amount: 370 }] }), false);
});

test("partial payments accumulate on one occurrence without closing another", () => {
  const matches = matchedOccurrenceAllocations([
    { id: "part-1", date: "2026-07-02", amount: -120, category: "Utilities", note: "Part 1", review_status: "matched", review_allocations: [
      { type: "bill", targetId: "utilities", occurrenceDate: "2026-07-02", amount: 120, plannedAmount: 370, settlement: "partial" },
    ] },
    { id: "part-2", date: "2026-07-05", amount: -250, category: "Utilities", note: "Part 2", review_status: "matched", review_allocations: [
      { type: "bill", targetId: "utilities", occurrenceDate: "2026-07-02", amount: 250, plannedAmount: 250, settlement: "exact" },
    ] },
    { id: "next-week", date: "2026-07-09", amount: -10, category: "Utilities", note: "Next", review_status: "matched", review_allocations: [
      { type: "bill", targetId: "utilities", occurrenceDate: "2026-07-09", amount: 10, plannedAmount: 370, settlement: "partial" },
    ] },
  ], "bill");

  const completed = matches.get(occurrenceKey("utilities", "2026-07-02"));
  const unrelated = matches.get(occurrenceKey("utilities", "2026-07-09"));
  assert.equal(completed?.amount, 370);
  assert.equal(completed?.plannedAmount, 370);
  assert.equal(completed?.settlement, "exact");
  assert.equal(unrelated?.amount, 10);
  assert.equal(unrelated?.settlement, "partial");
});

test("split reporting keeps one cash event but assigns both categories", () => {
  const parts = transactionCategoryParts({
    id: "split", date: "2026-07-02", amount: -390, category: "Utilities", note: "Utility plus fee", review_status: "matched",
    review_allocations: [
      { type: "bill", name: "Utilities", category: "Utilities", amount: 370 },
      { type: "category", category: "Fees", amount: 20 },
    ],
  });
  assert.deepEqual(parts.map(part => [part.category, part.amount]), [["Utilities", -370], ["Fees", -20]]);
  assert.equal(parts.reduce((sum, part) => sum + part.amount, 0), -390);
});

test("reviewed transfers do not affect spending categories", () => {
  assert.deepEqual(transactionCategoryParts({
    id: "transfer", date: "2026-07-03", amount: -500, category: "Transfer", note: "Move money", review_status: "transfer",
    review_allocations: [{ type: "transfer", amount: 500 }],
  }), []);
});
