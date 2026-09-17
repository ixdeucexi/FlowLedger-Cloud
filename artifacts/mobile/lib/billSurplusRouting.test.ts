import assert from "node:assert/strict";
import test from "node:test";

import { nextPlannedDebtPayment } from "./billSurplusRouting";
import type { DatedDebtAllocation } from "./snowball";

function allocation(
  id: string,
  date: string,
  kind: DatedDebtAllocation["kind"],
  targetBillId = "concert",
  amount = 35.41,
): DatedDebtAllocation {
  return {
    id,
    date,
    kind,
    targetBillId,
    targetBillName: targetBillId === "concert" ? "Concert" : "Discover",
    amount,
    sourceAmount: amount,
    balanceBefore: 319,
    balanceAfter: 319 - amount,
    paidOff: false,
  };
}

test("bill surplus uses the full amount already planned on the target debt's next date", () => {
  const result = nextPlannedDebtPayment([
    allocation("past", "2026-08-11", "required"),
    allocation("other-date-extra", "2026-08-20", "extra", "concert", 5),
    allocation("other-debt", "2026-08-22", "required", "discover", 113),
    allocation("next-required", "2026-08-29", "required", "concert", 35.41),
    allocation("same-day-rollover", "2026-08-29", "rollover", "concert", 67.59),
    allocation("same-day-extra", "2026-08-29", "extra", "concert", 9.11),
  ], "concert", "2026-08-13");

  assert.deepEqual(result, {
    amount: 112.11,
    date: "2026-08-29",
    debtId: "concert",
    debtName: "Concert",
  });
});

test("bill surplus can use an existing saved extra date when no canonical date remains", () => {
  assert.deepEqual(nextPlannedDebtPayment([
    allocation("saved-extra", "2026-08-29", "extra", "concert", 9.11),
  ], "concert", "2026-08-13"), {
    amount: 9.11,
    date: "2026-08-29",
    debtId: "concert",
    debtName: "Concert",
  });
});

test("bill surplus routing fails closed when no later payment exists", () => {
  assert.equal(nextPlannedDebtPayment([
    allocation("past-extra", "2026-08-12", "extra", "concert", 9.11),
  ], "concert", "2026-08-13"), undefined);
  assert.equal(nextPlannedDebtPayment([], undefined, "2026-08-13"), undefined);
});
