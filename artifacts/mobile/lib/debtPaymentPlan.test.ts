import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDebtPaymentPlanSummary } from "./debtPaymentPlan";

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
