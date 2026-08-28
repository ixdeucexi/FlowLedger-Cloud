import assert from "node:assert/strict";
import test from "node:test";

import { debtSyncRequiresRefresh } from "./debtSyncResult";

test("skips the post-sync ledger read only for an explicit unchanged result", () => {
  assert.equal(debtSyncRequiresRefresh({
    changed: false,
    changed_transaction_ids: [],
    changed_bill_ids: [],
  }), false);
  assert.equal(debtSyncRequiresRefresh({
    changed: true,
    changed_transaction_ids: ["transaction-1"],
    changed_bill_ids: ["bill-1"],
  }), true);
});

test("old, malformed, or missing RPC results fail safe to a refresh", () => {
  assert.equal(debtSyncRequiresRefresh(null), true);
  assert.equal(debtSyncRequiresRefresh(undefined), true);
  assert.equal(debtSyncRequiresRefresh({}), true);
  assert.equal(debtSyncRequiresRefresh({ changed: "false" }), true);
  assert.equal(debtSyncRequiresRefresh({
    changed: false,
    changed_transaction_ids: [],
  }), true);
  assert.equal(debtSyncRequiresRefresh({
    changed: false,
    changed_transaction_ids: [],
    changed_bill_ids: ["unexpected-bill"],
  }), true);
  assert.equal(debtSyncRequiresRefresh({
    changed: false,
    changed_transaction_ids: ["unexpected-transaction"],
    changed_bill_ids: [],
  }), true);
});
