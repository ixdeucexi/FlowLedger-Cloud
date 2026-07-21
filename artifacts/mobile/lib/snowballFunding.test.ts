import assert from "node:assert/strict";
import test from "node:test";

import { resizeSnowballFundingSources } from "./snowballFunding";

test("reducing a routed snowball payment releases the unused bill surplus", () => {
  const resized = resizeSnowballFundingSources([
    { type: "bill_surplus" as const, amount: 12.48, billId: "insurance", billName: "Car Insurance" },
  ], 10);

  assert.deepEqual(resized, [
    { type: "bill_surplus", amount: 10, billId: "insurance", billName: "Car Insurance" },
  ]);
});

test("increasing a routed payment preserves its surplus and adds manual extra", () => {
  const resized = resizeSnowballFundingSources([
    { type: "bill_surplus" as const, amount: 12.48, billId: "insurance" },
  ], 20);

  assert.deepEqual(resized, [
    { type: "bill_surplus", amount: 12.48, billId: "insurance" },
    { type: "manual", amount: 7.52 },
  ]);
});

test("funding amounts always equal the edited payment to the cent", () => {
  const resized = resizeSnowballFundingSources([
    { type: "manual" as const, amount: 5.555 },
    { type: "bill_surplus" as const, amount: 4.445, billId: "bill" },
  ], 8.01);

  assert.equal(resized.reduce((sum, source) => sum + source.amount, 0), 8.01);
});
