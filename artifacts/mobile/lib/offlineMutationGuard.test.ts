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
  assert.match(updateBill, /Object\.entries\(reviewedBill\)/);
});

test("category budgets check connectivity before changing visible totals or cache", () => {
  const screen = readFileSync("app/(tabs)/category-budget.tsx", "utf8");
  const persistStart = screen.indexOf("const persistBudgets");
  const persistEnd = screen.indexOf("const saveDrafts", persistStart);
  const persist = screen.slice(persistStart, persistEnd);
  assert.ok(persist.indexOf("assertFinancialMutationOnline()") < persist.indexOf("setCategoryBudgets(next)"));

  const store = readFileSync("lib/categoryBudgetStore.ts", "utf8");
  const saveStart = store.indexOf("export async function saveCategoryBudgets");
  const cacheWrite = store.indexOf("writeCategoryBudgetCache", saveStart);
  assert.ok(store.indexOf("assertFinancialMutationOnline()", saveStart) < cacheWrite);
});
