import assert from "node:assert/strict";
import test from "node:test";

import {
  pendingChargeTransactionDraft,
  pendingDraftStaysInChargeMonth,
} from "./pendingTransactionDraft";

test("a pending charge pre-fills one manual expense transaction", () => {
  assert.deepEqual(
    pendingChargeTransactionDraft(
      {
        plaid_transaction_id: "pending-1",
        transaction_date: "2026-09-20",
        amount: -47.83,
        name: "CARD PURCHASE",
        merchant_name: "Neighborhood Market",
        category: "Food",
      },
      ["Food", "Other"],
    ),
    {
      amount: -47.83,
      category: "Food",
      note: "Neighborhood Market",
      date: "2026-09-20",
    },
  );
});

test("an unknown bank category falls back to a real app category", () => {
  const draft = pendingChargeTransactionDraft(
    {
      plaid_transaction_id: "pending-2",
      transaction_date: "2026-09-21",
      amount: -12,
      name: "COFFEE SHOP",
      category: "FOOD_AND_DRINK",
    },
    ["Food", "Other"],
  );
  assert.equal(draft.category, "Other");
  assert.equal(draft.note, "COFFEE SHOP");
});

test("a created pending transaction must remain in the pending charge month", () => {
  assert.equal(
    pendingDraftStaysInChargeMonth("2026-09-30", "2026-09-01"),
    true,
  );
  assert.equal(
    pendingDraftStaysInChargeMonth("2026-09-30", "2026-10-01"),
    false,
  );
  assert.equal(pendingDraftStaysInChargeMonth("invalid", "2026-09-01"), false);
});
