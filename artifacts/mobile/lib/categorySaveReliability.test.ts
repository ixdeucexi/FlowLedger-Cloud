import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { remapCategoryBudgetMap } from "./categoryCatalog";
import { createExactCategoryBudgetMemoryCache, parseCategoryBudgetCache, resolveGuardedRemoteValue } from "./categoryBudgetLoadPolicy";
import * as categoryBudgetRules from "./categoryBudgetRules";

function storeHarness(failAt: string | null, delayedSelects: Array<Promise<unknown>> = [], rpcResults: unknown[] = []) {
  const source = readFileSync("lib/categoryBudgetStore.ts", "utf8");
  const exported: any = {};
  const operations: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const query = (kind: string) => {
    const result: any = {
      eq: () => result, in: () => result,
      then: (resolve: (value: unknown) => void) => {
        operations.push(kind);
        if (kind === "select" && delayedSelects.length) return delayedSelects.shift()!.then(resolve);
        resolve({ error: failAt === kind ? { message: "test rejection" } : null, data: kind === "select" ? [{ category: "Removed" }] : null });
      },
    };
    return result;
  };
  const mockRequire = (id: string) => {
    if (id === "react-native") return { Platform: { OS: "android" } };
    if (id.endsWith("/supabase")) return { supabase: {
      from: () => ({ upsert: () => query("upsert"), select: () => query("select"), delete: () => query("delete") }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        operations.push(`rpc:${name}`);
        rpcCalls.push({ name, args });
        if (failAt === "rpc" || failAt === name) return { error: { message: "test rejection" }, data: null };
        let response: any;
        if (rpcResults.length) response = await rpcResults.shift();
        else if (name === "get_monthly_category_budget_plan" && delayedSelects.length) response = await delayedSelects.shift();
        else response = { error: null, data: { budgets: {}, recurringCategories: [] } };
        // Existing delayed-load cases also exercise the new household RPC path.
        if (Array.isArray(response?.data)) return {
          ...response,
          data: { budgets: Object.fromEntries(response.data.map((row: any) => [row.category, row.amount])), recurringCategories: [] },
        };
        return response;
      },
    } };
    if (id.endsWith("/networkStatus")) return { assertFinancialMutationOnline: () => {} };
    if (id.endsWith("/categoryCatalog")) return { remapCategoryBudgetMap };
    if (id.endsWith("/categoryBudgetLoadPolicy")) return { createExactCategoryBudgetMemoryCache, parseCategoryBudgetCache, resolveGuardedRemoteValue };
    if (id.endsWith("/categoryBudgetRules")) return categoryBudgetRules;
    throw new Error(id);
  };
  new Function("exports", "require", transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 } }).outputText)(exported, mockRequire);
  return { store: exported, operations, rpcCalls };
}

test("remote category failures never promote unconfirmed assignments to cache", async () => {
  for (const failAt of ["upsert", "select", "delete"]) {
    const { store } = storeHarness(failAt);
    const scope = { userId: "test-owner", budgetId: "test-budget" };
    store.writeCategoryBudgetCache(8, 2026, { Food: 25 }, scope);
    await assert.rejects(store.saveCategoryBudgets(scope, 8, 2026, { Food: 200 }), /test rejection/);
    assert.deepEqual(store.readCategoryBudgetCache(8, 2026, scope), { Food: 25 });
  }
});
test("successful scoped category save publishes confirmed assignments including explicit zero", async () => {
  const { store, operations } = storeHarness(null);
  const scope = { userId: "test-owner", budgetId: "test-budget" };
  let notified = 0;
  store.subscribeCategoryBudgets(() => notified++);
  await store.saveCategoryBudgets(scope, 8, 2026, { Food: 0 });
  assert.deepEqual(operations, ["upsert", "select", "delete"]);
  assert.deepEqual(store.readCategoryBudgetCache(8, 2026, scope), { Food: 0 });
  assert.deepEqual(store.readCategoryBudgetCache(9, 2026, scope), {});
  assert.equal(notified, 1);
});
test("failed clear retains the last confirmed category map", async () => {
  const { store } = storeHarness("delete");
  const scope = { userId: "test-owner" };
  store.writeCategoryBudgetCache(8, 2026, { Food: 25 }, scope);
  await assert.rejects(store.saveCategoryBudgets(scope, 8, 2026, {}));
  assert.deepEqual(store.readCategoryBudgetCache(8, 2026, scope), { Food: 25 });
});

test("a confirmed category rename remaps every cached month only in its own budget and publishes one catalog event", () => {
  const { store } = storeHarness(null);
  const scope = { userId: "owner", householdId: "house", budgetId: "category-rename-budget" };
  const other = { userId: "other", householdId: "other-house", budgetId: "other-budget" };
  store.writeCategoryBudgetCache(10, 2026, { Food: 25, Groceries: 10, Rent: 100 }, scope);
  store.writeCategoryBudgetCache(11, 2026, { Food: 40 }, scope);
  store.writeCategoryBudgetCache(10, 2026, { Food: 99 }, other);
  const events: unknown[] = [];
  const unsubscribe = store.subscribeCategoryCatalog((event: unknown) => events.push(event));
  store.remapCategoryBudgetCaches(scope, "Food", "Groceries");
  assert.deepEqual(store.readCategoryBudgetCache(10, 2026, scope), { Groceries: 35, Rent: 100 });
  assert.deepEqual(store.readCategoryBudgetCache(11, 2026, scope), { Groceries: 40 });
  assert.deepEqual(store.readCategoryBudgetCache(10, 2026, other), { Food: 99 });
  assert.deepEqual(events, [{ scope, oldName: "Food", newName: "Groceries" }]);
  unsubscribe();
});

test("a pre-rename empty-cache fetch cannot publish old labels or defeat the fresh confirmed fetch", async () => {
  let finishOld!: (value: unknown) => void, finishFresh!: (value: unknown) => void;
  const oldResponse = new Promise(resolve => { finishOld = resolve; });
  const freshResponse = new Promise(resolve => { finishFresh = resolve; });
  const { store } = storeHarness(null, [oldResponse, freshResponse]);
  const scope = { userId: "owner", householdId: "race-house", budgetId: "empty-cache-race" };
  const oldLoad = store.loadCategoryBudgetsExact(scope, 10, 2026);
  await new Promise(resolve => setImmediate(resolve));
  store.remapCategoryBudgetCaches(scope, "Food", "Groceries");
  const freshLoad = store.loadCategoryBudgetsExact(scope, 10, 2026);
  await new Promise(resolve => setImmediate(resolve));
  finishOld({ error: null, data: [{ category: "Food", amount: 40 }] });
  await oldLoad;
  assert.deepEqual(store.readCategoryBudgetCache(10, 2026, scope), {});
  finishFresh({ error: null, data: [{ category: "Groceries", amount: 40 }] });
  assert.deepEqual((await freshLoad).value, { Groceries: 40 });
  assert.deepEqual(store.readCategoryBudgetCache(10, 2026, scope), { Groceries: 40 });
});

test("real store write and remote load preserve valid prototype-shaped category names", async () => {
  const { store } = storeHarness(null, [Promise.resolve({ error: null, data: [{ category: "__proto__", amount: 25 }, { category: "constructor", amount: 10 }] })]);
  const scope = { userId: "owner", budgetId: "prototype-category-budget" };
  const map = Object.fromEntries([["__proto__", 15], ["constructor", 10]]);
  store.writeCategoryBudgetCache(10, 2026, map, scope);
  assert.deepEqual(store.readCategoryBudgetCache(10, 2026, scope), map);
  assert.deepEqual((await store.loadCategoryBudgetsExact(scope, 10, 2026)).value, Object.fromEntries([["__proto__", 25], ["constructor", 10]]));
});

function screenSaveHarness() {
  const source = readFileSync("app/(tabs)/category-budget.tsx", "utf8");
  const body = source.slice(source.indexOf("  const persistBudgets ="), source.indexOf("  const saveDrafts ="));
  const state = { budgets: { Food: 25 } as Record<string, number>, saving: false, message: "", busyRef: { current: false }, scopeVersion: { current: 1 }, dirtyRef: { current: new Set(["Food"]) } };
  let resolveSave!: (result: { budgets: Record<string, number>; recurringCategories: string[] }) => void;
  let reject!: (error: Error) => void;
  let calls = 0;
  const promise = new Promise<{ budgets: Record<string, number>; recurringCategories: string[] }>((resolve, fail) => { resolveSave = resolve; reject = fail; });
  const bindings = {
    canEditHousehold: true, loadReady: true, busyRef: state.busyRef, scopeVersion: state.scopeVersion, dirtyRef: state.dirtyRef,
    budgetScope: { userId: "test-owner", householdId: "test-household", budgetId: "test-budget" }, month: 8, year: 2026,
    categoryBudgets: state.budgets, repeatChanges: true,
    changedCategoryBudgets: categoryBudgetRules.changedCategoryBudgets,
    assertFinancialMutationOnline: () => {},
    saveMonthlyCategoryBudgetChanges: () => { calls++; return promise; },
    setSaving: (value: boolean) => { state.saving = value; },
    setSaveMessage: (value: string) => { state.message = value; },
    setCategoryBudgets: (value: Record<string, number>) => { state.budgets = value; },
  };
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const save = new Function(...Object.keys(bindings), `${js}; return persistBudgets;`)(...Object.values(bindings));
  const finish = (result = { budgets: { Food: 200 } as Record<string, number>, recurringCategories: ["Food"] }) => resolveSave(result);
  return { state, save, finish, reject, calls: () => calls };
}
test("category screen guards rapid double save and waits for persistence before updating totals", async () => {
  const h = screenSaveHarness();
  const first = h.save({ Food: 200 });
  assert.equal(await h.save({ Food: 999 }), false);
  assert.equal(h.calls(), 1);
  assert.deepEqual(h.state.budgets, { Food: 25 });
  assert.equal(h.state.saving, true);
  h.finish();
  assert.equal(await first, true);
  assert.deepEqual(h.state.budgets, { Food: 200 });
  assert.equal(h.state.dirtyRef.current.size, 0);
  assert.equal(h.state.message, "Monthly budgets saved. They repeat from this month.");
});
test("category screen retains drafts after rejection and ignores another scope's completion", async () => {
  const failed = screenSaveHarness();
  const pending = failed.save({ Food: 200 });
  failed.reject(new Error("Offline"));
  assert.equal(await pending, false);
  assert.deepEqual(failed.state.budgets, { Food: 25 });
  assert.equal(failed.state.dirtyRef.current.has("Food"), true);
  assert.equal(failed.state.message, "Offline");
  const stale = screenSaveHarness();
  const old = stale.save({ Food: 200 });
  stale.state.scopeVersion.current++;
  stale.state.budgets = { Kids: 75 };
  stale.state.dirtyRef.current = new Set(["Kids"]);
  stale.state.message = "New household is ready.";
  stale.finish();
  assert.equal(await old, false);
  assert.deepEqual(stale.state.budgets, { Kids: 75 });
  assert.deepEqual([...stale.state.dirtyRef.current], ["Kids"]);
  assert.equal(stale.state.message, "New household is ready.");
});

test("atomic monthly saves send only edited categories and publish the canonical server plan", async () => {
  const scope = { userId: "test-owner", householdId: "test-household", budgetId: "atomic-budget" };
  const canonical = { budgets: { Food: 0, Rent: 175 }, recurringCategories: ["Food"] };
  const { store, operations, rpcCalls } = storeHarness(null, [], [{ error: null, data: canonical }]);
  store.writeCategoryBudgetCache(10, 2026, { Food: 25, Gas: 100, Rent: 100 }, scope);
  const result = await store.saveMonthlyCategoryBudgetChanges(scope, 10, 2026, { Food: 0, Gas: null }, false);
  assert.deepEqual(operations, ["rpc:save_monthly_category_budget_plan"]);
  assert.deepEqual(rpcCalls, [{ name: "save_monthly_category_budget_plan", args: {
    p_household_id: "test-household", p_budget_id: "atomic-budget", p_month: 10, p_year: 2026,
    p_changes: { Food: 0, Gas: null }, p_repeat: false,
  } }]);
  assert.deepEqual(result, canonical);
  assert.deepEqual(store.readCategoryBudgetCache(10, 2026, scope), canonical.budgets);
});

test("the existing household save wrapper uses its confirmed baseline and returns unrelated server edits", async () => {
  const scope = { userId: "owner", householdId: "house", budgetId: "wrapper-budget" };
  const baseline = { Food: 25, Gas: 100, Rent: 100 };
  const canonical = { budgets: { Food: 200, Rent: 175 }, recurringCategories: [] };
  const { store, operations, rpcCalls } = storeHarness(null, [], [{ error: null, data: canonical }]);
  store.writeCategoryBudgetCache(10, 2026, baseline, scope);
  const result = await store.saveCategoryBudgets(scope, 10, 2026, { Food: 200, Rent: 100 }, baseline);
  assert.deepEqual(operations, ["rpc:save_monthly_category_budget_plan"]);
  assert.deepEqual(rpcCalls[0]?.args.p_changes, { Food: 200, Gas: null });
  assert.equal(rpcCalls[0]?.args.p_repeat, false);
  assert.deepEqual(result, canonical.budgets);
  assert.deepEqual(store.readCategoryBudgetCache(10, 2026, scope), canonical.budgets);
});

test("recurring changes evict affected future caches without changing earlier months or another household", async () => {
  const scope = { userId: "owner", householdId: "house", budgetId: "recurring-budget" };
  const other = { userId: "owner", householdId: "other-house", budgetId: "other-recurring-budget" };
  const { store } = storeHarness(null, [], [{ error: null, data: { budgets: { Gas: 120 }, recurringCategories: ["Gas"] } }]);
  store.writeCategoryBudgetCache(9, 2026, { Gas: 100 }, scope);
  store.writeCategoryBudgetCache(10, 2026, { Gas: 100 }, scope);
  store.writeCategoryBudgetCache(11, 2026, { Gas: 100 }, scope);
  store.writeCategoryBudgetCache(0, 2027, { Gas: 100 }, scope);
  store.writeCategoryBudgetCache(11, 2026, { Gas: 77 }, other);
  await store.saveMonthlyCategoryBudgetChanges(scope, 10, 2026, { Gas: 120 }, true);
  assert.deepEqual(store.readCategoryBudgetCache(9, 2026, scope), { Gas: 100 });
  assert.equal(store.hasCategoryBudgetCache(9, 2026, scope), true);
  assert.deepEqual(store.readCategoryBudgetCache(10, 2026, scope), { Gas: 120 });
  assert.equal(store.hasCategoryBudgetCache(10, 2026, scope), true);
  assert.equal(store.hasCategoryBudgetCache(11, 2026, scope), false);
  assert.equal(store.hasCategoryBudgetCache(0, 2027, scope), false);
  assert.deepEqual(store.readCategoryBudgetCache(11, 2026, other), { Gas: 77 });
});

test("a one-month change keeps confirmed future caches and a failed recurring save evicts nothing", async () => {
  const scope = { userId: "owner", householdId: "house", budgetId: "future-cache-budget" };
  const oneMonth = storeHarness(null, [], [{ error: null, data: { budgets: { Gas: 80 }, recurringCategories: ["Gas"] } }]).store;
  oneMonth.writeCategoryBudgetCache(11, 2026, { Gas: 100 }, scope);
  await oneMonth.saveMonthlyCategoryBudgetChanges(scope, 10, 2026, { Gas: 80 }, false);
  assert.deepEqual(oneMonth.readCategoryBudgetCache(11, 2026, scope), { Gas: 100 });
  assert.equal(oneMonth.hasCategoryBudgetCache(11, 2026, scope), true);
  const failed = storeHarness("save_monthly_category_budget_plan").store;
  failed.writeCategoryBudgetCache(10, 2026, { Gas: 100 }, scope);
  failed.writeCategoryBudgetCache(11, 2026, { Gas: 100 }, scope);
  await assert.rejects(failed.saveMonthlyCategoryBudgetChanges(scope, 10, 2026, { Gas: 80 }, true), /test rejection/);
  assert.deepEqual(failed.readCategoryBudgetCache(10, 2026, scope), { Gas: 100 });
  assert.deepEqual(failed.readCategoryBudgetCache(11, 2026, scope), { Gas: 100 });
  assert.equal(failed.hasCategoryBudgetCache(11, 2026, scope), true);
});

test("a pre-change future load cannot republish an obsolete recurring allowance", async () => {
  let finishOld!: (value: unknown) => void;
  const oldResponse = new Promise(resolve => { finishOld = resolve; });
  const scope = { userId: "owner", householdId: "house", budgetId: "future-load-race" };
  const { store } = storeHarness(null, [], [
    oldResponse,
    { error: null, data: { budgets: { Gas: 120 }, recurringCategories: ["Gas"] } },
    { error: null, data: { budgets: { Gas: 120 }, recurringCategories: ["Gas"] } },
  ]);
  const oldLoad = store.loadCategoryBudgetsExact(scope, 11, 2026);
  await new Promise(resolve => setImmediate(resolve));
  await store.saveMonthlyCategoryBudgetChanges(scope, 10, 2026, { Gas: 120 }, true);
  finishOld({ error: null, data: { budgets: { Gas: 100 }, recurringCategories: ["Gas"] } });
  const stale = await oldLoad;
  assert.deepEqual(stale.value, {});
  assert.equal(stale.exact, false);
  assert.equal(store.hasCategoryBudgetCache(11, 2026, scope), false);
  assert.deepEqual((await store.loadCategoryBudgetsExact(scope, 11, 2026)).value, { Gas: 120 });
  assert.deepEqual(store.readCategoryBudgetCache(11, 2026, scope), { Gas: 120 });
});

test("malformed atomic save responses never replace a confirmed category plan", async () => {
  const scope = { userId: "owner", householdId: "house", budgetId: "malformed-budget" };
  for (const data of [null, { budgets: { Gas: -1 }, recurringCategories: [] }, { budgets: { Gas: 99 }, recurringCategories: [12] }]) {
    const { store } = storeHarness(null, [], [{ error: null, data }]);
    store.writeCategoryBudgetCache(10, 2026, { Gas: 100 }, scope);
    await assert.rejects(store.saveMonthlyCategoryBudgetChanges(scope, 10, 2026, { Gas: 99 }, true), /Could not confirm/);
    assert.deepEqual(store.readCategoryBudgetCache(10, 2026, scope), { Gas: 100 });
  }
});

test("category screen accepts server-confirmed unrelated changes instead of replacing them with its stale draft", async () => {
  const h = screenSaveHarness();
  const pending = h.save({ Food: 200 });
  h.finish({ budgets: { Food: 200, Rent: 175 }, recurringCategories: ["Food"] });
  assert.equal(await pending, true);
  assert.deepEqual(h.state.budgets, { Food: 200, Rent: 175 });
});
