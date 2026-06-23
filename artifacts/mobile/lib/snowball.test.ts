import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { allocateSnowballExtra, orderDebts, simulateSnowballPayoff, type SnowballDebtInput } from "./snowball";

const debts: SnowballDebtInput[] = [
  { id: "large", name: "Large", balance: 1_000, minimum: 100, apr: 12, dueDay: 15, included: true },
  { id: "small", name: "Small", balance: 100, minimum: 25, apr: 0, dueDay: 10, included: true },
  { id: "excluded", name: "Excluded", balance: 50, minimum: 10, apr: 30, dueDay: 1, included: false },
];

describe("debt ordering and allocation", () => {
  it("orders snowball and avalanche deterministically", () => {
    assert.deepEqual(orderDebts(debts, "snowball").map(item => item.id), ["excluded", "small", "large"]);
    assert.deepEqual(orderDebts(debts, "avalanche").map(item => item.id), ["excluded", "large", "small"]);
  });

  it("cascades overflow and never allocates extra to excluded debt", () => {
    const result = allocateSnowballExtra(debts, 150, "snowball", "2026-06-10");
    assert.deepEqual(result.allocations.map(item => [item.billId, item.payment]), [["small", 100], ["large", 50]]);
    assert.equal(result.balances.get("excluded"), 50);
    assert.deepEqual(result.payoffOrder, ["Small"]);
  });
});

describe("payoff simulation", () => {
  it("applies monthly interest, minimums and rolled payments", () => {
    const first = allocateSnowballExtra(debts, 0, "snowball", "2026-06-10");
    const result = simulateSnowballPayoff({
      debts,
      method: "snowball",
      startMonth: 5,
      startYear: 2026,
      firstMonthBalances: first.balances,
      firstPayoffOrder: first.payoffOrder,
      getExtraForMonth: () => ({ extra: 0, lowestBalance: 200 }),
    });
    assert.equal(result.months[0].interest, 11.25);
    assert.equal(result.months[0].endingDebt, 985);
    assert.ok(result.months.some(month => month.rolledPayment >= 25));
    assert.equal(result.payoffOrder[0], "Small");
  });

  it("handles zero included debts without creating a payoff date", () => {
    const excluded = debts.map(item => ({ ...item, included: false }));
    const balances = new Map(excluded.map(item => [item.id, item.balance]));
    const result = simulateSnowballPayoff({
      debts: excluded,
      method: "snowball",
      startMonth: 5,
      startYear: 2026,
      firstMonthBalances: balances,
      getExtraForMonth: () => ({ extra: 0, lowestBalance: 200 }),
    });
    assert.equal(result.months[0].endingDebt, 0);
    assert.equal(result.debtFreeDate, "2026-07");
  });
});
