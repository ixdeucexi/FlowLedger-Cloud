import test from "node:test";
import assert from "node:assert/strict";
import { billTransferCutoff, billTransferExpected, mergeConvertedBill, verifyBillTransferConversion } from "./billTransferConversion";
import type { Bill } from "./financialProjectionTypes";

const source: Bill = { id: "kids", name: "Kids", amount: 50, category: "Family", priority: 2, is_debt: false, balance: 0,
  interest_rate: 0, due_day: 4, day_of_week: 0, start_date: "2026-07-04", is_recurring: true, frequency: "monthly",
  smart_priority: "must", include_in_snowball: true, debt_payment_pauses: [], funding_account_ref: "manual:bills", created_at: "2026-07-01" };
const patch = { name: "Kids transfer", amount: 50, from_account_ref: "manual:bills" as const,
  to_account_ref: "manual:spending" as const, frequency: "monthly" as const, start_date: "2027-01-04", end_date: null, status: "active" as const };
const reply = () => ({ bill: { ...source, household_id: "home", budget_id: "budget", end_date: "2027-01-03" },
  transfer: { ...patch, id: "bill-transfer-0123456789abcdef0123456789abcdef", household_id: "home", budget_id: "budget",
    created_by: "editor", created_at: "2026-11-12", updated_at: "2026-11-12", revision: 1, deleted_at: null, source_bill_id: source.id } });
const scope = { householdId: "home", budgetId: "budget", userId: "editor" };

test("conversion cutoff follows real month/year boundaries without local-time arithmetic", () => {
  assert.equal(billTransferCutoff("2028-03-01"), "2028-02-29");
  assert.equal(billTransferCutoff("2027-03-01"), "2027-02-28");
  assert.equal(billTransferCutoff("2027-01-01"), "2026-12-31");
  for (const date of ["2027-02-29", "2027-04-31", "bad"]) assert.throws(() => billTransferCutoff(date));
});

test("verified conversion retains the full source baseline and requires its durable plan origin", () => {
  const result = verifyBillTransferConversion(reply(), source, patch, scope);
  assert.deepEqual(billTransferExpected(result.bill), { ...billTransferExpected(source), end_date: "2027-01-03" });
  assert.equal(result.transfer.source_bill_id, source.id);
  for (const mutate of [
    (value: any) => { value.transfer.source_bill_id = "other"; },
    (value: any) => { delete value.transfer.source_bill_id; },
    (value: any) => { value.transfer.revision = 2; },
    (value: any) => { value.transfer.deleted_at = "2027-01-01"; },
    (value: any) => { value.transfer.budget_id = "other"; },
    (value: any) => { value.bill.start_date = "2026-08-04"; },
  ]) { const value = reply(); mutate(value); assert.throws(() => verifyBillTransferConversion(value, source, patch, scope), /verified/); }
});

test("conversion publication only merges its authoritative cutoff and never resurrects rows", () => {
  const latest = { ...source, name: "New local label", amount: 60 };
  const saved = { ...source, end_date: "2027-01-03" };
  assert.deepEqual(mergeConvertedBill([latest], source, saved), [{ ...latest, end_date: "2027-01-03" }]);
  assert.deepEqual(mergeConvertedBill([], source, saved), []);
  assert.equal(latest.end_date, undefined);
});
