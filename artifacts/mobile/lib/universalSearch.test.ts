import assert from "node:assert/strict";
import test from "node:test";

import { APP_COMMANDS, buildUniversalSearchIndex, mergeSearchResults, searchUniversalIndex } from "./universalSearch";

const index = buildUniversalSearchIndex({
  bills: [
    { id: "bill", name: "Electric Bill", category: "Utilities", is_debt: false, amount: 120, balance: 0 },
    { id: "debt", name: "Visa Card", category: "Credit Card", is_debt: true, amount: 50, balance: 900 },
  ],
  goals: [{ id: "goal", name: "Emergency Fund", current_amount: 800, target_amount: 1_000 }],
  transactions: [{ id: "tx", date: "2026-08-01", note: "Weekend groceries", category: "Food", merchant_name: "Market", amount: -45 }],
  categories: ["Food", "Utilities", "Food"],
  settings: [{ id: "security", label: "Account & security", description: "App lock", icon: "shield" }],
});

test("universal search groups real entities and routes debts correctly", () => {
  assert.equal(searchUniversalIndex(index, "visa")[0].kind, "Debt");
  assert.deepEqual(searchUniversalIndex(index, "visa")[0].params, { view: "debt", debtId: "debt" });
  assert.equal(searchUniversalIndex(index, "weekend groceries")[0].id, "tx");
  assert.equal(index.filter(result => result.kind === "Category" && result.title === "Food").length, 1);
});

test("universal search favors exact title matches and deduplicates remote rows", () => {
  const local = searchUniversalIndex(index, "market");
  const merged = mergeSearchResults(local, [{ ...local[0] }, { ...local[0], id: "remote" }]);
  assert.equal(merged.filter(result => result.id === "tx").length, 1);
  assert.equal(merged.some(result => result.id === "remote"), true);
});

test("command palette exposes only supported application actions", () => {
  assert.equal(APP_COMMANDS.some(command => command.id === "add-transaction"), true);
  assert.equal(APP_COMMANDS.some(command => command.id === "open-snowball" && command.route === "/snowball-plan"), true);
  assert.equal(APP_COMMANDS.every(command => command.route.startsWith("/")), true);
});

test("spending buckets describe spent and remaining money, never funded savings", () => {
  const results = buildUniversalSearchIndex({
    bills: [], transactions: [], categories: [], settings: [],
    goals: [
      { id: "bucket", name: "Weekend", goal_type: "planned_expense", target_amount: 200, current_amount: 50 },
      { id: "closed", name: "Closed weekend", goal_type: "planned_expense", target_amount: 200, current_amount: 50, closed_at: "2026-10-05" },
      { id: "saving", name: "Emergency", goal_type: "savings", target_amount: 200, current_amount: 50 },
    ],
  });
  assert.equal(results.find((row) => row.id === "bucket")?.subtitle, "$200.00 planned · $50.00 spent · $150.00 remaining");
  assert.equal(results.find((row) => row.id === "closed")?.subtitle, "$200.00 planned · $50.00 spent · $150.00 released · Closed");
  assert.equal(results.find((row) => row.id === "saving")?.subtitle, "25% funded");
});

import { readFileSync } from "node:fs";
import { ModuleKind, transpileModule } from "typescript";
import { createTransactionNameResolver } from "./transactionNames";

test("Activity search titles use saved names while both saved and raw bank names remain searchable", () => {
  const results = buildUniversalSearchIndex({
    bills: [], goals: [], categories: [], settings: [],
    transactions: [
      { id: "edited", date: "2026-10-26", amount: -50, category: "Shopping", merchant_name: "BANK POS 123", note: "Family dinner", user_edited_at: "2026-10-26" },
      { id: "manual-match", date: "2026-10-25", amount: -55, category: "Shopping", merchant_name: "RAW MERCHANT", note: "BANK DESCRIPTION", match_reason: "confirmed_manual_transaction_match", review_allocations: [{ type: "planned_expense", source: "transaction", amount: 55, name: "Saved manual purchase" }] },
    ],
  });
  assert.equal(searchUniversalIndex(results, "Family dinner")[0]?.title, "Family dinner");
  assert.equal(searchUniversalIndex(results, "BANK POS 123")[0]?.title, "Family dinner");
  for (const query of ["Saved manual purchase", "RAW MERCHANT", "BANK DESCRIPTION"]) assert.equal(searchUniversalIndex(results, query)[0]?.title, "Saved manual purchase");
});

test("remote Activity search projects naming metadata and preserves its scoped read-only query", async () => {
  const source = readFileSync("context/AppDiscoveryContext.tsx", "utf8");
  const start = source.indexOf("  useEffect(() => {\n    setRemoteResults([]);");
  const end = source.indexOf("  const searchResults =", start);
  assert.ok(start >= 0 && end > start);
  const rows = [
    { id: "edited", date: "2026-10-26", amount: -50, category: "Shopping", merchant_name: "BANK POS 123", note: "Family dinner", user_edited_at: "2026-10-26" },
    { id: "replacement", date: "2026-10-26", amount: -50, category: "Shopping", merchant_name: "BANK POS 124", note: "Saved bucket purchase", match_reason: "confirmed_bucket_replacement" },
    { id: "manual", date: "2026-10-26", amount: -50, category: "Shopping", merchant_name: "BANK POS 125", note: "BANK DESCRIPTION", match_reason: "confirmed_manual_match", review_allocations: [{ type: "planned_expense", source: "transaction", amount: 50, name: "Saved manual purchase" }] },
    { id: "bill", date: "2026-10-26", amount: -50, category: "Utilities", merchant_name: "BANK UTILITY ACH", note: "BANK DESCRIPTION", match_reason: "confirmed_bill_match", review_status: "matched", review_resolution: "bill", review_allocations: [{ type: "bill", targetId: "utility", amount: 50, name: "Saved electricity" }] },
    { id: "payroll", date: "2026-10-26", amount: 50, category: "Income", merchant_name: "PAYROLL ACH", note: "BANK DESCRIPTION", match_reason: "confirmed_income_match", review_status: "matched", review_resolution: "income", linked_income_id: "payroll", review_allocations: [{ type: "income", targetId: "payroll", amount: 50, name: "Saved payroll" }] },
    { id: "blank", date: "2026-10-26", amount: -50, category: null, merchant_name: null, note: null, review_allocations: null },
  ];
  const calls: unknown[][] = [], state = { results: [] as any[], loading: false };
  let runTimer!: () => void, cleanup!: () => void, settle!: Promise<unknown>;
  const request: any = {};
  for (const name of ["from", "select", "eq", "is", "or", "order", "limit"]) request[name] = (...args: unknown[]) => { calls.push([name, ...args]); return request; };
  request.then = (callback: (value: unknown) => unknown) => { settle = Promise.resolve().then(() => callback({ data: rows, error: null })); return settle; };
  const bindings = {
    useEffect: (effect: () => () => void) => { cleanup = effect(); },
    setTimeout: (callback: () => void) => { runTimer = callback; return 1; }, clearTimeout() {},
    searchVisible: true, mode: "search", demoMode: false, userId: "viewer", householdId: "viewer-household", query: "BANK",
    remoteSearchCacheRef: { current: new Map() }, supabase: request,
    setRemoteResults: (results: any[]) => { state.results = results; }, setRemoteLoading: (loading: boolean) => { state.loading = loading; },
    transactionTitle: createTransactionNameResolver([{ id: "utility", name: "Current electricity" }], [{ id: "payroll", name: "Current payroll" }]),
    transactions: [] as unknown[],
    remoteSearchNamingRef: { current: null as any },
    currency: (value: number) => Math.abs(value).toLocaleString("en-US", { style: "currency", currency: "USD" }),
  };
  bindings.remoteSearchNamingRef.current = { resolver: bindings.transactionTitle, transactions: bindings.transactions };
  const body = transpileModule(source.slice(start, end), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  new Function(...Object.keys(bindings), body)(...Object.values(bindings)); runTimer(); await settle;
  assert.deepEqual(state.results.map(row => row.title), ["Family dinner", "Saved bucket purchase", "Saved manual purchase", "Current electricity", "Current payroll", "Transaction"]);
  assert.deepEqual(calls, [
    ["from", "transactions"],
    ["select", "id,date,amount,category,note,merchant_name,user_edited_at,match_reason,review_status,review_resolution,review_allocations,linked_bill_id,linked_income_id"],
    ["eq", "household_id", "viewer-household"], ["is", "removed_at", null],
    ["or", "merchant_name.ilike.%BANK%,note.ilike.%BANK%,category.ilike.%BANK%"],
    ["order", "date", { ascending: false }], ["limit", 8],
  ]);
  assert.equal(searchUniversalIndex(state.results, "BANK POS 123")[0]?.title, "Family dinner");
  assert.deepEqual(state.results[0].params.activityId, "edited"); assert.equal(state.loading, false);
  cleanup();
  const rerun = async () => { new Function(...Object.keys(bindings), body)(...Object.values(bindings)); runTimer(); await settle; cleanup(); };
  await rerun(); assert.equal(calls.length, 7, "same naming inputs reuse the scoped cache");
  bindings.transactionTitle = createTransactionNameResolver([{ id: "utility", name: "New electricity name" }], [{ id: "payroll", name: "New payroll name" }]);
  await rerun(); assert.equal(calls.length, 14, "live plan rename invalidates rendered cached titles");
  assert.equal(state.results.find(row => row.id === "bill").title, "New electricity name");
  assert.equal(state.results.find(row => row.id === "payroll").title, "New payroll name");
  rows[0].note = "Later edited dinner"; bindings.transactions = [{}]; await rerun();
  assert.equal(calls.length, 21); assert.equal(state.results[0].title, "Later edited dinner");
});


test("local Activity search resolves current bill and income names without indexing whole bucket names as purchases", () => {
  const results = buildUniversalSearchIndex({
    bills: [{ id: "bill", name: "Current electricity", category: "Utilities", is_debt: false, balance: 0, amount: 50 }],
    incomes: [{ id: "payroll", name: "Current payroll" }], goals: [], categories: [], settings: [],
    transactions: [
      { id: "bill-charge", date: "2026-10-26", amount: -50, note: "BANK ACH", merchant_name: "Utility merchant", category: "Utilities", match_reason: "confirmed_bill_match", linked_bill_id: "bill" },
      { id: "payday", date: "2026-10-26", amount: 50, note: "BANK PAYROLL", merchant_name: "Payroll merchant", category: "Income", match_reason: "confirmed_income_match", review_status: "matched", review_resolution: "income", linked_income_id: "payroll" },
      { id: "purchase", date: "2026-10-26", amount: -50, note: "BANK POS", merchant_name: "Purchase merchant", category: "Shopping", match_reason: "confirmed_plan_match", review_resolution: "goal", review_allocations: [{ type: "planned_expense", source: "goal", targetId: "bucket", name: "Whole bucket", amount: 50 }] },
    ],
  }).filter(row => row.kind === "Activity");
  assert.deepEqual(results.map(row => row.title), ["Current electricity", "Current payroll", "Purchase merchant"]);
  assert.equal(searchUniversalIndex(results, "Utility merchant")[0]?.title, "Current electricity");
  assert.equal(searchUniversalIndex(results, "Whole bucket").length, 0);
});
