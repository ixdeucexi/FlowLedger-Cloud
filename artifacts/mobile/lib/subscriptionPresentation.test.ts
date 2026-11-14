import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ModuleKind, transpileModule } from "typescript";
import { buildScheduledSubscriptionSummary, canCreateSubscriptionBill, subscriptionCandidateIsRegularBill, subscriptionAmountLabel, subscriptionCadenceLabel, subscriptionMonthlyEquivalent, type ScheduledSubscriptionBill } from "./subscriptionPresentation";

const bill = (id: string, amount: number, overrides: Partial<ScheduledSubscriptionBill> = {}): ScheduledSubscriptionBill => ({
  id, name: `Netflix ${id}`, amount, frequency: "monthly", is_recurring: true, is_debt: false, due_day: 8, ...overrides,
});

test("scheduled monthly bills contribute even when no bank charge needs cleanup", () => {
  const result = buildScheduledSubscriptionSummary([
    bill("netflix", 35), bill("chatgpt", 30, { name: "Tia ChatGPT" }),
    bill("google", 110, { name: "Google Internet" }), bill("apple", 15, { name: "Apple" }),
  ], "2026-11-13");
  assert.equal(result.rows.length, 4);
  assert.equal(result.monthlyEstimate, 190);
  assert.equal(result.unavailableCount, 0);
});

test("monthly estimates normalize every supported recurrence without relabeling yearly bills monthly", () => {
  for (const [frequency, amount, expected, label] of [
    ["monthly", 10, 10, "Monthly"], ["weekly", 12, 52, "Weekly"],
    ["biweekly", 12, 26, "Every 2 weeks"], ["quarterly", 90, 30, "Quarterly"],
    ["yearly", 120, 10, "Yearly"], [undefined, 12.99, 12.99, "Monthly"],
  ] as const) {
    assert.equal(subscriptionMonthlyEquivalent(amount, frequency), expected);
    assert.equal(subscriptionCadenceLabel(frequency), label);
  }
  assert.equal(subscriptionMonthlyEquivalent(100, "yearly"), 8.33);
  assert.equal(subscriptionMonthlyEquivalent(100, "weekly"), 433.33);
  assert.equal(subscriptionMonthlyEquivalent(10_000_000_000_000, "weekly"), 43_333_333_333_333.33);
  assert.equal(subscriptionMonthlyEquivalent(10_000_000_000_000, "biweekly"), 21_666_666_666_666.67);
});

test("estimates include only active recurring subscription-style bills on the exact date", () => {
  const rows = [
    bill("active", 10), bill("future", 99, { start_date: "2026-11-14" }),
    bill("starts-today", 20, { start_date: "2026-11-13" }),
    bill("ended", 99, { end_date: "2026-11-12" }), bill("ends-today", 30, { end_date: "2026-11-13" }),
    bill("debt", 99, { is_debt: true }), bill("oneoff", 99, { is_recurring: false }),
    bill("plain", 99, { name: "Mortgage", category: "Housing" }),
  ];
  const result = buildScheduledSubscriptionSummary(rows, "2026-11-13");
  assert.equal(result.monthlyEstimate, 60);
  assert.deepEqual(result.rows.map(row => row.bill.id).sort(), ["active", "ends-today", "starts-today"]);
  assert.equal(rows.length, 8);
});

test("duplicates are counted once by bill ID; separate same-name bills remain separate", () => {
  const first = bill("one", 10, { name: "Netflix" });
  const result = buildScheduledSubscriptionSummary([first, first, bill("two", 20, { name: "Netflix" })], "2026-11-13");
  assert.equal(result.monthlyEstimate, 30);
  assert.equal(result.rows.length, 2);
});

test("displayed monthly estimates sum in cents and keep full precision", () => {
  const result = buildScheduledSubscriptionSummary([bill("a", .1), bill("b", .2)], "2026-11-13");
  assert.equal(result.monthlyEstimate, .3);
  assert.equal(subscriptionAmountLabel(result.monthlyEstimate), "$0.30");
  assert.equal(subscriptionAmountLabel(12345.67), "$12,345.67");
  assert.equal(subscriptionAmountLabel(null), "—");
});

test("invalid amounts or unknown recurrence make the estimate unavailable, never a fabricated zero", () => {
  for (const invalid of [NaN, Infinity, -1, 1.005, Number.MAX_SAFE_INTEGER]) {
    assert.equal(subscriptionMonthlyEquivalent(invalid, "monthly"), null);
    const result = buildScheduledSubscriptionSummary([bill("invalid", invalid)], "2026-11-13");
    assert.equal(result.monthlyEstimate, null);
    assert.equal(result.unavailableCount, 1);
  }
  assert.equal(subscriptionMonthlyEquivalent(10, "unknown"), null);
  assert.equal(subscriptionCadenceLabel("unknown"), "Frequency unavailable");
  assert.equal(buildScheduledSubscriptionSummary([], "2026-11-13").monthlyEstimate, 0);
});

test("all eligible rows affect totals beyond the first eight displayed rows", () => {
  const result = buildScheduledSubscriptionSummary(Array.from({ length: 12 }, (_, index) => bill(String(index), 10)), "2026-11-13");
  assert.equal(result.rows.length, 12);
  assert.equal(result.monthlyEstimate, 120);
});

test("invalid review dates are rejected and invalid start/end dates cannot invent active charges", () => {
  assert.throws(() => buildScheduledSubscriptionSummary([], "2026-02-30"), RangeError);
  assert.equal(buildScheduledSubscriptionSummary([bill("bad", 10, { start_date: "not-a-date" })], "2026-11-13").rows.length, 0);
});

test("saved bill links keep custom subscription names in the schedule without bypassing active/debt guards", () => {
  const rows = [bill("custom", 42, { name: "Acme Services", category: "Other" }),
    bill("debt", 100, { name: "Acme Loan", is_debt: true }),
    bill("ended", 99, { name: "Former service", end_date: "2026-11-12" })];
  const result = buildScheduledSubscriptionSummary(rows, "2026-11-13", ["custom", "custom", "debt", "ended", "foreign"]);
  assert.equal(result.monthlyEstimate, 42);
  assert.deepEqual(result.rows.map(row => row.bill.id), ["custom"]);
});

test("annual or unknown candidates are sent to manual Bills setup rather than silently converted to monthly", () => {
  assert.equal(canCreateSubscriptionBill("monthly"), true);
  assert.equal(canCreateSubscriptionBill("weekly"), true);
  for (const cadence of ["annual", "yearly", "unknown", "quarterly", ""]) assert.equal(canCreateSubscriptionBill(cadence), false);
});


function screenHandler(name: string, nextName: string, bindings: Record<string, unknown>) {
  const source = readFileSync("app/(tabs)/more.tsx", "utf8");
  const start = source.indexOf(`  const ${name} =`);
  const end = source.indexOf(`  const ${nextName} =`, start);
  assert.ok(start >= 0 && end > start, `actual ${name} screen handler exists`);
  const js = transpileModule(source.slice(start, end), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return ${name};`)(...Object.values(bindings));
}

const reviewBindings = () => ({
  subscriptionMutationsReady: true,
  subscriptionReviewScope: "owner-household",
  subscriptionReviewLive: { current: { key: "owner-household", generation: 1 } },
  subscriptionReviewMounted: { current: true },
  user: { id: "fictional-owner" }, activeHousehold: { householdId: "fictional-household" },
  subscriptionMatchBusy: null, subscriptionLinkCandidate: { merchant: "Fictional Service" },
});

test("viewer or unverified screen cannot enter any subscription mutation handler", async () => {
  const bindings = { ...reviewBindings(), subscriptionMutationsReady: false };
  for (const [name, next] of [
    ["markSubscriptionDecision", "handleCreateBillFromSubscription"],
    ["handleCreateBillFromSubscription", "openSubscriptionInReview"],
    ["handleMatchSubscriptionBill", "openSubscriptionBillPicker"],
    ["openSubscriptionBillPicker", "handleLinkSubscriptionBill"],
    ["handleLinkSubscriptionBill", "handleMarkSubscription"],
  ]) {
    // No provider/store bindings: reaching a mutation would fail the test.
    const handler = screenHandler(name, next, bindings);
    await handler({ merchant: "Fictional Service", cadence: "monthly" }, "cancelled");
  }
});

test("actual annual create entry routes to manual Bills setup without a conversion or confirmation", async () => {
  const destinations: unknown[] = [];
  const create = screenHandler("handleCreateBillFromSubscription", "openSubscriptionInReview", {
    ...reviewBindings(), canCreateSubscriptionBill, router: { push: (path: unknown) => destinations.push(path) },
  });
  await create({ merchant: "Fictional Service", cadence: "annual", averageAmount: 120 });
  assert.deepEqual(destinations, [{ pathname: "/(tabs)/bills", params: {
    view: "bills", addSubscription: "1", subscriptionName: "Fictional Service", subscriptionAmount: "120", subscriptionFrequency: "yearly",
  } }]);
});

test("deferred create confirmation cannot submit after household or edit scope changes", async () => {
  let confirm: (() => Promise<void>) | undefined;
  const scope = reviewBindings();
  const create = screenHandler("handleCreateBillFromSubscription", "openSubscriptionInReview", {
    ...scope, canCreateSubscriptionBill, importedSubscriptionMetadata: () => undefined,
    canEditHousehold: true, subscriptionCreateInFlightRef: { current: false },
    subscriptionKey: () => "fictional", newestTransactionDate: () => "2026-11-13", growthTransactions: [], todayIso: "2026-11-13",
    confirmAction: (options: { onConfirm: () => Promise<void> }) => { confirm = options.onConfirm; },
  });
  await create({ merchant: "Fictional Service", cadence: "monthly", averageAmount: 12, lastAmount: 12, transactionIds: [] });
  assert.ok(confirm);
  scope.subscriptionReviewLive.current.key = "other-household";
  // No mutation/RPC bindings: a stale confirmation reaching them would fail.
  await confirm();
});

test("legacy decision completion cannot replace another household's local choices", async () => {
  let finish!: (result: { error: null }) => void;
  const remote = new Promise<{ error: null }>(resolve => { finish = resolve; });
  let localSaves = 0;
  const scope = reviewBindings();
  const decide = screenHandler("markSubscriptionDecision", "handleCreateBillFromSubscription", {
    ...scope, importedSubscriptionMetadata: () => undefined, subscriptionDecisions: {},
    subscriptionKey: () => "fictional", canEditHousehold: true, assertFinancialMutationOnline: () => {},
    stableUuidFromString: () => "fictional-id", subscriptionDecisionToStatus: () => "dismissed",
    supabase: { from: () => ({ upsert: () => remote }) },
    saveSubscriptionDecisions: () => { localSaves++; },
  });
  const pending = decide({ merchant: "Fictional Service", cadence: "monthly", transactionIds: [] }, "not_subscription");
  scope.subscriptionReviewLive.current.key = "other-household";
  finish({ error: null });
  await pending;
  assert.equal(localSaves, 0);
});


test("manual bill types override keywords and linked IDs without changing saved financial fields", () => {
  const rows = [
    bill("regular", 110, { name: "Google Internet", category: "Subscriptions", is_subscription: false }),
    bill("custom", 25, { name: "Laurel Studio", category: "Other", is_subscription: true }),
    bill("legacy", 35, { name: "Netflix", is_subscription: null }),
    bill("linked", 10, { name: "Other custom", is_subscription: null }),
    bill("debt", 900, { is_debt: true, is_subscription: true }),
    bill("once", 100, { is_recurring: false, is_subscription: true }),
  ];
  const before = structuredClone(rows);
  const result = buildScheduledSubscriptionSummary(rows, "2026-11-14", ["regular", "linked"]);
  assert.deepEqual(result.rows.map(row => row.bill.id).sort(), ["custom", "legacy", "linked"]);
  assert.equal(result.monthlyEstimate, 70);
  assert.deepEqual(rows, before);
  assert.equal(buildScheduledSubscriptionSummary([{ ...rows[0], is_subscription: null }], "2026-11-14").monthlyEstimate, 110);
});

test("review suppression uses confirmed bill IDs, preserves ambiguous and shared-vendor services", () => {
  const bills = [{ id: "internet", is_subscription: false }, { id: "music", is_subscription: true }, { id: "auto", is_subscription: null }];
  const sources = [{ id: "a", linked_bill_id: "internet" }, { id: "b", linked_bill_id: "music" }, { id: "c" }, { id: "d", linked_bill_id: "auto" }];
  assert.equal(subscriptionCandidateIsRegularBill({ transactionIds: ["a"] }, sources, bills, "internet"), true);
  assert.equal(subscriptionCandidateIsRegularBill({ transactionIds: ["b"] }, sources, bills), false);
  assert.equal(subscriptionCandidateIsRegularBill({ transactionIds: ["a", "b"] }, sources, bills, "internet"), false);
  assert.equal(subscriptionCandidateIsRegularBill({ transactionIds: ["a", "c"] }, sources, bills, "internet"), false);
  assert.equal(subscriptionCandidateIsRegularBill({ transactionIds: ["c"] }, sources, bills, "internet"), false);
  assert.equal(subscriptionCandidateIsRegularBill({ transactionIds: ["missing"] }, sources, bills, "internet"), false);
  assert.equal(subscriptionCandidateIsRegularBill({ transactionIds: ["d"] }, sources, bills), false);
  assert.equal(subscriptionCandidateIsRegularBill({ transactionIds: ["a"] }, sources, [], "internet"), false);
});
