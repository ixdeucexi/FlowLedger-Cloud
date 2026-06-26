import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getBillOccurrenceDays, getEffectiveIncomeAmount, getIncomeOccurrenceDays, isBillActiveForMonth, isValidDateInMonth } from "./schedule";

describe("bill scheduling", () => {
  it("validates a selected calendar date inside the intended month", () => {
    assert.equal(isValidDateInMonth("2026-02-28", 1, 2026), true);
    assert.equal(isValidDateInMonth("2026-02-31", 1, 2026), false);
    assert.equal(isValidDateInMonth("2026-03-01", 1, 2026), false);
  });
  it("clamps monthly bills at month end and honors active dates", () => {
    const bill = { frequency: "monthly" as const, due_day: 31, start_date: "2026-02-01", end_date: "2026-03-31" };
    assert.deepEqual(getBillOccurrenceDays(bill, 1, 2026), [28]);
    assert.deepEqual(getBillOccurrenceDays(bill, 3, 2026), []);
  });

  it("keeps historical months active when a recurring bill is stopped going forward", () => {
    const stoppedBill = { frequency: "monthly" as const, due_day: 15, start_date: "2026-01-01", end_date: "2026-06-30" };
    assert.equal(isBillActiveForMonth(stoppedBill, 4, 2026), true);
    assert.equal(isBillActiveForMonth(stoppedBill, 5, 2026), true);
    assert.equal(isBillActiveForMonth(stoppedBill, 6, 2026), false);
  });

  it("finds every weekly occurrence including overlapping month boundaries", () => {
    const bill = { frequency: "weekly" as const, due_day: 1, day_of_week: 1 };
    assert.deepEqual(getBillOccurrenceDays(bill, 5, 2026), [1, 8, 15, 22, 29]);
  });
});

describe("income scheduling", () => {
  it("projects weekly and biweekly pay dates from their anchor", () => {
    assert.deepEqual(getIncomeOccurrenceDays({ amount: 500, frequency: "weekly", next_payment_date: "2026-06-05" }, 5, 2026), [5, 12, 19, 26]);
    assert.deepEqual(getIncomeOccurrenceDays({ amount: 1_000, frequency: "biweekly", next_payment_date: "2026-05-29" }, 5, 2026), [12, 26]);
  });

  it("uses day one for monthly income with no date and none for undated repeating income", () => {
    assert.deepEqual(getIncomeOccurrenceDays({ amount: 1_000, frequency: "monthly" }, 5, 2026), [1]);
    assert.deepEqual(getIncomeOccurrenceDays({ amount: 1_000, frequency: "weekly" }, 5, 2026), []);
  });

  it("uses the latest effective income amount without changing prior months", () => {
    const income = { amount: 800, frequency: "biweekly" as const, amount_history: [
      { effective_from: "2026-07-01", amount: 900 }, { effective_from: "2026-04-01", amount: 850 },
    ] };
    assert.equal(getEffectiveIncomeAmount(income, 2, 2026), 800);
    assert.equal(getEffectiveIncomeAmount(income, 4, 2026), 850);
    assert.equal(getEffectiveIncomeAmount(income, 7, 2026), 900);
  });
});
