import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import * as recentChanges from "./recentChanges";

const userId = "11111111-1111-4111-8111-111111111111";
const changeId = "44444444-4444-4444-8444-444444444444";
const householdId = "22222222-2222-4222-8222-222222222222";
const budgetId = "33333333-3333-4333-8333-333333333333";
const receipt = { changeId, householdId, budgetId, undoneAt: "2026-10-30T12:00:00Z", inverseChangeId: "55555555-5555-4555-8555-555555555555" };
const signedIn = () => ({ data: { session: { user: { id: userId }, access_token: "captured-account-token" } }, error: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function harness(options: { session?: () => Promise<any>; response?: Promise<any>; refresh?: Promise<any> } = {}) {
  const userScopeIdRef = { current: userId };
  const householdScopeRef = { current: { householdId, budgetId } };
  const financialScopeGenerationRef = { current: 1 };
  const recentChangeUndoLifecycleRef = { current: { mounted: true, generation: 0 } };
  const requests: Array<{ name: string; args: unknown; header?: string[]; dispatchedToken?: string }> = [];
  const publications: string[] = [];
  let sessionReads = 0, rowReads = 0, sdkToken = "captured-account-token";
  const supabase = {
    auth: { getSession: async () => { sessionReads++; return options.session ? options.session() : signedIn(); } },
    rpc(name: string, args: unknown) {
      const request = { name, args } as typeof requests[number];
      requests.push(request);
      // A later SDK identity is consulted by default auth at network dispatch.
      // An explicit per-request header must keep the verified caller instead.
      sdkToken = "different-account-token";
      const builder = {
        setHeader(key: string, value: string) { request.header = [key, value]; return builder; },
        then(resolve: (value: any) => unknown, reject: (error: unknown) => unknown) {
          request.dispatchedToken = request.header?.[1] ?? `Bearer ${sdkToken}`;
          return (options.response ?? Promise.resolve({ data: receipt, error: null })).then(resolve, reject);
        },
      };
      return builder;
    },
    from() { return { select() { rowReads++; return options.refresh ?? Promise.resolve({ data: [], error: null }); } }; },
  };
  const source = readFileSync("context/BudgetContext.tsx", "utf8");
  const start = source.indexOf("  const undoRecentChange =");
  const end = source.indexOf("  const syncDebtTransactionsAndRefresh =", start);
  assert.ok(start >= 0 && end > start);
  const bindings = {
    useCallback: (fn: unknown) => fn, user: { id: userId }, demoMode: false,
    assertCanEditHousehold() {}, userScopeIdRef, householdScopeRef, financialScopeGenerationRef,
    recentChangeUndoLifecycleRef, runTrackedFinancialMutation: (fn: () => unknown) => fn(), supabase,
    applyHouseholdSelect: (query: unknown) => query,
    loadAllTransactions: () => { rowReads++; return options.refresh ?? Promise.resolve({ data: [], error: null }); },
    accountAwareTransactionCollections: () => ({ active: [], deleted: [] }), transactionAccountIdentitiesRef: { current: [] },
    reorderDebtPriorities: (rows: unknown) => rows, normalizeBillRow: (row: unknown) => row, normalizeGoalRow: (row: unknown) => row,
    setBills: () => publications.push("bills"), setIncomes: () => publications.push("income"), setGoals: () => publications.push("goals"),
    setTransactions: () => publications.push("transactions"), setDeletedTransactions: () => publications.push("deleted"),
    queryClient: { invalidateQueries: () => publications.push("cache") },
  };
  const js = transpileModule(source.slice(start, end), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const undo = new Function(...Object.keys(bindings), `${js};return undoRecentChange;`)(...Object.values(bindings)) as (id: string) => Promise<void>;
  return { undo, requests, publications, userScopeIdRef, householdScopeRef, financialScopeGenerationRef, recentChangeUndoLifecycleRef, reads: () => ({ session: sessionReads, rows: rowReads }) };
}

test("Undo rejects a different SDK user while React still shows the same household editor", async () => {
  const h = harness({ session: async () => ({ data: { session: { user: { id: "another-editor" }, access_token: "other-token" } }, error: null }) });
  await assert.rejects(h.undo(changeId), /sign-in changed/);
  assert.equal(h.reads().session, 1);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.publications, []);
});

test("Undo requires a successful nonempty SDK session before dispatch", async () => {
  for (const session of [{ data: { session: null }, error: null }, { ...signedIn(), error: { message: "expired" } }, { data: { session: { user: { id: userId }, access_token: "" } }, error: null }]) {
    const h = harness({ session: async () => session });
    await assert.rejects(h.undo(changeId), /sign-in changed/);
    assert.equal(h.requests.length, 0);
  }
});

test("Undo rechecks user, household, budget, generation and disposal after session lookup", async () => {
  const changes = [
    (h: ReturnType<typeof harness>) => { h.userScopeIdRef.current = "another-editor"; },
    (h: ReturnType<typeof harness>) => { h.householdScopeRef.current = { householdId: "other-household", budgetId }; },
    (h: ReturnType<typeof harness>) => { h.householdScopeRef.current = { householdId, budgetId: "other-budget" }; },
    (h: ReturnType<typeof harness>) => { h.financialScopeGenerationRef.current++; },
    (h: ReturnType<typeof harness>) => { h.recentChangeUndoLifecycleRef.current.mounted = false; },
    (h: ReturnType<typeof harness>) => { h.recentChangeUndoLifecycleRef.current.generation++; },
  ];
  for (const change of changes) {
    const session = deferred<ReturnType<typeof signedIn>>(), h = harness({ session: () => session.promise });
    const pending = h.undo(changeId);
    change(h);
    session.resolve(signedIn());
    await assert.rejects(pending, /household changed/);
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.publications, []);
  }
});

test("Undo binds the request to the verified token even if SDK identity changes at dispatch", async () => {
  const h = harness();
  await h.undo(changeId);
  assert.deepEqual(h.requests, [{ name: "undo_recent_change", args: { p_change_id: changeId, p_expected_household_id: householdId, p_expected_budget_id: budgetId }, header: ["Authorization", "Bearer captured-account-token"], dispatchedToken: "Bearer captured-account-token" }]);
  assert.equal(h.reads().rows, 4);
  assert.deepEqual(h.publications, ["bills", "income", "goals", "transactions", "deleted", "cache"]);
});

test("late Undo receipts cannot refresh or publish after scope changes or disposal", async () => {
  for (const dispose of [false, true]) {
    const response = deferred<any>(), h = harness({ response: response.promise });
    const pending = h.undo(changeId);
    await settle();
    assert.equal(h.requests.length, 1);
    if (dispose) h.recentChangeUndoLifecycleRef.current.mounted = false;
    else h.financialScopeGenerationRef.current++;
    response.resolve({ data: receipt, error: null });
    await pending;
    assert.equal(h.reads().rows, 0);
    assert.deepEqual(h.publications, []);
  }
});

test("late authoritative refresh cannot publish after provider disposal", async () => {
  const refresh = deferred<any>(), h = harness({ refresh: refresh.promise });
  const pending = h.undo(changeId);
  await settle();
  assert.equal(h.reads().rows, 4);
  h.recentChangeUndoLifecycleRef.current.mounted = false;
  refresh.resolve({ data: [], error: null });
  await pending;
  assert.deepEqual(h.publications, []);
});

test("provider cleanup invalidates the Undo lifecycle even if it mounts again", () => {
  const source = readFileSync("context/BudgetContext.tsx", "utf8");
  const start = source.indexOf("  const recentChangeUndoLifecycleRef ="), end = source.indexOf("  const refreshDebtRows =", start);
  assert.ok(start >= 0 && end > start);
  let effect!: () => () => void;
  const js = transpileModule(source.slice(start, end), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const lifecycle = new Function("useRef", "useEffect", `${js};return recentChangeUndoLifecycleRef;`)((value: unknown) => ({ current: value }), (fn: () => () => void) => { effect = fn; });
  const cleanup = effect();
  assert.equal(lifecycle.current.mounted, true);
  const firstGeneration = lifecycle.current.generation;
  cleanup();
  assert.equal(lifecycle.current.mounted, false);
  assert.ok(lifecycle.current.generation > firstGeneration);
  effect();
  assert.equal(lifecycle.current.mounted, true);
  assert.notEqual(lifecycle.current.generation, firstGeneration);
});

test("unverified inverse receipts fail without publishing an old snapshot", async () => {
  const h = harness({ response: Promise.resolve({ data: { ...receipt, householdId: "foreign-household" }, error: null }) });
  await assert.rejects(h.undo(changeId), /could not be verified/);
  assert.equal(h.reads().rows, 0);
  assert.deepEqual(h.publications, []);
});

test("history-only income schedules render their reason and destination without Undo confirmation", () => {
  const scope = `${userId}:${householdId}:${budgetId}`;
  const reason = "Income amount history and skipped dates need income settings’ dedicated controls";
  const row = { id: changeId, sequence: 1, householdId, budgetId, action: "updated", entityType: "income", entityId: "salary", label: "Salary", actorId: userId, actorLabel: "You", source: "manual", createdAt: receipt.undoneAt, changes: [{ key: "amount_history", label: "Amount history", kind: "text", before: "Previous details", after: "Updated details" }], canUndo: false, undoReason: reason, undoneAt: null, route: recentChanges.RECENT_CHANGE_ROUTES.income };
  const flatten = (node: any): any[] => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
  const content = (node: any): string => Array.isArray(node) ? node.map(content).join(" ") : node && typeof node === "object" ? content(node.props?.children) : typeof node === "string" ? node : "";
  const render = (canUndo: boolean) => {
    let state = 0;
    const React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) }, exported: any = {};
    const js = transpileModule(readFileSync("components/RecentChanges.tsx", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
    new Function("exports", "require", js)(exported, (name: string) => {
      if (name === "react") return { __esModule: true, default: React, useRef: (value: unknown) => ({ current: value }), useEffect() {}, useState: (initial: unknown) => [state++ === 0 ? { id: changeId, scope } : initial, () => {}] };
      if (name === "react-native") return { View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", StyleSheet: { create: (value: unknown) => value } };
      if (name === "expo-router") return { useRouter: () => ({ push() {} }) };
      if (name.endsWith("BudgetContext")) return { useBudget: () => ({ canEditHousehold: true, undoRecentChange() {} }) };
      if (name.endsWith("useColors")) return { useColors: () => new Proxy({}, { get: () => "#123456" }) };
      if (name.endsWith("useRecentChanges")) return { useRecentChanges: () => ({ scopeKey: scope, items: [{ ...row, canUndo, undoReason: canUndo ? null : reason }], ready: true, demoMode: false, loading: false, loadingMore: false, error: null, cursor: null, refresh() {} }) };
      if (name.endsWith("recentChanges")) return recentChanges;
      return {};
    });
    return exported.RecentChanges();
  };
  const tree = render(false), labels = flatten(tree).map(node => node.props?.accessibilityLabel).filter(Boolean);
  assert.match(content(tree), /Income amount history and skipped dates/);
  assert.ok(labels.includes("Open income settings for Salary"));
  assert.ok(!labels.some(label => /Review undo|Confirm undo/.test(String(label))));
  assert.ok(flatten(render(true)).some(node => node.props?.accessibilityLabel === "Confirm undo for Salary"), "a supported reviewed edit still exposes its explicit confirmation");
});
