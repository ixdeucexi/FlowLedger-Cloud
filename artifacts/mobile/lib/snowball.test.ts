import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { allocateSnowballExtra, effectiveDebtMinimum, monthlyDebtAmount, monthlyInterestCharge, orderDebts, projectSnowballMonth, scheduledDebtPaymentAmount, simulateSnowballPayoff, type SnowballDebtInput } from "./snowball";

const debts: SnowballDebtInput[] = [
  { id: "large", name: "Large", balance: 1_000, minimum: 100, apr: 12, dueDay: 15, included: true },
  { id: "small", name: "Small", balance: 100, minimum: 25, apr: 0, dueDay: 10, included: true },
  { id: "excluded", name: "Excluded", balance: 50, minimum: 10, apr: 30, dueDay: 1, included: false },
];

describe("debt ordering and allocation", () => {
  it("calculates monthly interest from APR without treating APR as a monthly rate", () => {
    assert.equal(monthlyInterestCharge(1_200, 24), 24);
    assert.equal(monthlyInterestCharge(1_000, 0), 0);
    assert.equal(monthlyInterestCharge(1_000, -5), 0);
  });

  it("adds a closed debt minimum to the new number one debt", () => {
    assert.equal(effectiveDebtMinimum(75, 25), 100);
  });
  it("starts a new rollover on unpaid months without reopening a settled month", () => {
    assert.equal(monthlyDebtAmount(20, 29), 49);
    assert.equal(monthlyDebtAmount(20, 29, 20), 20);
  });
  it("does not reduce debt until a scheduled transaction date arrives", () => {
    assert.equal(scheduledDebtPaymentAmount(-100, "2026-06-25", "2026-06-24", 500), 0);
    assert.equal(scheduledDebtPaymentAmount(-100, "2026-06-25", "2026-06-25", 500), 100);
    assert.equal(scheduledDebtPaymentAmount(-600, "2026-06-25", "2026-06-26", 500), 500);
  });
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

  it("targets the smallest active included balance first", () => {
    const active = debts.filter(debt => debt.included && debt.balance > 0);
    assert.deepEqual(orderDebts(active, "snowball").map(item => item.id), ["small", "large"]);
  });
});

describe("payoff simulation", () => {
  it("keeps paying minimum payments on all active debts", () => {
    const result = projectSnowballMonth({
      debts,
      method: "snowball",
      extraPayment: 0,
    });
    const byId = new Map(result.payments.map(payment => [payment.billId, payment]));
    assert.equal(byId.get("small")?.scheduledPayment, 25);
    assert.equal(byId.get("large")?.scheduledPayment, 100);
    assert.equal(byId.get("excluded")?.scheduledPayment, 10);
  });

  it("rolls a paid-off debt minimum into the next smallest debt next month", () => {
    const monthOne = projectSnowballMonth({
      debts: [
        { id: "small", name: "Small", balance: 25, minimum: 25, apr: 0, dueDay: 10, included: true },
        { id: "large", name: "Large", balance: 1_000, minimum: 100, apr: 0, dueDay: 15, included: true },
      ],
      method: "snowball",
    });
    assert.deepEqual(monthOne.paidOffNames, ["Small"]);
    assert.equal(monthOne.rolledPayment, 25);

    const monthTwo = projectSnowballMonth({
      debts: [
        { id: "small", name: "Small", balance: 0, minimum: 25, apr: 0, dueDay: 10, included: true },
        { id: "large", name: "Large", balance: 900, minimum: 100, apr: 0, dueDay: 15, included: true },
      ],
      method: "snowball",
      startingBalances: monthOne.balances,
      rolledPayment: monthOne.rolledPayment,
    });
    const largePayment = monthTwo.payments.find(payment => payment.billId === "large");
    assert.equal(largePayment?.scheduledPayment, 125);
    assert.equal(monthTwo.payments.some(payment => payment.billId === "small"), false);
  });

  it("pushes unused payoff amount into the next debt in the same month", () => {
    const result = projectSnowballMonth({
      debts: [
        { id: "small", name: "Small", balance: 10, minimum: 25, apr: 0, dueDay: 10, included: true },
        { id: "large", name: "Large", balance: 1_000, minimum: 100, apr: 0, dueDay: 15, included: true },
      ],
      method: "snowball",
    });
    const byId = new Map(result.payments.map(payment => [payment.billId, payment]));
    assert.equal(byId.get("small")?.scheduledPayment, 10);
    assert.equal(byId.get("large")?.scheduledPayment, 115);
    assert.equal(result.scheduledPayments, 125);
  });

  it("exposes scheduled payments for forecast and calendar projections", () => {
    const monthOne = projectSnowballMonth({
      debts: [
        { id: "camera", name: "Camera", balance: 20, minimum: 20, apr: 0, dueDay: 4, included: true },
        { id: "concert", name: "Concert", balance: 400, minimum: 35, apr: 0, dueDay: 29, included: true },
      ],
      method: "snowball",
      extraPayment: 20,
    });
    assert.equal(monthOne.balances.get("camera"), 0);
    assert.equal(monthOne.balances.get("concert"), 345);

    const monthTwo = projectSnowballMonth({
      debts: [
        { id: "camera", name: "Camera", balance: 0, minimum: 20, apr: 0, dueDay: 4, included: true },
        { id: "concert", name: "Concert", balance: 395, minimum: 35, apr: 0, dueDay: 29, included: true },
      ],
      method: "snowball",
      startingBalances: monthOne.balances,
      rolledPayment: monthOne.rolledPayment,
    });
    const byId = new Map(monthTwo.payments.map(payment => [payment.billId, payment]));
    assert.equal(byId.has("camera"), false);
    assert.equal(byId.get("concert")?.scheduledPayment, 55);
  });

  it("carries current-month payoff minimums into future simulation", () => {
    const first = allocateSnowballExtra([
      { id: "small", name: "Small", balance: 20, minimum: 20, apr: 0, dueDay: 4, included: true },
      { id: "large", name: "Large", balance: 200, minimum: 50, apr: 0, dueDay: 15, included: true },
    ], 20, "snowball", "2026-06-04");
    const result = simulateSnowballPayoff({
      debts: [
        { id: "small", name: "Small", balance: 20, minimum: 20, apr: 0, dueDay: 4, included: true },
        { id: "large", name: "Large", balance: 200, minimum: 50, apr: 0, dueDay: 15, included: true },
      ],
      method: "snowball",
      startMonth: 5,
      startYear: 2026,
      firstMonthBalances: first.balances,
      firstPayoffOrder: first.payoffOrder,
      initialRolledPayment: 20,
      getExtraForMonth: () => ({ extra: 0, lowestBalance: 200 }),
    });
    assert.equal(result.months[0].minimumPayments, 50);
    assert.equal(result.months[0].rolledPayment, 20);
    assert.equal(result.months[0].endingDebt, 130);
  });

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
