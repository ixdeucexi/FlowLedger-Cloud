import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
