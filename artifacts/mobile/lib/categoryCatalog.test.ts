import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind } from "typescript";
import {
  DEFAULT_CATEGORIES, assertCategoryEditable, assertCategoryName, categoryMatches, categorySaveIntent, type CategorySaveIntent,
  fallbackCategoryList, normalizeCategoryInput, remapCategoryBudgetMap,
  remapCategoryDrafts, remapTransactionCategory,
} from "./categoryCatalog";
import { parseCategoryBudgetCache } from "./categoryBudgetLoadPolicy";
import { parseCategoryAssignments } from "./moneyFormInput";

test("saved catalog and cache do not resurrect a renamed or deleted starter category", () => {
  const renamed = DEFAULT_CATEGORIES.map(name => name === "Groceries" ? "Family groceries" : name);
  const removed = renamed.filter(name => name !== "Utilities");
  for (const saved of [removed, fallbackCategoryList(removed), JSON.parse(JSON.stringify(removed))]) {
    const loaded = fallbackCategoryList(saved);
    assert(!loaded.includes("Food")); assert(!loaded.includes("Utilities")); assert(!loaded.includes("Groceries"));
    assert(loaded.includes("Family groceries")); assert(loaded.includes("Restaurant"));
    for (const name of ["Other", "Debt", "Savings"]) assert(loaded.includes(name));
  }
  assert.deepEqual(fallbackCategoryList([]), ["Savings", "Debt", "Other"]);
});

test("starter categories separate groceries and restaurants without changing saved Food catalogs", () => {
  assert(DEFAULT_CATEGORIES.includes("Groceries"));
  assert(DEFAULT_CATEGORIES.includes("Restaurant"));
  assert(!DEFAULT_CATEGORIES.includes("Food"));
  const legacy = ["Food", "Family", "Other"];
  assert.deepEqual(fallbackCategoryList(legacy), ["Food", "Family", "Other", "Savings", "Debt"]);
  assert.deepEqual(legacy, ["Food", "Family", "Other"]);
  assert(!fallbackCategoryList(legacy).includes("Groceries"));
  assert(!fallbackCategoryList(legacy).includes("Restaurant"));
});

test("ordinary starter names are editable while financial sentinel names are protected", () => {
  for (const name of DEFAULT_CATEGORIES.filter(name => !["Other", "Debt", "Savings"].includes(name))) {
    assert.doesNotThrow(() => assertCategoryEditable(name));
  }
  for (const name of ["other", " Debt ", "Savings", "Income", "Transfer"]) assert.throws(() => assertCategoryEditable(name), /stays available/);
  for (const name of ["", " ", "x".repeat(81), "income", " Transfer "]) assert.throws(() => assertCategoryName(name));
  assert.doesNotThrow(() => assertCategoryName("Family groceries"));
  assert.equal(normalizeCategoryInput("  Family   groceries  "), "Family groceries");
});

test("current and soft-deleted transaction labels remap without changing financial or allocation identities", () => {
  const transaction = {
    id: "split", date: "2026-11-04", amount: -80, category: "Other", deleted_at: "2026-11-04",
    review_status: "matched", linked_bill_id: "bill", transfer_group_id: null,
    review_allocations: [{ type: "category", category: " FOOD ", amount: 30, targetId: "a" }, { type: "bill", category: "Utilities", amount: 50, targetId: "b" }],
  };
  const original = structuredClone(transaction);
  const renamed = remapTransactionCategory(transaction, "Food", "Groceries");
  assert.equal(renamed.category, "Other");
  assert.equal(renamed.review_allocations[0].category, "Groceries");
  assert.deepEqual(renamed, { ...original, review_allocations: [{ ...original.review_allocations[0], category: "Groceries" }, original.review_allocations[1]] });
  assert.deepEqual(transaction, original);
  assert.equal(remapTransactionCategory(transaction, "Absent", "Anything"), transaction);
});

test("category assignment merges preserve cents and valid prototype-shaped names", () => {
  const input = Object.fromEntries([["Food", 12.34], ["Groceries", 20.01], ["constructor", 4], ["__proto__", 3]]);
  const merged = remapCategoryBudgetMap(input, "Food", "Groceries");
  assert.deepEqual(Object.entries(merged), [["Groceries", 32.35], ["constructor", 4], ["__proto__", 3]]);
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal(merged.__proto__, 3);
  assert.deepEqual(parseCategoryBudgetCache(JSON.stringify(merged)), merged);
  assert.deepEqual(parseCategoryAssignments(Object.fromEntries([["__proto__", "15"]])), Object.fromEntries([["__proto__", 15]]));
});

test("unsaved assignment drafts move with renamed or merged labels, including invalid text", () => {
  assert.deepEqual(remapCategoryDrafts({ Food: "25", Groceries: "30", Rent: "" }, "Food", "Groceries"), { Groceries: "55", Rent: "" });
  assert.deepEqual(remapCategoryDrafts({ Food: "bad", Groceries: "30" }, "Food", "Groceries"), { Groceries: "bad + 30" });
  assert.deepEqual(remapCategoryDrafts(Object.fromEntries([["Food", "25"]]), "Food", "constructor"), { constructor: "25" });
});

function mutationHarness(demo = false) {
  const source = readFileSync("context/BudgetContext.tsx", "utf8");
  const state = {
    categories: [...DEFAULT_CATEGORIES, "Food"], bills: [{ id: "bill", category: "Food", amount: 30 }],
    transactions: [{ id: "active", category: "Food", amount: -20, review_allocations: [{ type: "category", category: "Food", amount: 20 }] }],
    deleted: [{ id: "deleted", category: "Other", amount: -10, review_allocations: [{ type: "category", category: "Food", amount: 10 }] }],
  };
  const userScope = { current: "actor" }, scope = { current: { householdId: "house", budgetId: "budget" } };
  const saveIntentTokensRef = { current: new Map<string, CategorySaveIntent>() };
  const calls: Array<{ name: string; payload: Record<string, string> }> = [], remaps: unknown[][] = [];
  let failure = false, resolveGate: (() => void) | undefined;
  const parseBody = source.slice(source.indexOf("function parseCategoryMutationResult("), source.indexOf("const diagnosticPlatform"));
  const parse = new Function("normalizeCategoryInput", "fallbackCategoryList", `${transpileModule(parseBody, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText};return parseCategoryMutationResult;`)(normalizeCategoryInput, fallbackCategoryList);
  const bind = {
    user: { id: "actor" }, userScopeIdRef: userScope, householdScopeRef: scope,
    categories: state.categories, demoMode: demo, useCallback: (fn: unknown) => fn,
    assertCanEditHousehold: () => {}, assertCategoryName, assertCategoryEditable,
    normalizeCategoryInput, categoryMatches, fallbackCategoryList, remapTransactionCategory,
    parseCategoryMutationResult: parse,
    setCategories: (value: string[] | ((current: string[]) => string[])) => { state.categories = typeof value === "function" ? value(state.categories) : value; },
    setBills: (fn: (current: typeof state.bills) => typeof state.bills) => { state.bills = fn(state.bills); },
    setTransactions: (fn: (current: typeof state.transactions) => typeof state.transactions) => { state.transactions = fn(state.transactions); },
    setDeletedTransactions: (fn: (current: typeof state.deleted) => typeof state.deleted) => { state.deleted = fn(state.deleted); },
    remapCategoryBudgetCaches: (...args: unknown[]) => remaps.push(args),
    categorySaveIntent, saveIntentTokensRef, reconcileCategorySaveFailures() {},
    runTrackedFinancialMutation: async (fn: () => Promise<void>, _retry: unknown, intent: CategorySaveIntent) => { saveIntentTokensRef.current.set(intent.key, intent); return fn(); },
    supabase: { rpc: async (name: string, payload: Record<string, string>) => {
      calls.push({ name, payload });
      if (resolveGate) await new Promise<void>(resolve => { resolveGate = resolve; });
      if (failure) return { error: { message: "Fixture save failed" }, data: null };
      const old = payload.p_old_name ?? payload.p_name;
      const target = name.startsWith("delete") ? "Other" : payload.p_new_name ?? payload.p_name;
      const categories = name.startsWith("add") ? [...state.categories, target]
        : name.startsWith("rename") ? state.categories.map(name => categoryMatches(name, old) ? target : name)
        : state.categories.filter(name => !categoryMatches(name, old));
      return { error: null, data: { categoryName: target, categories } };
    } },
  };
  const body = source.slice(source.indexOf("  const addCategory ="), source.indexOf("  // ─── Settings", source.indexOf("  const addCategory =")));
  const actions = new Function(...Object.keys(bind), `${transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText};return {addCategory,updateCategory,deleteCategory};`)(...Object.values(bind));
  return { state, calls, remaps, scope, actions, fail: () => { failure = true; }, hold: () => { resolveGate = () => {}; }, release: () => resolveGate?.() };
}

for (const demo of [false, true]) test(`actual category callbacks rename and delete defaults without losing records (${demo ? "demo" : "saved"})`, async () => {
  const h = mutationHarness(demo);
  await h.actions.updateCategory("Food", "Groceries");
  assert(!h.state.categories.includes("Food")); assert(h.state.categories.includes("Groceries"));
  assert.equal(h.state.bills[0].category, "Groceries");
  assert.equal(h.state.transactions[0].review_allocations[0].category, "Groceries");
  assert.equal(h.state.deleted[0].review_allocations[0].category, "Groceries");
  await h.actions.deleteCategory("Groceries");
  assert(!h.state.categories.includes("Groceries"));
  assert.equal(h.state.bills[0].category, "Other");
  assert.equal(h.state.transactions[0].category, "Other");
  assert.equal(h.state.deleted[0].review_allocations[0].category, "Other");
  assert.equal(h.state.transactions[0].amount, -20); assert.equal(h.state.deleted[0].amount, -10);
  assert.equal(h.remaps.length, 2); assert.equal(h.calls.length, demo ? 0 : 2);
  if (!demo) assert.deepEqual(h.calls[0], { name: "rename_household_category", payload: { p_household_id: "house", p_budget_id: "budget", p_old_name: "Food", p_new_name: "Groceries" } });
});

test("rejected or previous-household category saves never publish unconfirmed labels or cached assignment moves", async () => {
  const failed = mutationHarness(); failed.fail(); const before = structuredClone(failed.state);
  await assert.rejects(failed.actions.updateCategory("Food", "Groceries"), /Fixture save failed/);
  assert.deepEqual(failed.state, before); assert.deepEqual(failed.remaps, []);
  const stale = mutationHarness(); stale.hold(); const pending = stale.actions.updateCategory("Food", "Groceries");
  stale.scope.current = { householdId: "other-house", budgetId: "other-budget" }; stale.release(); await pending;
  assert(stale.state.categories.includes("Food")); assert.deepEqual(stale.remaps, []);
});

test("direct protected-source and reserved-target attempts stop before any RPC or local mutation", async () => {
  for (const name of ["Other", "Debt", "Savings", "Income", "Transfer"]) {
    const h = mutationHarness(); const before = structuredClone(h.state);
    await assert.rejects(h.actions.deleteCategory(name));
    await assert.rejects(h.actions.updateCategory(name, "Anything"));
    assert.deepEqual(h.calls, []); assert.deepEqual(h.state, before);
  }
  for (const target of ["Income", "Transfer"]) {
    const h = mutationHarness(); await assert.rejects(h.actions.addCategory(target));
    await assert.rejects(h.actions.updateCategory("Food", target)); assert.deepEqual(h.calls, []);
  }
});

test("category rename requires an explicit save, so pressing cancel cannot trigger a blur save", () => {
  const source = readFileSync("app/(tabs)/more.tsx", "utf8");
  const input = source.slice(source.indexOf("{renamingCategory === cat ? ("), source.indexOf("accessibilityLabel=\"Save category name\""));
  assert.doesNotMatch(input, /onBlur/);
  assert.match(source, /accessibilityLabel="Cancel category rename"/);
});

function deleteConfirmationHarness() {
  const source = readFileSync("app/(tabs)/more.tsx", "utf8");
  const body = source.slice(source.indexOf("  const handleDeleteCategory ="), source.indexOf("  const openAccount ="));
  const scope = { current: "actor:house-a:budget-a" }, busy = { current: false };
  const calls: string[] = [], errors: unknown[] = [];
  let confirmation: { onConfirm: () => Promise<void> } | undefined;
  let finish: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  let held = false;
  const bindings = {
    categoryScopeKey: "actor:house-a:budget-a", categoryScopeKeyRef: scope,
    categoryMutationInFlightRef: busy, categoryMatches, bills: [], transactions: [],
    setCategorySaveBusy() {},
    Haptics: { impactAsync() {}, ImpactFeedbackStyle: { Medium: 1 } },
    privacyFormError: (...args: unknown[]) => errors.push(args),
    confirmAction: (value: { onConfirm: () => Promise<void> }) => { confirmation = value; },
    deleteCategory: async (name: string) => {
      calls.push(name);
      if (held) await new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
    },
  };
  const action = new Function(...Object.keys(bindings), `${transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText};return handleDeleteCategory;`)(...Object.values(bindings));
  return { action, scope, busy, calls, errors, confirm: () => confirmation!.onConfirm(), hold: () => { held = true; }, finish: () => finish?.(), reject: () => reject?.(new Error("old household failure")) };
}

test("a delete confirmation captured in one household cannot delete the same category after switching", async () => {
  const h = deleteConfirmationHarness(); h.action("Food");
  h.scope.current = "actor:house-b:budget-b";
  await h.confirm(); assert.deepEqual(h.calls, []); assert.equal(h.busy.current, false);
});

test("a previous-household save keeps its lock until completion and cannot show errors in the new household", async () => {
  const h = deleteConfirmationHarness(); h.action("Food"); h.hold(); const pending = h.confirm();
  assert.equal(h.busy.current, true);
  h.scope.current = "actor:house-b:budget-b";
  h.action("Food"); assert.equal(h.calls.length, 1);
  h.reject(); await pending;
  assert.equal(h.busy.current, false); assert.deepEqual(h.errors, []);
});
