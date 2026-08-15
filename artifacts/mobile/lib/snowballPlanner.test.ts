import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { buildSnowballPlannerRows, buildSnowballTimeline, payoffMonthsSooner, snowballPlanHistoryStatus } from "./snowballPlanner";
import { projectDatedSnowballMonth, remainingDatedDebtAllocations, type DatedSnowballMonthPlanResult } from "./snowball";

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
  assert.equal(rows[0]?.forecastPayment, 0);
  assert.equal(rows[0]?.plannedToDebt, 0);
  assert.equal(rows[0]?.paidOffThisMonth, false);
  assert.equal(rows[0]?.rolloverSent, 0);
  assert.equal(rows[1]?.rolloverReceived, 0);
  assert.equal(rows[1]?.extraReceived, 20);
  assert.equal(rows[1]?.forecastPayment, 35);
  assert.equal(rows[1]?.plannedToDebt, 55);
  assert.equal(rows[1]?.balanceAfter, 264);
});

test("planner keeps one parent source outflow when a required payment rolls over on the same date", () => {
  const generatedPlan = projectDatedSnowballMonth({
    debts: [
      { id: "camera", name: "Camera", balance: 42.81, minimum: 103, apr: 0, dueDay: 11, included: true },
      { id: "concert", name: "Concert", balance: 319, minimum: 35, apr: 0, dueDay: 29, included: true },
    ],
    method: "snowball",
    month: 7,
    year: 2026,
    paymentDatesByDebtId: new Map([
      ["camera", ["2026-08-11"]],
      ["concert", ["2026-08-29"]],
    ]),
  });
  const rows = buildSnowballPlannerRows([
    { id: "camera", name: "Camera", balance: 42.81, minimum: 103, apr: 0, dueDay: 11, included: true },
    { id: "concert", name: "Concert", balance: 319, minimum: 35, apr: 0, dueDay: 29, included: true },
  ], "snowball", generatedPlan, generatedPlan);
  const byId = new Map(rows.map(row => [row.id, row]));

  assert.equal(byId.get("camera")?.forecastPayment, 103);
  assert.equal(byId.get("camera")?.plannedToDebt, 42.81);
  assert.equal(byId.get("concert")?.rolloverReceived, 60.19);
  assert.deepEqual(byId.get("camera")?.rolloverEvents, [{ date: "2026-08-11", amount: 60.19, targets: ["Concert"] }]);

  const remainingAfterFifty = {
    ...generatedPlan,
    allocations: remainingDatedDebtAllocations(generatedPlan.allocations, [
      { sourceType: "bill", billId: "camera", date: "2026-08-11", amount: 50 },
    ]),
  };
  const partialRows = buildSnowballPlannerRows([
    { id: "camera", name: "Camera", balance: 42.81, minimum: 103, apr: 0, dueDay: 11, included: true },
    { id: "concert", name: "Concert", balance: 319, minimum: 35, apr: 0, dueDay: 29, included: true },
  ], "snowball", remainingAfterFifty, generatedPlan);
  const partialById = new Map(partialRows.map(row => [row.id, row]));

  assert.equal(partialById.get("camera")?.forecastPayment, 53);
  assert.equal(partialById.get("camera")?.plannedToDebt, 0);
  assert.equal(partialById.get("concert")?.rolloverReceived, 53);
});

test("planner rows distinguish settled, partial, and genuinely unscheduled debt amounts", () => {
  const fullPlan: DatedSnowballMonthPlanResult = {
    ...plan,
    payments: [
      { billId: "partial", billName: "Partial", dueDay: 10, scheduledPayment: 127, extraPayment: 0, totalPayment: 127, balanceBefore: 500, balanceAfter: 373, paidOff: false },
    ],
    balances: new Map([["settled", 700], ["partial", 373], ["unscheduled", 900]]),
    allocations: [
      { id: "partial-full", date: "2026-08-10", sourceBillId: "partial", sourceBillName: "Partial", targetBillId: "partial", targetBillName: "Partial", kind: "required", amount: 127, sourceAmount: 127, balanceBefore: 500, balanceAfter: 373, paidOff: false },
    ],
  };
  const remainingPlan: DatedSnowballMonthPlanResult = {
    ...fullPlan,
    plannedPayment: 77,
    allocations: [{ ...fullPlan.allocations[0]!, id: "partial-remaining", amount: 77, sourceAmount: 77 }],
  };
  const settlements = new Map([
    ["settled", { configuredObligation: 73, paidAmount: 73, remainingRequired: 0, status: "settled" as const }],
    ["partial", { configuredObligation: 127, paidAmount: 50, remainingRequired: 77, status: "partial" as const }],
    ["unscheduled", { configuredObligation: 450.08, paidAmount: 0, remainingRequired: 450.08, status: "scheduled" as const }],
  ]);
  const rows = buildSnowballPlannerRows([
    { id: "settled", name: "Tia", balance: 700, minimum: 73, apr: 10, dueDay: 1, included: true },
    { id: "partial", name: "John Capital One 2", balance: 500, minimum: 127, apr: 12, dueDay: 10, included: true },
    { id: "unscheduled", name: "Upgrade", balance: 900, minimum: 450.08, apr: 14, dueDay: 20, included: true },
  ], "snowball", remainingPlan, fullPlan, settlements);

  const byId = new Map(rows.map(row => [row.id, row]));
  assert.deepEqual(byId.get("settled")?.settlement, settlements.get("settled"));
  assert.equal(byId.get("settled")?.plannedToDebt, 0);
  assert.equal(byId.get("partial")?.settlement.paidAmount, 50);
  assert.equal(byId.get("partial")?.plannedToDebt, 77);
  assert.equal(byId.get("partial")?.balanceAfter, 423);
  assert.equal(byId.get("unscheduled")?.settlement.status, "scheduled");
  assert.equal(byId.get("unscheduled")?.plannedToDebt, 0);
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

test("the extra payment money field removes the browser's internal focus outline", () => {
  const source = readFileSync("app/snowball-plan.tsx", "utf8");
  assert.doesNotMatch(source, /caretHidden/);
  assert.match(source, /paddingLeft: 3, paddingRight: 14/);
  assert.match(source, /outlineStyle: "none" as never/);
});

test("the extra payment editor keeps only a compact payoff date below its fields", () => {
  const source = readFileSync("app/snowball-plan.tsx", "utf8");
  assert.match(source, /style=\{styles\.payoffDateLine\}/);
  assert.match(source, />PROJECTED PAYOFF</);
  assert.doesNotMatch(source, />PAYOFF IMPACT</);
  assert.doesNotMatch(source, />Scheduled Forecast</);
  assert.doesNotMatch(source, />Safe extra plan</);
  assert.doesNotMatch(source, />Total debt planned</);
});
