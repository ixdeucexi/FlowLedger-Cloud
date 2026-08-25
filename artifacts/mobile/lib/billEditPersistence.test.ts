import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  billEditablePatch,
  billEditableDbPatch,
  changedBillEditableFields,
  type BillEditableField,
} from "./billEditPersistence";

type EditableBill = Record<BillEditableField, unknown>;

function bill(overrides: Partial<EditableBill> = {}): EditableBill {
  return {
    name: "Card",
    amount: 50,
    category: "Debt",
    priority: 1,
    is_debt: true,
    balance: 900,
    interest_rate: 12,
    due_day: 15,
    day_of_week: 0,
    next_payment_date: undefined,
    start_date: "2026-01-01",
    end_date: undefined,
    is_recurring: true,
    frequency: "monthly",
    smart_priority: "must",
    include_in_snowball: true,
    ...overrides,
  };
}

test("an editor reports only fields changed from its open-time baseline", () => {
  const baseline = bill();
  const submitted = bill({ name: "Travel Card", due_day: 20 });
  assert.deepEqual(changedBillEditableFields(baseline, submitted), ["name", "due_day"]);
  assert.deepEqual(billEditablePatch(submitted, ["name", "due_day"]), {
    name: "Travel Card",
    due_day: 20,
  });
});

test("an unrelated editor save never includes a stale debt balance", () => {
  const openTime = bill({ balance: 900 });
  const submitted = bill({ name: "Renamed Card", balance: 900 });
  const liveAfterPayment = bill({ balance: 825 });
  const fields = changedBillEditableFields(openTime, submitted);
  const merged = { ...liveAfterPayment, ...billEditablePatch(submitted, fields) };
  assert.deepEqual(fields, ["name"]);
  assert.equal(merged.balance, 825);
  assert.equal(merged.name, "Renamed Card");
  assert.deepEqual(billEditableDbPatch(openTime, fields), { name: "Card" });
  assert.deepEqual(billEditableDbPatch(submitted, fields), { name: "Renamed Card" });
});

test("a deliberate balance edit carries its open-time value for conflict detection", () => {
  const openTime = bill({ balance: 900 });
  const submitted = bill({ balance: 850 });
  const fields = changedBillEditableFields(openTime, submitted);
  assert.deepEqual(fields, ["balance"]);
  assert.deepEqual(billEditableDbPatch(openTime, fields), { balance: 900 });
  assert.deepEqual(billEditableDbPatch(submitted, fields), { balance: 850 });
});

test("persistence contracts update only owned columns across Review Center races", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const overrideStart = context.indexOf("const persistMonthlyOverrideWriteIntent");
  const overrideEnd = context.indexOf("// ─── Bills", overrideStart);
  const overrideWrite = context.slice(overrideStart, overrideEnd);
  assert.match(overrideWrite, /monthlyOverridePatchDbPayload\(effectivePatch\)/);
  assert.match(overrideWrite, /\.update\(dbPatch\)/);
  assert.doesNotMatch(overrideWrite, /monthlyOverrideDbPayload\(updated\)/);

  const billStart = context.indexOf("const updateBill");
  const billEnd = context.indexOf("const stopFutureBill", billStart);
  const billWrite = context.slice(billStart, billEnd);
  assert.match(billWrite, /billEditablePatch\(bill, editableFields\)/);
  assert.match(billWrite, /billEditableDbPatch\(reviewedBill, activeEditableFields\)/);
  assert.match(billWrite, /update_bill_with_override_intents/);
  assert.match(billWrite, /p_expected: expectedBillPatch/);
  assert.match(billWrite, /p_patch: persistedBillPatch/);
  assert.match(billWrite, /p_overrides: activeOverrideIntents/);
  assert.match(billWrite, /expected: monthlyOverridePatchDbPayload/);
  assert.match(billWrite, /enqueueMutationByKeys/);
  const realPersist = billWrite.slice(billWrite.indexOf("const persist:"));
  assert.doesNotMatch(realPersist, /Promise\.all\(overrideIntents\.map\(persistMonthlyOverrideWriteIntent\)\)/);
  assert.doesNotMatch(billWrite, /\.update\(\{[\s\S]*\.\.\.reviewedBill/);
});

test("database contract rejects duplicate monthly override occurrences", () => {
  const migration = readFileSync("../../supabase/migrations/20260825094545_unique_monthly_override_occurrences.sql", "utf8");
  assert.match(migration, /having count\(\*\) > 1/i);
  assert.match(migration, /alter column household_id set not null/i);
  assert.match(migration, /create unique index[\s\S]+household_id, bill_id, month, year/i);
  assert.match(migration, /function public\.update_bill_with_override_intents/i);
  assert.match(migration, /from public\.bills[\s\S]+for update/i);
  assert.match(migration, /update public\.bills set[\s\S]+insert into public\.monthly_overrides/i);
  assert.match(migration, /on conflict \(household_id, bill_id, month, year\) do nothing/i);
  assert.match(migration, /v_override_expected[\s\S]+for update[\s\S]+is distinct from/i);
  assert.match(migration, /foreign key \(household_id\)[\s\S]+on delete cascade/i);
  assert.match(migration, /perform public\.recalculate_debt_minimum_boosts/i);
});
