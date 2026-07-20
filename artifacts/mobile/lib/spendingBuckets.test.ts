import assert from "node:assert/strict";
import test from "node:test";

import { isOpenSpendingBucket, spendingBucketSummary } from "./spendingBuckets";

test("an open spending bucket protects only its unmatched balance", () => {
  assert.deepEqual(spendingBucketSummary({ target_amount: 450, current_amount: 101.08 }), {
    planned: 450,
    spent: 101.08,
    remaining: 348.92,
    released: 0,
    closed: false,
  });
  assert.equal(isOpenSpendingBucket({ target_amount: 450, current_amount: 101.08 }), true);
});

test("closing releases unused money without rewriting planned or spent amounts", () => {
  const bucket = { target_amount: 450, current_amount: 101.08, closed_at: "2026-07-20T12:00:00.000Z" };
  assert.deepEqual(spendingBucketSummary(bucket), {
    planned: 450,
    spent: 101.08,
    remaining: 0,
    released: 348.92,
    closed: true,
  });
  assert.equal(isOpenSpendingBucket(bucket), false);
});

test("closing an over-budget bucket never creates negative released money", () => {
  assert.deepEqual(spendingBucketSummary({ target_amount: 100, current_amount: 125, closed_at: "2026-07-20" }), {
    planned: 100,
    spent: 125,
    remaining: 0,
    released: 0,
    closed: true,
  });
});
