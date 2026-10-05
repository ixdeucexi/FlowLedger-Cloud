import test from "node:test";
import assert from "node:assert/strict";
import { buildPaydayReviewPlan, paydayReviewMessage, type PaydayReviewSource } from "./paydayReview";
import type { FinancialEvent } from "./forecast";
import { createFinancialProjection } from "./financialProjection";
import type { FinancialProjectionSnapshot } from "./financialProjectionTypes";
import golden from "./financialProjection.golden.json";

function source(): PaydayReviewSource {
  return {
    getDailyBalances: (month, year) => Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => ({ day: index + 1, balance: index + 1 >= 12 ? 700 : 1200, projectionEvents: month === 9 ? [
      ...(index === 11 ? [{ id: "rent", sourceType: "bill" as const, sourceId: "rent", kind: "bill" as const, amount: -500, date: "2026-10-12", name: "Rent", status: "planned" as const }] : []),
      ...(index === 15 ? [{ id: "pay", sourceType: "income" as const, sourceId: "pay", kind: "scheduled_income" as const, amount: 2000, date: "2026-10-16", name: "Paycheck", status: "scheduled" as const }] : []),
    ] : [] })),
  };
}
test("shared assembly uses canonical paid-in-full remainder and dated pre-payday forecast", () => {
  const input = source();
  const result = buildPaydayReviewPlan(input, new Date(2026, 9, 5), 2, 500);
  assert.equal(result.forecastComplete, true);
  assert.equal(result.billsTotal, 500);
  assert.deepEqual(result.billsDue.map(bill => bill.name), ["Rent"]);
  assert.equal(result.lowestBalance, 700);
  assert.equal(result.lowestBalanceDate, "2026-10-12");
  assert.equal(result.safeToSpend, 200);
  assert.equal(result.nextPaycheck?.amount, 2000);
});
test("review gives Flo voice, exact money, dates, risk and assumptions without AI", () => {
  const result = buildPaydayReviewPlan(source(), new Date(2026, 9, 5), 2, 500);
  const message = paydayReviewMessage(result, 500, "high", true).join(" ");
  for (const fragment of ["$2,000.00", "Oct 16, 2026", "$500.00", "$700.00", "Oct 12, 2026", "$200.00", "I'm protecting", "not a guarantee"]) assert.ok(message.includes(fragment));
});
test("negative balance retained and low confidence does not approve spending", () => {
  const result = buildPaydayReviewPlan(source(), new Date(2026, 9, 5), 2, 500);
  const message = paydayReviewMessage({ ...result, lowestBalance: -25.37, safeToSpend: 0 }, 500, "low", true).join(" ");
  assert.match(message, /-\$25\.37/);
  assert.match(message, /\$525\.37 below/);
  assert.match(message, /not approval to spend/);
});
test("missing checking, income, forecast dates, and invalid numbers fail closed", () => {
  const result = buildPaydayReviewPlan(source(), new Date(2026, 9, 5), 2, 500);
  assert.match(paydayReviewMessage(result, 500, "high", false).join(), /need a current checking balance/);
  assert.match(paydayReviewMessage({ ...result, nextPaycheck: null }, 500, "high", true).join(), /couldn't confirm/);
  const base = source();
  const incomplete = buildPaydayReviewPlan({ getDailyBalances: (month, year) => base.getDailyBalances(month, year).filter(day => day.day !== 7) }, new Date(2026, 9, 5), 2, 500);
  assert.equal(incomplete.forecastComplete, false);
  assert.match(paydayReviewMessage(incomplete, 500, "high", true).join(), /can't verify/);
  assert.match(paydayReviewMessage({ ...result, lowestBalance: NaN }, 500, "high", true).join(), /can't verify/);
});
test("December crosses the year without skipping bills or mislabeling payday", () => {
  const base = source();
  const result = buildPaydayReviewPlan({ getDailyBalances: (month, year) => base.getDailyBalances(month, year).map(day => ({ ...day, projectionEvents: day.day === 2 && month === 0 && year === 2027 ? [{ id: "pay", sourceType: "income", sourceId: "pay", kind: "scheduled_income", amount: 800, date: "2027-01-02", name: "Paycheck", status: "scheduled" }] : [] })) }, new Date(2026, 11, 31), 2, 500);
  assert.equal(result.nextPaycheck?.date, "2027-01-02");
  assert.equal(result.windowEnd, "2027-01-01");
  assert.equal(result.forecastComplete, true);
});
test("canonical events keep custom weekly amounts and later partial balances without redistributing a month total", () => {
  const base = source();
  const events: FinancialEvent[] = [
    { id: "weekly-1", sourceType: "bill", sourceId: "weekly", kind: "bill", amount: -12.35, date: "2026-10-08", name: "Weekly", status: "planned" },
    { id: "weekly-2", sourceType: "bill", sourceId: "weekly", kind: "bill", amount: -30.01, date: "2026-10-15", name: "Weekly", status: "planned" },
    { id: "apple", sourceType: "transaction", sourceId: "apple", kind: "transaction_expense", amount: -9.99, date: "2026-10-10", name: "Apple", status: "actual" },
    { id: "pay", sourceType: "income", sourceId: "pay", kind: "scheduled_income", amount: 1915.42, date: "2026-10-16", name: "Actual scheduled paycheck", status: "scheduled" },
  ];
  const result = buildPaydayReviewPlan({ getDailyBalances: (month, year) => base.getDailyBalances(month, year).map(day => ({ ...day, projectionEvents: events.filter(event => event.date === `${year}-${String(month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`) })) }, new Date(2026, 9, 5), 2, 500);
  assert.deepEqual(result.billsDue.map(bill => bill.amount), [12.35, 30.01]);
  assert.ok(Math.abs(result.billsTotal - 42.36) < 0.00001);
  assert.equal(result.nextPaycheck?.amount, 1915.42);
  assert.equal(result.billsDue.some(bill => bill.name === "Apple"), false);
  assert.equal(events[0].amount, -12.35);
});
test("review agrees with real Forecast for full-under-budget match, custom weekly occurrence, and later partial payment", () => {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  const template = snapshot.bills[0];
  snapshot.bills = [
    { ...template, id: "apple", name: "Apple", amount: 15, due_day: 10, start_date: "2026-01-01" },
    { ...template, id: "weekly", name: "Weekly", amount: 25, due_day: 1, frequency: "weekly", day_of_week: 4, start_date: "2026-01-01" },
  ];
  snapshot.incomes = [{ id: "pay", name: "Paycheck", amount: 2000, frequency: "monthly", start_date: "2026-10-16", next_payment_date: "2026-10-16" }];
  snapshot.transactions = [
    { id: "apple-paid", date: "2026-10-04", amount: -9.99, category: "Other", note: "Apple", source: "statement", review_status: "matched", review_resolution: "bill", review_allocations: [{ type: "bill", targetId: "apple", occurrenceDate: "2026-10-10", amount: 9.99, plannedAmount: 15, settlement: "full" }] },
    { id: "weekly-partial", date: "2026-10-04", amount: -5, category: "Other", note: "Weekly", source: "statement", review_status: "matched", review_resolution: "bill", review_allocations: [{ type: "bill", targetId: "weekly", occurrenceDate: "2026-10-15", amount: 5, plannedAmount: 25, settlement: "partial" }] },
  ];
  snapshot.billDateMoves = [{ id: "custom-weekly", bill_id: "weekly", from_date: "2026-10-08", to_date: "2026-10-08", custom_amount: 12.35, created_at: "2026-10-01T12:00:00Z" }];
  snapshot.overrides = [];
  snapshot.goals = [];
  snapshot.decisions = [];
  snapshot.extraPayments = [];
  snapshot.accounts = [];
  snapshot.connectedBankAccounts = [{ id: "checking", name: "Checking", current_balance: 1000, is_active: true, account_type: "depository", account_subtype: "checking", updated_at: "2026-10-05T12:00:00Z" }];
  snapshot.settings.debtPayoffEnabled = false;
  snapshot.settings.safety_floor = 200;
  const now = new Date("2026-10-05T12:00:00Z");
  const projection = createFinancialProjection(snapshot, { now, timeZone: "America/Chicago" });
  const review = buildPaydayReviewPlan(projection, now, 2, 200);
  // Forecast also reserves the unreviewed earlier weekly payment on its bank anchor.
  assert.deepEqual(review.billsDue.map(bill => [bill.name, bill.dueDate, bill.amount]), [["Weekly", "2026-10-05", 25], ["Weekly", "2026-10-08", 12.35], ["Weekly", "2026-10-15", 20]]);
  assert.equal(review.nextPaycheck?.amount, 2000);
  assert.equal(review.forecastComplete, true);
  const canonical = projection.getDailyBalances(9, 2026).filter(day => day.day >= 5 && day.day < 16);
  assert.equal(review.lowestBalance, Math.min(...canonical.map(day => day.balance)));
  assert.equal(review.safeToSpend, Math.max(0, review.lowestBalance - 200));
});
