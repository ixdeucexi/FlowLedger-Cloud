const assert = require("node:assert/strict");
const test = require("node:test");

const { buildOverdueOccurrences, occurrenceDays } = require("./overdueBills");

test("overdue bills use the exact weekly occurrence instead of the monthly total", () => {
  const alerts = buildOverdueOccurrences({
    today: "2026-07-21",
    bills: [{ id: "weekly", user_id: "owner", name: "Weekly", amount: 90, due_day: 1, day_of_week: 3, frequency: "weekly", is_debt: false }],
    overrides: [{ bill_id: "weekly", paid_amount: 180 }],
    moves: [],
  });
  assert.deepEqual(alerts.map(alert => [alert.occurrenceDate, alert.remainingAmount]), [["2026-07-15", 90]]);
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
