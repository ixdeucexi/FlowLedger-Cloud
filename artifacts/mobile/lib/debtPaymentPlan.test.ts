import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDebtPaymentPlanSummary,
  isSnowballPaymentTransaction,
  replacementSnowballSafeMaximum,
  snowballPaymentName,
  snowballTransactionEditDraft,
} from "./debtPaymentPlan";

describe("extra debt payment plan", () => {
  it("keeps the required minimum separate from the optional extra", () => {
    assert.deepEqual(buildDebtPaymentPlanSummary(67.27, 93.73), {
      requiredMinimum: 67.27,
      extraPayment: 93.73,
      totalPlanned: 161,
    });
  });

  it("never creates a negative minimum or extra payment", () => {
    assert.deepEqual(buildDebtPaymentPlanSummary(-20, -10), {
      requiredMinimum: 0,
      extraPayment: 0,
      totalPlanned: 0,
    });
  });
});

describe("snowball transaction recognition", () => {
  it("recognizes an imported debt-surplus payment", () => {
    const transaction = {
      amount: -30,
      date: "2026-07-23",
      category: "Debt",
      note: "Camera snowball",
      import_hash: "flowledger:debt-surplus:discover:2026-07",
      linked_bill_id: "camera",
      debt_applied_bill_id: "camera",
    };

    assert.equal(isSnowballPaymentTransaction(transaction), true);
    assert.equal(snowballPaymentName(transaction), "Camera");
    assert.deepEqual(snowballTransactionEditDraft(transaction), {
      amount: 30,
      debtId: "camera",
      paymentDate: "2026-07-23",
    });
  });

  it("does not turn an ordinary debt payment into a snowball card", () => {
    assert.equal(isSnowballPaymentTransaction({
      amount: -83,
      category: "Debt",
      note: "Discover",
      linked_bill_id: "discover",
    }), false);
  });

  it("rejects money coming in even when the note says snowball", () => {
    assert.equal(isSnowballPaymentTransaction({
      amount: 30,
      category: "Debt",
      note: "Camera snowball",
      linked_bill_id: "camera",
    }), false);
  });

  it("adds the existing payment back when calculating an editable safe maximum", () => {
    assert.equal(replacementSnowballSafeMaximum(849.02, 30), 879.02);
  });
});
