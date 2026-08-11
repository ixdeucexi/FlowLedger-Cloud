import assert from "node:assert/strict";
import test from "node:test";

import { buildSnowballPlannerRows, buildSnowballTimeline, payoffMonthsSooner, snowballPlanHistoryStatus } from "./snowballPlanner";
import type { DatedSnowballMonthPlanResult } from "./snowball";

const plan: DatedSnowballMonthPlanResult = {
  payments: [
    { billId: "camera", billName: "Camera", dueDay: 11, scheduledPayment: 45, extraPayment: 0, totalPayment: 45, balanceBefore: 45, balanceAfter: 0, paidOff: true },
    { billId: "concert", billName: "Concert", dueDay: 29, scheduledPayment: 93, extraPayment: 20, totalPayment: 113, balanceBefore: 319, balanceAfter: 206, paidOff: false },
  ],
  balances: new Map([["camera", 0], ["concert", 206]]),
  payoffOrder: ["Camera"],
  paidOffNames: ["Camera"],
  rolledPayment: 58,
  minimumPayments: 138,
  scheduledPayments: 138,
  extraPayment: 20,
  interest: 0,
  endingDebt: 206,
  plannedPayment: 158,
  unusedAmount: 0,
  allocations: [
    { id: "required-camera", date: "2026-08-11", sourceBillId: "camera", sourceBillName: "Camera", targetBillId: "camera", targetBillName: "Camera", kind: "required", amount: 45, sourceAmount: 103, balanceBefore: 45, balanceAfter: 0, paidOff: true },
    { id: "rollover-concert", date: "2026-08-11", sourceBillId: "camera", sourceBillName: "Camera", targetBillId: "concert", targetBillName: "Concert", kind: "rollover", amount: 58, sourceAmount: 103, balanceBefore: 319, balanceAfter: 261, paidOff: false },
    { id: "extra-concert", date: "2026-08-15", targetBillId: "concert", targetBillName: "Concert", kind: "extra", amount: 20, sourceAmount: 20, balanceBefore: 261, balanceAfter: 241, paidOff: false },
    { id: "required-concert", date: "2026-08-29", sourceBillId: "concert", sourceBillName: "Concert", targetBillId: "concert", targetBillName: "Concert", kind: "required", amount: 35, sourceAmount: 35, balanceBefore: 241, balanceAfter: 206, paidOff: false },
  ],
};

test("planner rows use the canonical dated payment and rollover amounts", () => {
  const remainingPlan: DatedSnowballMonthPlanResult = {
    ...plan,
    plannedPayment: 55,
    allocations: plan.allocations.slice(2),
  };
  const fullPlan: DatedSnowballMonthPlanResult = {
    ...plan,
    payments: [
      ...plan.payments,
      { billId: "excluded", billName: "Excluded", dueDay: 3, scheduledPayment: 50, extraPayment: 0, totalPayment: 50, balanceBefore: 500, balanceAfter: 450, paidOff: false },
    ],
    balances: new Map([...plan.balances, ["excluded", 450]]),
  };
  const rows = buildSnowballPlannerRows([
    { id: "concert", name: "Concert", balance: 319, minimum: 35, apr: 0, dueDay: 29, included: true },
    { id: "camera", name: "Camera", balance: 45, minimum: 103, apr: 0, dueDay: 11, included: true },
    { id: "closed", name: "Closed", balance: 0, minimum: 10, apr: 20, dueDay: 1, included: true },
    { id: "excluded", name: "Excluded", balance: 500, minimum: 50, apr: 20, dueDay: 3, included: false },
  ], "snowball", remainingPlan, fullPlan);

  assert.deepEqual(rows.map(row => row.name), ["Camera", "Concert"]);
  assert.equal(rows[0]?.balance, 45);
  assert.equal(rows[0]?.forecastPayment, 103);
  assert.equal(rows[0]?.plannedToDebt, 45);
  assert.equal(rows[0]?.paidOffThisMonth, true);
  assert.equal(rows[0]?.rolloverSent, 58);
  assert.equal(rows[1]?.rolloverReceived, 58);
  assert.equal(rows[1]?.extraReceived, 20);
  assert.equal(rows[1]?.forecastPayment, 35);
  assert.equal(rows[1]?.plannedToDebt, 113);
  assert.equal(rows[1]?.balanceAfter, 206);
});

test("future planner rows use canonical selected-month starting balances and omit prior-paid debts", () => {
  const rows = buildSnowballPlannerRows([
    { id: "camera", name: "Camera", balance: 900, minimum: 103, apr: 0, dueDay: 11, included: true },
    { id: "concert", name: "Concert", balance: 319, minimum: 35, apr: 0, dueDay: 29, included: true },
    { id: "paid-earlier", name: "Paid earlier", balance: 25, minimum: 10, apr: 0, dueDay: 1, included: true },
  ], "snowball", plan, plan);

  assert.deepEqual(rows.map(row => row.id), ["camera", "concert"]);
  assert.equal(rows[0]?.balance, 45);
});

test("timeline groups same-day payoff and rollover together", () => {
  const sameDayInCanonicalOrder = [
    { ...plan.allocations[0]!, id: "z-required" },
    { ...plan.allocations[1]!, id: "a-rollover" },
    ...plan.allocations.slice(2),
  ];
  const timeline = buildSnowballTimeline(sameDayInCanonicalOrder);
  assert.deepEqual(timeline.map(group => group.date), ["2026-08-11", "2026-08-15", "2026-08-29"]);
  assert.equal(timeline[0]?.total, 103);
  assert.deepEqual(timeline[0]?.allocations.map(item => item.kind), ["required", "rollover"]);
});

test("rollover events keep each canonical payment date", () => {
  const weeklyPlan: DatedSnowballMonthPlanResult = {
    ...plan,
    allocations: [
      plan.allocations[0]!,
      plan.allocations[1]!,
      { ...plan.allocations[1]!, id: "rollover-week-two", date: "2026-08-18", amount: 12, sourceAmount: 12 },
    ],
  };
  const rows = buildSnowballPlannerRows([
    { id: "camera", name: "Camera", balance: 45, minimum: 103, apr: 0, dueDay: 11, included: true },
    { id: "concert", name: "Concert", balance: 319, minimum: 35, apr: 0, dueDay: 29, included: true },
  ], "snowball", weeklyPlan, weeklyPlan);

  assert.deepEqual(rows[0]?.rolloverEvents.map(event => event.date), ["2026-08-11", "2026-08-18"]);
});

test("payoff impact reports whole months sooner and rejects unknown projections", () => {
  assert.equal(payoffMonthsSooner("2027-09", "2027-04"), 5);
  assert.equal(payoffMonthsSooner("2027-04", "2027-09"), -5);
  assert.equal(payoffMonthsSooner("2027-04", "2027-04"), 0);
  assert.equal(payoffMonthsSooner(null, "2027-04"), null);
  assert.equal(payoffMonthsSooner("bad", "2027-04"), null);
});

test("saved-plan history status follows pending and matched allocation state", () => {
  const saved = {
    month: 7,
    year: 2026,
    payment_date: "2026-08-15",
    allocations: [{ billId: "concert", payment: 20, paymentDate: "2026-08-15" }],
    sources: [{ pendingBalanceApply: true }],
  };
  assert.equal(snowballPlanHistoryStatus(saved, new Map(), "2026-08-10"), "Scheduled");
  assert.equal(snowballPlanHistoryStatus({ ...saved, payment_date: "2026-08-09" }, new Map(), "2026-08-10"), "Awaiting match");
  assert.equal(snowballPlanHistoryStatus(saved, new Map([["concert:2026-08-15", { amount: 8 }]]), "2026-08-10"), "Partially paid");
  assert.equal(snowballPlanHistoryStatus(saved, new Map([["concert:2026-08-15", { amount: 20 }]]), "2026-08-10"), "Applied");
  assert.equal(snowballPlanHistoryStatus({ ...saved, payment_date: "2026-08-09", sources: [{ pendingBalanceApply: false }] }, new Map(), "2026-08-10"), "Applied");
  assert.equal(snowballPlanHistoryStatus({ ...saved, sources: undefined }, new Map(), "2026-08-10"), "Scheduled");
});
