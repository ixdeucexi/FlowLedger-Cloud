import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDebtPaymentPlanSummary,
  isScheduledSnowballPlanTransaction,
  isSnowballPaymentTransaction,
  replacementSnowballSafeMaximum,
  requiredDebtPlanTotal,
  SNOWBALL_PLAN_SOURCE,
  snowballPaymentName,
  snowballPlanTotalThroughDate,
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

  it("recognizes a bank transaction matched to a Snowball plan", () => {
    assert.equal(isSnowballPaymentTransaction({
      amount: -12.48,
      category: "Debt",
      note: "Affirm",
      review_resolution: "snowball",
    }), true);
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

  it("does not turn a snowball rollover into a required minimum", () => {
    assert.equal(requiredDebtPlanTotal({
      amount: 38.27,
      snowball_minimum_boost: 29,
    }), 38.27);
  });

  it("keeps scheduled plan transactions separate from paid debt", () => {
    assert.equal(isScheduledSnowballPlanTransaction({
      amount: -30,
      source: SNOWBALL_PLAN_SOURCE,
      linked_bill_id: "camera",
    }), true);
  });

  it("shows the cumulative snowball plan through each date in the month", () => {
    const plans = [
      { amount: 12.48, date: "2026-07-22" },
      { amount: -30, date: "2026-07-24" },
      { amount: 10, date: "2026-08-01" },
    ];
    assert.equal(snowballPlanTotalThroughDate(plans, "2026-07-22"), 12.48);
    assert.equal(snowballPlanTotalThroughDate(plans, "2026-07-24"), 42.48);
    assert.equal(buildDebtPaymentPlanSummary(
      38.27,
      snowballPlanTotalThroughDate(plans, "2026-07-22"),
    ).totalPlanned, 50.75);
    assert.equal(buildDebtPaymentPlanSummary(
      38.27,
      snowballPlanTotalThroughDate(plans, "2026-07-24"),
    ).totalPlanned, 80.75);
    assert.equal(snowballPlanTotalThroughDate(plans, "not-a-date"), 0);
  });
});
