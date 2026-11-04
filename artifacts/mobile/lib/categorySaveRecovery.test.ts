import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { categoryFailureIsResolved, categorySaveIntent, type CategorySaveIntent } from "./categoryCatalog";
import { assertFinancialMutationScope, runRecoverableFinancialMutation, runSingleFlight } from "./financialMutationRecovery";

function recoveryHarness() {
  const source = readFileSync("context/BudgetContext.tsx", "utf8");
  const body = source.slice(source.indexOf("  const markSaveStarted ="), source.indexOf("  const clearSaveError ="));
  const state = { status: "idle", error: null as string | null, clears: 0 };
  const ref = <T,>(current: T) => ({ current });
  const bindings = {
    useCallback: (fn: unknown) => fn, user: { id: "actor" },
    setSaveStatus: (value: string) => { state.status = value; },
    setSaveError: (value: string | null) => { state.error = value; }, setDataUpdatedAt() {},
    clearScopedFinancialData: () => { state.clears++; },
    saveOperationSequenceRef: ref(0), saveLifecycleGenerationRef: ref(1),
    saveGenerationByOperationRef: ref(new Map()), activeSaveOperationsRef: ref(new Set()),
    failedSaveOperationRef: ref<number | null>(null), failedSaveOperationsRef: ref(new Map()),
    retryParentByOperationRef: ref(new Map()), retryingSaveFailureRef: ref<number | null>(null),
    saveIntentByOperationRef: ref(new Map()), saveIntentTokensRef: ref(new Map()),
    retrySaveRef: ref<null | (() => Promise<void>)>(null), retrySavePromiseRef: ref<Promise<void> | null>(null),
    saveStatusTimerRef: ref<number | null>(null),
    userScopeIdRef: ref<string | null>("actor"), householdScopeRef: ref({ householdId: "house", budgetId: "budget" }),
    assertFinancialMutationScope, runRecoverableFinancialMutation, runSingleFlight, categoryFailureIsResolved,
    setTimeout: () => 1, clearTimeout() {},
    recordDiagnostic: async () => {}, diagnosticPlatform: () => "web", diagnosticErrorCode: () => "fixture",
  };
  const actions = new Function(...Object.keys(bindings), `${transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 } }).outputText};return {markSaveStarted,markSaveCompleted,markSaveFailed,runTrackedFinancialMutation,reconcileCategorySaveFailures,retryLastSave};`)(...Object.values(bindings));
  const intent = (source = "Food", action: CategorySaveIntent["action"] = "rename") => categorySaveIntent("actor", "house", "budget", source, action);
  return { state, actions, bindings, intent };
}

async function failCategory(h: ReturnType<typeof recoveryHarness>, intent: CategorySaveIntent) {
  let writes = 0;
  const retry = () => h.actions.runTrackedFinancialMutation(async () => { writes++; }, retry, intent);
  await assert.rejects(h.actions.runTrackedFinancialMutation(async () => { throw Error(`${intent.sourceName} save failed`); }, retry, intent));
  const failure = [...h.bindings.failedSaveOperationsRef.current.values()].find(value => value.intent?.key === intent.key);
  return { callback: failure.retry as () => Promise<void>, writes: () => writes };
}

test("an explicit successful category retry clears its failure and captured callback", async () => {
  const h = recoveryHarness(), intent = h.intent();
  const previous = await failCategory(h, intent);
  const replacement = h.intent();
  await h.actions.runTrackedFinancialMutation(async () => {}, async () => {}, replacement);
  assert.equal(h.state.status, "saved"); assert.equal(h.state.error, null);
  assert.equal(h.bindings.failedSaveOperationsRef.current.size, 0);
  assert.equal(h.bindings.retrySaveRef.current, null);
  await previous.callback(); assert.equal(previous.writes(), 0);
});

for (const billFirst of [true, false]) test(`category recovery preserves an unrelated bill failure (${billFirst ? "bill first" : "category first"})`, async () => {
  const h = recoveryHarness();
  const failBill = () => {
    const id = h.actions.markSaveStarted();
    h.actions.markSaveFailed(Error("Bill save failed"), async () => {}, id);
  };
  if (billFirst) failBill();
  await failCategory(h, h.intent());
  if (!billFirst) failBill();
  await h.actions.runTrackedFinancialMutation(async () => {}, async () => {}, h.intent());
  assert.equal(h.state.status, "failed"); assert.equal(h.state.error, "Bill save failed");
  assert.equal(h.bindings.failedSaveOperationsRef.current.size, 1);
  assert.equal([...h.bindings.failedSaveOperationsRef.current.values()][0].intent, undefined);
});

test("changed rename target supersedes only the same category and invalidates its older retry", async () => {
  const h = recoveryHarness();
  const oldFood = await failCategory(h, h.intent("Food"));
  await failCategory(h, h.intent("Utilities"));
  const completed = h.intent("Food");
  await h.actions.runTrackedFinancialMutation(async () => {
    h.actions.reconcileCategorySaveFailures(completed, ["Restaurants", "Utilities", "Debt", "Savings", "Other"]);
  }, async () => {}, completed);
  await oldFood.callback(); assert.equal(oldFood.writes(), 0);
  assert.equal(h.bindings.failedSaveOperationsRef.current.size, 1);
  assert.equal([...h.bindings.failedSaveOperationsRef.current.values()][0].intent.sourceName, "utilities");
  assert.equal(h.state.error, "utilities save failed");
});

test("authoritative catalog retires lost-response rename chains without hiding an absent failed add", async () => {
  const h = recoveryHarness();
  const old = await failCategory(h, h.intent("Food"));
  await failCategory(h, h.intent("Movies", "add"));
  const completed = h.intent("Groceries");
  await h.actions.runTrackedFinancialMutation(async () => {
    h.actions.reconcileCategorySaveFailures(completed, ["Restaurants", "Other", "Debt", "Savings"]);
  }, async () => {}, completed);
  assert.equal(h.bindings.failedSaveOperationsRef.current.size, 1);
  assert.equal([...h.bindings.failedSaveOperationsRef.current.values()][0].intent.sourceName, "movies");
  await old.callback(); assert.equal(old.writes(), 0);
});

test("category intent keys isolate actor, household, budget and source", () => {
  const a = categorySaveIntent("actor", "house", "budget", " FOOD ", "rename");
  assert.equal(a.key, categorySaveIntent("actor", "house", "budget", "food", "delete").key);
  for (const different of [categorySaveIntent("other", "house", "budget", "Food", "rename"), categorySaveIntent("actor", "other", "budget", "Food", "rename"), categorySaveIntent("actor", "house", "other", "Food", "rename"), categorySaveIntent("actor", "house", "budget", "Utilities", "rename")]) assert.notEqual(a.key, different.key);
});

test("an old household generation cannot reconcile or execute its category retry", async () => {
  const h = recoveryHarness(); const prior = await failCategory(h, h.intent());
  h.bindings.saveLifecycleGenerationRef.current++;
  await assert.rejects(prior.callback(), /previous household/);
  assert.equal(prior.writes(), 0);
  const completed = categorySaveIntent("actor", "other-house", "other-budget", "Food", "delete");
  h.actions.reconcileCategorySaveFailures(completed, ["Other", "Debt", "Savings"]);
  assert.equal(h.bindings.failedSaveOperationsRef.current.size, 1);
});

for (const oldSucceeds of [true, false]) test(`an already-running superseded category retry cannot alter a newer failure (${oldSucceeds ? "late success" : "late failure"})`, async () => {
  const h = recoveryHarness(), oldIntent = h.intent();
  let finish!: () => void, fail!: (error: Error) => void;
  const gate = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const old = h.actions.runTrackedFinancialMutation(() => gate, async () => {}, oldIntent);
  const oldResult = old.catch(() => {});
  await failCategory(h, h.intent());
  if (oldSucceeds) finish(); else fail(Error("Old superseded failure"));
  await oldResult;
  assert.equal(h.bindings.failedSaveOperationsRef.current.size, 1);
  assert.equal(h.state.error, "food save failed");
});

test("a late superseded failure cannot recreate a category banner after the latest save succeeds", async () => {
  const h = recoveryHarness(); let fail!: (error: Error) => void;
  const old = h.actions.runTrackedFinancialMutation(() => new Promise<void>((_resolve, reject) => { fail = reject; }), async () => {}, h.intent());
  const settled = old.catch(() => {});
  await h.actions.runTrackedFinancialMutation(async () => {}, async () => {}, h.intent());
  fail(Error("Late old failure")); await settled;
  assert.equal(h.bindings.failedSaveOperationsRef.current.size, 0);
  assert.equal(h.state.error, null); assert.equal(h.state.status, "saved");
});

test("catalog reconciliation retires an old add failure without canceling that source's newer in-flight rename", async () => {
  const h = recoveryHarness();
  await failCategory(h, h.intent("Groceries", "add"));
  const newerIntent = h.intent("Groceries");
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let remainedCurrent = false;
  const newer = h.actions.runTrackedFinancialMutation(async () => {
    await gate;
    remainedCurrent = h.bindings.saveIntentTokensRef.current.get(newerIntent.key) === newerIntent;
  }, async () => {}, newerIntent);
  const otherIntent = h.intent("Food");
  await h.actions.runTrackedFinancialMutation(async () => {
    h.actions.reconcileCategorySaveFailures(otherIntent, ["Restaurants", "Groceries", "Other", "Debt", "Savings"]);
  }, async () => {}, otherIntent);
  assert.equal(h.bindings.failedSaveOperationsRef.current.size, 0);
  assert.equal(h.bindings.saveIntentTokensRef.current.get(newerIntent.key), newerIntent);
  finish(); await newer;
  assert.equal(remainedCurrent, true);
  assert.equal(h.state.status, "saved");
});
