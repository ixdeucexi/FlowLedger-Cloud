import { normalizePlannedTransferData } from "./plannedAccountTransfers";
import {mergeAccountNameRead} from "./accountNameMetadata";
import { mergeHouseholdNameRead } from "./householdNames";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as projectionInput from "./financialProjectionInput";
import { canonicalConnectedAccounts, pendingPlaidActivityWithBalanceHolds, summarizePendingCheckingActivity, type PendingPlaidActivityRow, type PlaidAccountIdentityRow } from "./plaidActivity";
import { localDateInTimeZone } from "./dailyCheckingClose";
import { fallbackCategoryList } from "./categoryCatalog";

import {
  budgetPlanCacheCanHydrateBeforeMembership,
  budgetPlanCacheKey,
  budgetPlanCacheWriteMatchesHydratedRecord,
  clearBudgetPlanCachesForUser,
  parseBudgetPlanCache,
  readBudgetPlanCache,
  type BudgetPlanCacheRecord,
  writeBudgetPlanCache,
} from "./budgetPlanCache";

function record(overrides: Partial<BudgetPlanCacheRecord> = {}): BudgetPlanCacheRecord {
  const household = {
    householdId: "household-a",
    budgetId: "budget-a",
    name: "Personal",
    isPersonal: true,
    role: "owner" as const,
  };
  return {
    version: 1,
    userId: "user-a",
    household,
    households: [household],
    savedAt: "2026-08-28T02:00:00.000Z",
    dataUpdatedAt: "2026-08-28T01:59:59.000Z",
    data: {
      plannedAccountTransfers: [], plannedTransferOccurrences: [],
      bills: [{ id: "bill-1" }],
      overrides: [],
      billDateMoves: [],
      transactions: [{ id: "tx-1" }],
      deletedTransactions: [],
      pendingBankTransactions: [],
      pendingPlanMatches: [],
      incomes: [],
      goals: [],
      extraPayments: [],
      categories: ["Bills"],
      accounts: [],
      connectedBankAccounts: [],
      dailyCheckingCloses: [],
      householdTimeZone: "America/Chicago",
      transactionAccountIdentities: [],
      decisions: [],
      settings: { onboarding_completed: true },
    },
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key: string) { return values.get(key) ?? null; },
    async setItem(key: string, value: string) { values.set(key, value); },
    async removeItem(key: string) { values.delete(key); },
    async getAllKeys() { return [...values.keys()]; },
    async multiRemove(keys: readonly string[]) { keys.forEach(key => values.delete(key)); },
  };
}

test("a verified plan snapshot round-trips only for its exact user and household", async () => {
  const storage = memoryStorage();
  const cached = record();
  assert.equal(await writeBudgetPlanCache(cached, storage), true);
  assert.deepEqual(await readBudgetPlanCache("user-a", "household-a", storage), cached);
  assert.equal(await readBudgetPlanCache("user-b", "household-a", storage), null);
  assert.equal(parseBudgetPlanCache(JSON.stringify(cached), "user-a", "household-b"), null);
});

test("only a personal owner cache can hydrate before live membership verification", () => {
  assert.equal(budgetPlanCacheCanHydrateBeforeMembership(record()), true);
  assert.equal(budgetPlanCacheCanHydrateBeforeMembership(record({
    household: { ...record().household, isPersonal: false, role: "editor" },
  })), false);
});

test("an exact hydrated record suppresses only its redundant first rewrite", () => {
  const hydrated = {
    scopeKey: "user-a:household-a",
    dataUpdatedAt: "2026-08-28T01:59:59.000Z",
  };
  assert.equal(budgetPlanCacheWriteMatchesHydratedRecord(hydrated, { ...hydrated }), true);
  assert.equal(budgetPlanCacheWriteMatchesHydratedRecord(hydrated, {
    ...hydrated,
    dataUpdatedAt: "2026-08-28T02:01:00.000Z",
  }), false);
  assert.equal(budgetPlanCacheWriteMatchesHydratedRecord(hydrated, {
    ...hydrated,
    scopeKey: "user-a:household-b",
  }), false);
  assert.equal(budgetPlanCacheWriteMatchesHydratedRecord(null, hydrated), false);
  assert.equal(
    budgetPlanCacheWriteMatchesHydratedRecord(hydrated, { ...hydrated }, false),
    false,
    "changed secondary cache content must be persisted even when freshness is unchanged",
  );
});

test("corrupt, future, and structurally incomplete snapshots fail closed", () => {
  const cached = record();
  assert.equal(parseBudgetPlanCache("not-json", "user-a", "household-a"), null);
  assert.equal(parseBudgetPlanCache(JSON.stringify({ ...cached, data: {} }), "user-a", "household-a"), null);
  assert.equal(parseBudgetPlanCache(JSON.stringify({
    ...cached,
    data: { ...cached.data, transactions: [null] },
  }), "user-a", "household-a"), null);
  assert.equal(parseBudgetPlanCache(JSON.stringify({
    ...cached,
    savedAt: "2026-08-29T00:00:00.000Z",
  }), "user-a", "household-a", Date.parse("2026-08-28T00:00:00.000Z")), null);
  assert.equal(parseBudgetPlanCache(JSON.stringify({
    ...cached,
    dataUpdatedAt: "2026-08-29T00:00:00.000Z",
  }), "user-a", "household-a", Date.parse("2026-08-28T00:00:00.000Z")), null);
});

test("sign-out cleanup removes only the matching user's plan snapshots", async () => {
  const storage = memoryStorage();
  storage.values.set(budgetPlanCacheKey("user-a", "household-a"), "a");
  storage.values.set(budgetPlanCacheKey("user-b", "household-b"), "b");
  storage.values.set("unrelated", "keep");
  await clearBudgetPlanCachesForUser("user-a", storage);
  assert.deepEqual([...storage.values.keys()].sort(), [
    budgetPlanCacheKey("user-b", "household-b"),
    "unrelated",
  ].sort());
});

test("startup hydrates an exact cached plan before awaiting the financial core", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const auth = readFileSync("context/AuthContext.tsx", "utf8");
  const loadStart = context.indexOf("const cachedPlanRequest");
  const coreStart = context.indexOf("const coreQueryKey", loadStart);
  const startup = context.slice(loadStart, coreStart);

  assert.ok(loadStart >= 0 && coreStart > loadStart);
  assert.match(startup, /const scopeRequest = withLoadTimeout/);
  assert.match(startup, /budgetPlanCacheCanHydrateBeforeMembership\(cachedPlan\)/);
  assert.match(startup, /hydrateBudgetPlanCache\(cachedPlan\)/);
  assert.match(
    startup,
    /const resolvedScope = await scopeRequest;[\s\S]+hydrateBudgetPlanCache\([\s\S]+householdsRef\.current/,
  );
  assert.match(context, /!categoriesReady[\s\S]+writeBudgetPlanCache\(cache\)/);
  assert.match(context, /hydratedWrite\.activeHousehold[\s\S]+hydratedWrite\.households[\s\S]+hydratedWrite\.categories[\s\S]+hydratedWrite\.dailyCheckingCloses/);
  assert.match(context, /activeHousehold: cache\.household,[\s\S]+households: cache\.households/);
  assert.doesNotMatch(context, /activeHousehold: nextHousehold,[\s\S]+households: nextHouseholds/);
  assert.match(context, /budgetPlanCacheWriteMatchesHydratedRecord\([\s\S]+hydratedContentUnchanged[\s\S]+planCacheHydrationWriteSkipRef\.current = null/);
  assert.match(context, /scheduleBudgetBackgroundWork\([\s\S]+writeBudgetPlanCache\(cache\)/);
  assert.match(auth, /await clearBudgetPlanCachesForUser\(signedOutUserId\)/);
});

function hydrateActualCallback(cache: BudgetPlanCacheRecord, actor = cache.userId, household = cache.household) {
  const source = readFileSync("context/BudgetContext.tsx", "utf8");
  const ast = ts.createSourceFile("BudgetContext.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "hydrateBudgetPlanCache"
      && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(callback, "the actual provider cache hydration callback must exist");
  const compiled = ts.transpileModule(`const hydrate = ${callback.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const expression = compiled.slice(compiled.indexOf("=") + 1).trim().replace(/;\s*$/, "");
  const state = {
    calls: [] as Array<{ name: string; value: unknown }>,
    pending: [] as PendingPlaidActivityRow[],
    connected: [] as PlaidAccountIdentityRow[],
    dataUpdatedAt: "",
  };
  const dependencies: Record<string, any> = {
    normalizePlannedTransferData, publishPlannedTransferData: (data:unknown, scope:string) => state.calls.push({name:"plannedTransfers",value:{data,scope}}),
    ...projectionInput, mergeAccountNameRead, accountNameIntentsRef: {current: []}, mergeHouseholdNameRead, householdNameIntentsRef: {current: []}, canonicalConnectedAccounts, pendingPlaidActivityWithBalanceHolds, localDateInTimeZone, fallbackCategoryList,
    DEFAULT_SETTINGS: {}, canonicalDebtPaymentMethod: (value: unknown) => value,
    reorderDebtPriorities: (rows: unknown[]) => rows, normalizeDailyCheckingCloseRows: (rows: unknown[]) => rows,
    reuseStructurallyEqualFinancialValue: (_previous: unknown, next: unknown) => next, isValidExtraPaymentPlan: () => true,
    financialDataUserIdRef: { current: actor }, planCacheHydrationWriteSkipRef: { current: null },
    householdsRef: { current: [] }, overridesRef: { current: [] }, billDateMovesRef: { current: [] },
    accountsRef: { current: [] }, authoritativeAccountsByIdRef: { current: new Map() },
    connectedBankAccountsRef: { current: [] }, transactionAccountIdentitiesRef: { current: [] },
    settingsRef: { current: {} }, authoritativeSettingsByScopeRef: { current: new Map() },
    lastPlanRefreshAtRef: { current: 0 }, loaded: { current: false },
    replaceActiveHouseholdScope: (value: unknown) => state.calls.push({ name: "scope", value }),
    updateStartupCoreReadyScopeKey: (value: unknown) => state.calls.push({ name: "ready", value }),
  };
  const setters = ["setHouseholds", "setBills", "setOverrides", "setBillDateMoves", "setTransactions", "setDeletedTransactions",
    "setPendingBankTransactions", "setPendingPlanMatches", "setIncomes", "setGoals", "setExtraPayments", "setCategories", "setCategoriesReadyScopeKey",
    "setAccounts", "setConnectedBankAccounts", "setTransactionAccountIdentities", "setDailyCheckingCloses", "setDailyCheckingCloseLoad", "setHouseholdTimeZone",
    "setDecisions", "setSettings", "setDataUpdatedAt", "setLoadError", "setLoading"];
  for (const name of setters) dependencies[name] = (value: any) => {
    const next = typeof value === "function" ? value([]) : value;
    state.calls.push({ name, value: next });
    if (name === "setPendingBankTransactions") state.pending = next;
    if (name === "setConnectedBankAccounts") state.connected = next;
    if (name === "setDataUpdatedAt") state.dataUpdatedAt = next;
  };
  const hydrate = new Function("dependencies", `with (dependencies) { return (${expression}); }`)(dependencies);
  return { result: hydrate(cache, household), state, dependencies };
}

test("actual cache hydration rebuilds old inferred holds without advancing financial freshness", () => {
  for (const scenario of [
    { available: 900, amounts: [-40, -60], expectedAvailable: 900, expectedOutflow: 100, expectedCount: 2 },
    { available: null, amounts: [-25, 10], expectedAvailable: 985, expectedOutflow: 25, expectedCount: 2 },
    { available: 900, amounts: [-40], expectedAvailable: 900, expectedOutflow: 100, expectedCount: 2 },
  ]) {
    const cached = record();
    const bank = { id: "checking", plaid_account_id: "provider", name: "Checking", account_type: "depository", account_subtype: "checking",
      current_balance: 1000, available_balance: scenario.available, is_active: true, updated_at: "2026-08-27T20:30:00.000Z" };
    cached.data.bills = []; cached.data.transactions = [];
    cached.data.connectedBankAccounts = [{ ...bank }]; cached.data.transactionAccountIdentities = [{ ...bank }];
    cached.data.pendingBankTransactions = scenario.amounts.map((amount, index) => ({ plaid_transaction_id: `real-${index}`,
      plaid_account_id: bank.id, amount, transaction_date: "2026-08-27", name: "Real bank activity" }));
    cached.data.pendingBankTransactions.push({ plaid_transaction_id: "pending-hold:checking:1000.00", plaid_account_id: bank.id,
      amount: -1000, transaction_date: "2026-08-26", name: "Pending bank hold" });
    const before = JSON.stringify(cached);
    const hydrated = hydrateActualCallback(cached);
    assert.equal(hydrated.result, true);
    const summary = summarizePendingCheckingActivity(hydrated.state.pending, hydrated.state.connected);
    assert.equal(summary?.availableBalance, scenario.expectedAvailable);
    assert.equal(summary?.pendingOutflow, scenario.expectedOutflow);
    assert.equal(summary?.pendingCount, scenario.expectedCount);
    assert.equal(hydrated.state.dataUpdatedAt, cached.dataUpdatedAt);
    assert.equal(hydrated.dependencies.lastPlanRefreshAtRef.current, Date.parse(cached.dataUpdatedAt));
    assert.equal(hydrated.state.connected[0].updated_at, bank.updated_at);
    const regenerated = hydrated.state.pending.find(row => row.plaid_transaction_id.startsWith("pending-hold:"));
    if (regenerated) assert.equal(regenerated.transaction_date, "2026-08-27", "derived hold retains the cached observation's household date");
    assert.equal(JSON.stringify(cached), before);
  }
});

test("actual cache hydration rejects foreign scope and invalid observation dates before changing state", () => {
  const cached = record();
  for (const hydrated of [
    hydrateActualCallback(cached, "other-user"),
    hydrateActualCallback(cached, cached.userId, { ...cached.household, householdId: "other-household" }),
    hydrateActualCallback({ ...cached, data: { ...cached.data, householdTimeZone: "Invalid/Zone" } }),
    hydrateActualCallback({ ...cached, dataUpdatedAt: "invalid" }),
  ]) {
    assert.equal(hydrated.result, false);
    assert.deepEqual(hydrated.state.calls, []);
    assert.equal(hydrated.dependencies.loaded.current, false);
  }
});

test("unknown bank current balances survive normalization and cache hydration while a verified zero stays known", () => {
  for (const current of [null, 0]) {
    const bank = { id: "checking", plaid_account_id: "provider", name: "Checking", account_type: "depository", account_subtype: "checking",
      current_balance: current, available_balance: 0, is_active: true, updated_at: "2026-08-27T20:30:00.000Z" };
    const normalized = projectionInput.normalizeConnectedBankRows([bank]);
    const roundTrip = projectionInput.normalizeConnectedBankRows(JSON.parse(JSON.stringify(normalized)));
    assert.equal(roundTrip[0].current_balance, 0);
    assert.equal(roundTrip[0].current_balance_available, current !== null);
    const cached = record(); cached.data.bills = []; cached.data.transactions = [];
    cached.data.connectedBankAccounts = JSON.parse(JSON.stringify(normalized));
    cached.data.transactionAccountIdentities = JSON.parse(JSON.stringify(normalized));
    const hydrated = hydrateActualCallback(cached);
    assert.equal(hydrated.result, true);
    assert.equal(hydrated.state.connected[0].current_balance_available, current !== null);
    assert.equal(hydrated.state.connected[0].updated_at, bank.updated_at);
    assert.equal(hydrated.state.dataUpdatedAt, cached.dataUpdatedAt);
    const summary = summarizePendingCheckingActivity(hydrated.state.pending, hydrated.state.connected);
    if (current === null) assert.equal(summary, null);
    else assert.equal(summary?.currentBalance, 0);
  }
});
