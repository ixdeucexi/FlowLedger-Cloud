import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind } from "typescript";
import { createExactCategoryBudgetMemoryCache, parseCategoryBudgetCache, resolveGuardedRemoteValue } from "./categoryBudgetLoadPolicy";

function storeHarness(failAt: string | null) {
  const source = readFileSync("lib/categoryBudgetStore.ts", "utf8");
  const exported: any = {};
  const operations: string[] = [];
  const query = (kind: string) => {
    const result: any = {
      eq: () => result, in: () => result,
      then: (resolve: (value: unknown) => void) => {
        operations.push(kind);
        resolve({ error: failAt === kind ? { message: "test rejection" } : null, data: kind === "select" ? [{ category: "Removed" }] : null });
      },
    };
    return result;
  };
  const mockRequire = (id: string) => {
    if (id === "react-native") return { Platform: { OS: "android" } };
    if (id.endsWith("/supabase")) return { supabase: { from: () => ({ upsert: () => query("upsert"), select: () => query("select"), delete: () => query("delete") }) } };
    if (id.endsWith("/networkStatus")) return { assertFinancialMutationOnline: () => {} };
    if (id.endsWith("/categoryBudgetLoadPolicy")) return { createExactCategoryBudgetMemoryCache, parseCategoryBudgetCache, resolveGuardedRemoteValue };
    throw new Error(id);
  };
  new Function("exports", "require", transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText)(exported, mockRequire);
  return { store: exported, operations };
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

function screenSaveHarness() {
  const source = readFileSync("app/(tabs)/category-budget.tsx", "utf8");
  const body = source.slice(source.indexOf("  const persistBudgets ="), source.indexOf("  const saveDrafts ="));
  const state = { budgets: { Food: 25 }, saving: false, message: "", busyRef: { current: false }, scopeVersion: { current: 1 }, dirtyRef: { current: new Set(["Food"]) } };
  let finish!: () => void;
  let reject!: (error: Error) => void;
  let calls = 0;
  const promise = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
  const bindings = {
    canEditHousehold: true, loadReady: true, busyRef: state.busyRef, scopeVersion: state.scopeVersion, dirtyRef: state.dirtyRef,
    budgetScope: { userId: "test-owner" }, month: 8, year: 2026,
    assertFinancialMutationOnline: () => {},
    saveCategoryBudgets: () => { calls++; return promise; },
    setSaving: (value: boolean) => { state.saving = value; },
    setSaveMessage: (value: string) => { state.message = value; },
    setCategoryBudgets: (value: { Food: number }) => { state.budgets = value; },
  };
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const save = new Function(...Object.keys(bindings), `${js}; return persistBudgets;`)(...Object.values(bindings));
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
  assert.equal(h.state.message, "Assignments saved.");
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
  stale.finish();
  assert.equal(await old, false);
  assert.deepEqual(stale.state.budgets, { Food: 25 });
});
