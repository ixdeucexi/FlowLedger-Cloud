import assert from "node:assert/strict";
import test from "node:test";

import {
  debtSyncRefreshPlan,
  debtSyncRequiresRefresh,
  MAX_PARTIAL_DEBT_SYNC_IDS,
  replaceRowsById,
  rowsExactlyMatchRequestedIds,
} from "./debtSyncResult";

const unchanged = {
  changed: false,
  changed_transaction_ids: [],
  changed_bill_ids: [],
};
const changed = {
  changed: true,
  changed_transaction_ids: ["transaction-1"],
  changed_bill_ids: ["bill-1"],
};

test("parses direct and validated wrapped JSONB debt-sync results", () => {
  assert.deepEqual(debtSyncRefreshPlan(unchanged), {
    mode: "none",
    transactionIds: [],
    billIds: [],
  });
  assert.deepEqual(debtSyncRefreshPlan(changed), {
    mode: "partial",
    transactionIds: ["transaction-1"],
    billIds: ["bill-1"],
  });
  assert.deepEqual(debtSyncRefreshPlan(JSON.stringify(changed)), {
    mode: "partial",
    transactionIds: ["transaction-1"],
    billIds: ["bill-1"],
  });
  assert.deepEqual(debtSyncRefreshPlan([unchanged]), {
    mode: "none",
    transactionIds: [],
    billIds: [],
  });
  assert.equal(debtSyncRequiresRefresh(unchanged), false);
  assert.equal(debtSyncRequiresRefresh(changed), true);
});

test("malformed, inconsistent, and oversized results fail safe to a full refresh", () => {
  const malformed: unknown[] = [
    null,
    undefined,
    {},
    { changed: "false" },
    { changed: false, changed_transaction_ids: [] },
    {
      changed: false,
      changed_transaction_ids: [],
      changed_bill_ids: ["unexpected-bill"],
    },
    {
      changed: false,
      changed_transaction_ids: ["unexpected-transaction"],
      changed_bill_ids: [],
    },
    {
      changed: true,
      changed_transaction_ids: [],
      changed_bill_ids: [],
    },
    { ...changed, changed_transaction_ids: ["duplicate", "duplicate"] },
    { ...changed, changed_transaction_ids: ["  padded"] },
    [unchanged, unchanged],
    "not-json",
    {
      changed: true,
      changed_transaction_ids: Array.from(
        { length: MAX_PARTIAL_DEBT_SYNC_IDS + 1 },
        (_, index) => `tx-${index}`,
      ),
      changed_bill_ids: [],
    },
  ];
  malformed.forEach(value => {
    assert.equal(debtSyncRefreshPlan(value).mode, "full");
    assert.equal(debtSyncRequiresRefresh(value), true);
  });
});

test("exact-row validation rejects missing, unexpected, and duplicate responses", () => {
  assert.equal(rowsExactlyMatchRequestedIds([{ id: "a" }, { id: "b" }], ["a", "b"]), true);
  assert.equal(rowsExactlyMatchRequestedIds([{ id: "a" }], ["a", "b"]), false);
  assert.equal(rowsExactlyMatchRequestedIds([{ id: "a" }, { id: "c" }], ["a", "b"]), false);
  assert.equal(rowsExactlyMatchRequestedIds([{ id: "a" }, { id: "a" }], ["a", "b"]), false);
});

test("exact-row merge replaces, removes from the old collection, and adds new rows once", () => {
  const current = [
    { id: "keep", value: 1 },
    { id: "move", value: 2 },
    { id: "replace", value: 3 },
  ];
  const replacements = [
    { id: "replace", value: 30 },
    { id: "new", value: 4 },
  ];
  assert.deepEqual(
    replaceRowsById(current, ["move", "replace", "new"], replacements),
    [
      { id: "keep", value: 1 },
      { id: "replace", value: 30 },
      { id: "new", value: 4 },
    ],
  );
});
