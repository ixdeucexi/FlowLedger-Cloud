const assert = require("node:assert/strict");
const test = require("node:test");

const { buildOverdueOccurrences, occurrenceDays, suppressPendingMatchedOccurrences } = require("./overdueBills");

test("overdue bills use the exact weekly occurrence instead of the monthly total", () => {
  const alerts = buildOverdueOccurrences({
    today: "2026-07-21",
    bills: [{ id: "weekly", user_id: "owner", name: "Weekly", amount: 90, due_day: 1, day_of_week: 3, frequency: "weekly", is_debt: false }],
    overrides: [{ bill_id: "weekly", paid_amount: 180 }],
    moves: [],
  });
  assert.deepEqual(alerts.map(alert => [alert.occurrenceDate, alert.remainingAmount]), [["2026-07-15", 90]]);
});

test("a temporary pending match suppresses only its exact overdue occurrence", () => {
  const overdue = [
    { householdId: "home", billId: "utility", occurrenceDate: "2026-07-02", remainingAmount: 100 },
    { householdId: "home", billId: "utility", occurrenceDate: "2026-07-16", remainingAmount: 100 },
    { householdId: "home", billId: "rent", occurrenceDate: "2026-07-03", remainingAmount: 800 },
  ];
  const visible = suppressPendingMatchedOccurrences(overdue, [{
    pending_plaid_transaction_id: "pending-1",
    target_id: "utility",
    occurrence_date: "2026-07-02",
    household_id: "home",
    status: "active",
  }], [{
    household_id: "home",
    plaid_transaction_id: "pending-1",
  }]);

  assert.deepEqual(visible.map(alert => `${alert.billId}:${alert.occurrenceDate}`), [
    "utility:2026-07-16",
    "rent:2026-07-03",
  ]);
});

test("expired pending matches do not hide overdue bills", () => {
  const overdue = [{ householdId: "home", billId: "utility", occurrenceDate: "2026-07-02", remainingAmount: 100 }];
  const visible = suppressPendingMatchedOccurrences(overdue, [{
    target_id: "utility",
    occurrence_date: "2026-07-02",
    household_id: "home",
    status: "expired",
  }]);

  assert.equal(visible.length, 1);
});

test("a vanished pending charge no longer hides an overdue notification", () => {
  const overdue = [{ householdId: "home", billId: "utility", occurrenceDate: "2026-07-02", remainingAmount: 100 }];
  const visible = suppressPendingMatchedOccurrences(overdue, [{
    pending_plaid_transaction_id: "pending-gone",
    target_id: "utility",
    occurrence_date: "2026-07-02",
    household_id: "home",
    status: "active",
  }], []);

  assert.equal(visible.length, 1);
});

test("a posted replacement stays protected while it waits for review", () => {
  const overdue = [{ householdId: "home", billId: "utility", occurrenceDate: "2026-07-02", remainingAmount: 100 }];
  const visible = suppressPendingMatchedOccurrences(overdue, [{
    pending_plaid_transaction_id: "pending-gone",
    target_id: "utility",
    occurrence_date: "2026-07-02",
    household_id: "home",
    status: "ready_review",
  }], []);

  assert.deepEqual(visible, []);
});

test("a bill due today is not past due", () => {
  const alerts = buildOverdueOccurrences({
    today: "2026-07-21",
    bills: [{ id: "today", user_id: "owner", amount: 100, due_day: 21, frequency: "monthly", is_debt: false }],
    overrides: [],
    moves: [],
  });
  assert.deepEqual(alerts, []);
});

test("partial payment alerts only for the amount still open", () => {
  const alerts = buildOverdueOccurrences({
    today: "2026-07-21",
    bills: [{ id: "insurance", user_id: "owner", amount: 300, due_day: 20, frequency: "monthly", is_debt: false }],
    overrides: [{ bill_id: "insurance", paid_amount: 287.52 }],
    moves: [],
  });
  assert.equal(alerts[0].remainingAmount, 12.48);
});

test("a finalized lower payment stays closed", () => {
  const alerts = buildOverdueOccurrences({
    today: "2026-07-21",
    bills: [{ id: "insurance", user_id: "owner", amount: 300, due_day: 20, frequency: "monthly", is_debt: false }],
    overrides: [{ bill_id: "insurance", paid_amount: 287.52, actual_amount: 287.52, paid_date: "2026-07-20" }],
    moves: [],
  });
  assert.deepEqual(alerts, []);
});

test("moved occurrences alert on the moved date", () => {
  const days = occurrenceDays(
    { id: "bill", amount: 100, due_day: 19, frequency: "monthly", is_debt: false },
    null,
    [{ bill_id: "bill", from_date: "2026-07-19", to_date: "2026-07-20" }],
    6,
    2026,
  );
  assert.deepEqual(days, [20]);
});
