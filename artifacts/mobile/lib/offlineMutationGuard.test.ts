import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("financial context gates writes before updateBill optimistic state", () => {
  const source = readFileSync("context/BudgetContext.tsx", "utf8");
  const gateStart = source.indexOf("const assertCanEditHousehold");
  const gateEnd = source.indexOf("const scopedPayload", gateStart);
  const gate = source.slice(gateStart, gateEnd);
  assert.match(gate, /assertFinancialMutationOnline\(\)/);

  const updateStart = source.indexOf("const updateBill");
  const updateEnd = source.indexOf("const stopFutureBill", updateStart);
  const updateBill = source.slice(updateStart, updateEnd);
  assert.ok(updateBill.indexOf('assertCanEditHousehold("update a bill")') < updateBill.indexOf("setBills("));
  assert.match(updateBill, /billEditableDbPatch\(reviewedBill, activeEditableFields\)/);
  assert.match(updateBill, /update_bill_with_override_intents/);
  assert.doesNotMatch(updateBill, /\.\.\.reviewedBill, user_id/);
});

test("category budgets check connectivity before changing visible totals or cache", () => {
  const screen = readFileSync("app/(tabs)/category-budget.tsx", "utf8");
  const persistStart = screen.indexOf("const persistBudgets");
  const persistEnd = screen.indexOf("const saveDrafts", persistStart);
  const persist = screen.slice(persistStart, persistEnd);
  const screenGate = persist.indexOf("assertFinancialMutationOnline()");
  const save = persist.indexOf("await saveMonthlyCategoryBudgetChanges(");
  const publish = persist.indexOf("setCategoryBudgets(result.budgets)");
  assert.ok(screenGate >= 0 && screenGate < save && save < publish);

  const store = readFileSync("lib/categoryBudgetStore.ts", "utf8");
  const monthlySaveStart = store.indexOf("export async function saveMonthlyCategoryBudgetChanges");
  const monthlySaveEnd = store.indexOf("export async function saveCategoryBudgets", monthlySaveStart);
  const monthlySave = store.slice(monthlySaveStart, monthlySaveEnd);
  assert.ok(monthlySave.indexOf("assertFinancialMutationOnline()") >= 0);
  assert.ok(monthlySave.indexOf("assertFinancialMutationOnline()") < monthlySave.indexOf('supabase.rpc('));
  assert.ok(monthlySave.indexOf('supabase.rpc(') < monthlySave.indexOf("writeCategoryBudgetCache"));
  const saveStart = store.indexOf("export async function saveCategoryBudgets");
  const cacheWrite = store.indexOf("writeCategoryBudgetCache", saveStart);
  assert.ok(store.indexOf("assertFinancialMutationOnline()", saveStart) < cacheWrite);
});
