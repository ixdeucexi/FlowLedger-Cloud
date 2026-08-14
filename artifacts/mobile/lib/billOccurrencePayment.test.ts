import assert from "node:assert/strict";
import test from "node:test";

import { resolveBillOccurrencePayment } from "./billOccurrencePayment";

test("a paid weekly total only settles its exact occurrence date", () => {
  const common = {
    scheduledAmount: 150,
    frequency: "weekly",
    monthlyPaidAmount: 300,
    monthlyPaidDate: "2026-08-12",
  };

  assert.deepEqual(resolveBillOccurrencePayment({ ...common, occurrenceDate: "2026-08-12" }), {
    scheduledAmount: 150,
    paidAmount: 150,
    remainingAmount: 0,
    isPaid: true,
    isPartial: false,
  });
  assert.deepEqual(resolveBillOccurrencePayment({ ...common, occurrenceDate: "2026-08-26" }), {
    scheduledAmount: 150,
    paidAmount: 0,
    remainingAmount: 150,
    isPaid: false,
    isPartial: false,
  });
});
test("an exact reviewed match settles only the matching weekly occurrence", () => {
  const paid = resolveBillOccurrencePayment({
    occurrenceDate: "2026-08-12",
    scheduledAmount: 150,
    frequency: "weekly",
    match: { amount: 150, plannedAmount: 150, settlement: "exact" },
  });
  const future = resolveBillOccurrencePayment({
    occurrenceDate: "2026-08-26",
    scheduledAmount: 150,
    frequency: "weekly",
  });

  assert.equal(paid.isPaid, true);
  assert.equal(future.isPaid, false);
  assert.equal(future.remainingAmount, 150);
});

test("partial matches remain partial for every supported schedule", () => {
  for (const frequency of ["monthly", "biweekly", "weekly", "quarterly"]) {
    const view = resolveBillOccurrencePayment({
      occurrenceDate: "2026-08-26",
      scheduledAmount: 150,
      frequency,
      match: { amount: 60, plannedAmount: 150, settlement: "partial" },
    });
    assert.equal(view.paidAmount, 60, frequency);
    assert.equal(view.remainingAmount, 90, frequency);
    assert.equal(view.isPaid, false, frequency);
    assert.equal(view.isPartial, true, frequency);
  }
});
