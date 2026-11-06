const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { transpileModule, ModuleKind } = require("typescript");

const { buildOverdueOccurrences, occurrenceDays, suppressPendingMatchedOccurrences } = require("./overdueBills");

test("server annual dates match the canonical scheduler across edits and skips", () => {
  const canonical = {};
  const source = readFileSync(resolve(__dirname, "../../artifacts/mobile/lib/schedule.ts"), "utf8");
  new Function("exports", transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText)(canonical);
  const bill = { id: "annual", frequency: "yearly", due_day: 29, next_payment_date: "2024-02-29", start_date: "2024-02-29" };
  const move = (from_date, to_date, rest = {}) => ({ bill_id: "annual", from_date, to_date, ...rest });
  for (const moves of [[],
    [move("2026-02-28", "2026-03-05"), move("2026-03-05", "2026-04-10")],
    [move("2026-02-28", "2026-02-28", { is_skipped: true })],
    [move("2026-02-28", "2026-03-05", { created_at: "2026-01-01" }), move("2026-03-05", "2026-04-10"), move("2026-02-28", "2026-05-05", { updated_at: "2026-01-02" })],
    [move("2026-02-28", "2026-03-05"), move("2026-03-05", "2026-02-28")],
  ]) {
    for (const [month, year] of [[1, 2023], [1, 2024], [1, 2026], [2, 2026], [3, 2026], [4, 2026], [1, 2027], [1, 2028]]) {
      const expected = canonical.applyBillDateMovesToOccurrenceDays(bill.id, month, year, canonical.getBillOccurrenceDays(bill, month, year), moves, bill);
      assert.deepEqual(occurrenceDays(bill, undefined, moves, month, year), expected, JSON.stringify({ moves, month, year }));
    }
  }
});

test("yearly reminders follow full anniversary dates and recover leap day", () => {
  const bill = { id: "annual", user_id: "owner", name: "Annual insurance", amount: 1200, frequency: "yearly", due_day: 29, next_payment_date: "2024-02-29", start_date: "2024-02-29" };
  assert.deepEqual([2024, 2025, 2026, 2027, 2028].map(year => occurrenceDays(bill, undefined, [], 1, year)), [[29], [28], [28], [28], [29]]);
  assert.deepEqual(occurrenceDays(bill, { custom_due_day: 5 }, [], 0, 2027), []);
  assert.deepEqual(occurrenceDays({ ...bill, next_payment_date: undefined, start_date: undefined }, undefined, [], 1, 2027), []);
  assert.deepEqual(occurrenceDays({ ...bill, next_payment_date: "2024-02-31" }, undefined, [], 1, 2027), []);
  assert.deepEqual(occurrenceDays({ ...bill, end_date: "2026-02-28" }, undefined, [], 1, 2026), [28]);
  assert.deepEqual(occurrenceDays({ ...bill, end_date: "2026-02-27" }, undefined, [], 1, 2026), []);
  const alerts = buildOverdueOccurrences({ bills: [bill], overrides: [{ bill_id: "annual", paid_amount: 400 }], moves: [], today: "2028-02-29" });
  assert.deepEqual(alerts, []);
  const overdue = buildOverdueOccurrences({ bills: [{ ...bill, due_day: 15, next_payment_date: "2026-11-15", start_date: "2026-11-15" }], overrides: [{ bill_id: "annual", paid_amount: 400 }], moves: [], today: "2026-11-16" });
  assert.deepEqual(overdue.map(alert => [alert.occurrenceDate, alert.remainingAmount]), [["2026-11-15", 800]]);
});

test("annual reminder moves, repeat edits, skips and next-year payments retain one obligation", () => {
  const bill = { id: "annual", user_id: "owner", amount: 1200, frequency: "yearly", due_day: 15, next_payment_date: "2026-11-15" };
  const moves = [{ bill_id: "annual", from_date: "2026-11-15", to_date: "2026-12-01" }, { bill_id: "annual", from_date: "2026-12-01", to_date: "2027-01-05", custom_amount: 1000 }];
  assert.deepEqual(occurrenceDays(bill, undefined, moves, 10, 2026), []);
  assert.deepEqual(occurrenceDays(bill, undefined, moves, 11, 2026), []);
  assert.deepEqual(occurrenceDays(bill, undefined, moves, 0, 2027), [5]);
  assert.deepEqual(occurrenceDays(bill, undefined, moves, 10, 2027), [15]);
  assert.deepEqual(buildOverdueOccurrences({ bills: [bill], overrides: [], moves, today: "2027-01-06" }).map(alert => [alert.occurrenceDate, alert.remainingAmount]), [["2027-01-05", 1000]]);
  assert.deepEqual(occurrenceDays(bill, undefined, [...moves, { bill_id: "annual", from_date: "2027-01-05", to_date: "2027-01-05", is_skipped: true }], 0, 2027), []);
});

test("closed debts never create overdue notifications", () => {
  const alerts = buildOverdueOccurrences({
    today: "2026-08-10",
    bills: [{
      id: "closed-debt",
      user_id: "user-1",
      name: "Paid card",
      amount: 75,
      balance: 0,
      due_day: 5,
      is_debt: true,
      is_recurring: true,
      frequency: "monthly",
    }],
    overrides: [],
    moves: [],
  });
  assert.deepEqual(alerts, []);
});

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

test("a pending manual Activity link never suppresses a bill occurrence", () => {
  const overdue = [{ householdId: "home", billId: "manual-57", occurrenceDate: "2026-07-02", remainingAmount: 100 }];
  const visible = suppressPendingMatchedOccurrences(overdue, [{
    pending_plaid_transaction_id: "pending-manual",
    target_type: "manual",
    target_id: "manual-57",
    occurrence_date: "2026-07-02",
    household_id: "home",
    status: "active",
  }], [{ household_id: "home", plaid_transaction_id: "pending-manual" }]);

  assert.deepEqual(visible, overdue);
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
