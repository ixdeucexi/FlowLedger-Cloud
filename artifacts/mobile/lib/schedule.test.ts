import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyBillDateMovesToOccurrenceDays, getBillOccurrenceDays, getEffectiveIncomeAmount, getIncomeOccurrenceDays, getLatestRecordedIncomeAmount, isBillActiveForMonth, isValidDateInMonth, moveSettledBillOverrideDate, resolveFinalizedBillOccurrenceDays } from "./schedule";

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

  it("does not create weekly payments before the exact start date or after the exact end date", () => {
    const bill = {
      frequency: "weekly" as const,
      due_day: 1,
      day_of_week: 3,
      start_date: "2026-07-29",
      end_date: "2026-08-12",
    };

    assert.deepEqual(getBillOccurrenceDays(bill, 6, 2026), [29]);
    assert.deepEqual(getBillOccurrenceDays(bill, 7, 2026), [5, 12]);
  });

  it("does not backfill a biweekly payment before its first pay date", () => {
    const bill = { frequency: "biweekly" as const, due_day: 1, start_date: "2026-07-29" };
    assert.deepEqual(getBillOccurrenceDays(bill, 6, 2026), [29]);
  });

  it("projects biweekly bills from the remembered first pay date", () => {
    const bill = { frequency: "biweekly" as const, due_day: 1, next_payment_date: "2026-06-05" };
    assert.deepEqual(getBillOccurrenceDays(bill, 5, 2026), [5, 19]);
    assert.deepEqual(getBillOccurrenceDays(bill, 6, 2026), [3, 17, 31]);
  });

  it("moves a bill occurrence to the new day without leaving it on the old day", () => {
    const moved = applyBillDateMovesToOccurrenceDays("utilities", 6, 2026, [4], [
      { bill_id: "utilities", from_date: "2026-07-04", to_date: "2026-07-03" },
    ]);

    assert.deepEqual(moved, [3]);
  });

  it("uses the newest move when the same occurrence was moved more than once", () => {
    const moved = applyBillDateMovesToOccurrenceDays("utilities", 6, 2026, [4], [
      { bill_id: "utilities", from_date: "2026-07-04", to_date: "2026-07-03", updated_at: "2026-07-04T10:00:00.000Z" },
      { bill_id: "utilities", from_date: "2026-07-04", to_date: "2026-07-05", updated_at: "2026-07-04T11:00:00.000Z" },
    ]);

    assert.deepEqual(moved, [5]);
  });

  it("ignores unrelated bill date moves", () => {
    const moved = applyBillDateMovesToOccurrenceDays("utilities", 6, 2026, [4], [
      { bill_id: "mortgage", from_date: "2026-07-04", to_date: "2026-07-03" },
    ]);

    assert.deepEqual(moved, [4]);
  });

  it("moves a finalized monthly bill to its actual payment date", () => {
    assert.deepEqual(resolveFinalizedBillOccurrenceDays([10], "2026-07-06", 6, 2026), [6]);
    assert.deepEqual(resolveFinalizedBillOccurrenceDays([10], "2026-08-06", 6, 2026), [10]);
    assert.deepEqual(resolveFinalizedBillOccurrenceDays([3, 17], "2026-07-17", 6, 2026), [3, 17]);
  });

  it("keeps a settled override on the same date as its moved bill occurrence", () => {
    const overrides = [{
      id: "july-card",
      bill_id: "credit-card",
      month: 6,
      year: 2026,
      paid_amount: 77,
      actual_amount: 77,
      paid_date: "2026-07-11",
    }];

    const moved = moveSettledBillOverrideDate(overrides, "credit-card", "2026-07-11", "2026-07-11", "2026-07-09");
    assert.equal(moved[0].paid_date, "2026-07-09");

    const restored = moveSettledBillOverrideDate(moved, "credit-card", "2026-07-11", "2026-07-09", "2026-07-11");
    assert.equal(restored[0].paid_date, "2026-07-11");
  });

  it("does not move an unpaid or unrelated override", () => {
    const overrides = [
      { bill_id: "credit-card", month: 6, year: 2026, paid_amount: 0, paid_date: "2026-07-11" },
      { bill_id: "utilities", month: 6, year: 2026, paid_amount: 77, paid_date: "2026-07-11" },
    ];

    assert.deepEqual(
      moveSettledBillOverrideDate(overrides, "credit-card", "2026-07-11", "2026-07-11", "2026-07-09"),
      overrides,
    );
  });
});

describe("income scheduling", () => {
  it("projects weekly and biweekly pay dates from their anchor", () => {
    assert.deepEqual(getIncomeOccurrenceDays({ amount: 500, frequency: "weekly", next_payment_date: "2026-06-05" }, 5, 2026), [5, 12, 19, 26]);
    assert.deepEqual(getIncomeOccurrenceDays({ amount: 1_000, frequency: "biweekly", next_payment_date: "2026-05-29" }, 5, 2026), [12, 26]);
  });

  it("uses the start date for monthly income and day one only when no date exists", () => {
    assert.deepEqual(getIncomeOccurrenceDays({ amount: 1_000, frequency: "monthly", start_date: "2026-06-09" }, 5, 2026), [9]);
    assert.deepEqual(getIncomeOccurrenceDays({ amount: 1_000, frequency: "monthly" }, 5, 2026), [1]);
    assert.deepEqual(getIncomeOccurrenceDays({ amount: 1_000, frequency: "weekly" }, 5, 2026), []);
  });

  it("does not add income before the exact first payday", () => {
    const income = { amount: 500, frequency: "weekly" as const, start_date: "2026-07-29", next_payment_date: "2026-07-29" };
    assert.deepEqual(getIncomeOccurrenceDays(income, 6, 2026), [29]);
    assert.deepEqual(getIncomeOccurrenceDays(income, 7, 2026), [5, 12, 19, 26]);
  });

  it("uses the latest effective income amount without changing prior months", () => {
    const income = { amount: 800, frequency: "biweekly" as const, amount_history: [
      { effective_from: "2026-07-01", amount: 900 }, { effective_from: "2026-04-01", amount: 850 },
    ] };
    assert.equal(getEffectiveIncomeAmount(income, 2, 2026), 800);
    assert.equal(getEffectiveIncomeAmount(income, 4, 2026), 850);
    assert.equal(getEffectiveIncomeAmount(income, 7, 2026), 900);
  });

  it("shows the latest recorded amount while preserving the historical baseline", () => {
    const income = { amount: 2_308, frequency: "biweekly" as const, amount_history: [
      { effective_from: "2026-07", amount: 2_401.73 },
    ] };
    assert.equal(getLatestRecordedIncomeAmount(income), 2_401.73);
    assert.equal(getEffectiveIncomeAmount(income, 5, 2026), 2_308);
    assert.equal(getEffectiveIncomeAmount(income, 6, 2026), 2_401.73);
  });
});
