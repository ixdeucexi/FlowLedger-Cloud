import { revealedPrivacyBindings } from "./privacyTestHarness";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import { rankBillMatches, manualActivityMatchCandidates } from "./billMatching";
import { pendingMatchesForKind, strongestPendingMatch } from "./pendingMatchChooser";
import { isInferredPendingBankHold } from "./plaidActivity";

const ranked = rankBillMatches({ date: "2026-10-22", amount: -100, description: "Rent" }, [
  { billId: "rent", name: "Rent", category: "Housing", plannedAmount: 100, occurrenceDates: ["2026-10-22"] },
  { billId: "card", name: "Card", category: "Debt", plannedAmount: 100, occurrenceDates: ["2026-10-23"] },
  { billId: "gone", name: "Stale", category: "Other", plannedAmount: 90, occurrenceDates: ["2026-10-21"] },
]);
test("explicit type separates current bills/debts without changing canonical order or payment data", () => {
  const bills = [{ id: "rent", is_debt: false }, { id: "card", is_debt: true }];
  assert.deepEqual(pendingMatchesForKind(null, ranked, [], bills), []);
  for (const [kind, id] of [["bill", "rent"], ["debt", "card"]] as const) {
    const options = pendingMatchesForKind(kind, ranked, [], bills);
    assert.deepEqual(options.map(item => item.billId), [id]);
    assert.deepEqual(options[0], { ...ranked.find(item => item.billId === id), targetType: "bill" });
  }
  assert.deepEqual(pendingMatchesForKind("debt", ranked, [], [{ id: "card", is_debt: false }]), []);
  assert.deepEqual(pendingMatchesForKind("bill", ranked, [], []), []);
});
test("manual choices retain canonical same-month and eligibility exclusions", () => {
  const candidates = manualActivityMatchCandidates([
    { id: "ok", date: "2026-10-22", amount: -100, category: "Food", source: "manual" },
    { id: "prior", date: "2026-09-22", amount: -100, category: "Food", source: "manual" },
    { id: "bank", date: "2026-10-22", amount: -100, category: "Food", source: "plaid" },
    { id: "pending", date: "2026-10-22", amount: -100, category: "Food", pending: true },
  ], "2026-10-22");
  const manual = rankBillMatches({ date: "2026-10-22", amount: -100, description: "Food" }, candidates);
  assert.deepEqual(pendingMatchesForKind("manual", ranked, manual, []).map(item => [item.billId, item.targetType]), [["ok", "manual"]]);
});
const source = () => readFileSync("app/(tabs)/transactions.tsx", "utf8");
function extract(start: string, end: string, bindings: Record<string, unknown>) {
  bindings = revealedPrivacyBindings({ isInferredPendingBankHold, ...bindings });
  const s = source(); const a = s.indexOf(`  const ${start} =`); const b = s.indexOf(`  const ${end} =`, a);
  return new Function(...Object.keys(bindings), `${transpileModule(s.slice(a,b), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText}; return ${start};`)(...Object.values(bindings));
}
test("every open/close/different pending payment synchronously clears chooser type without persisting", () => {
  let kind: unknown = "debt"; let pending: unknown;
  const set = extract("setPendingMatchTx", "[pendingTransactionSource, setPendingTransactionSource]", {
    useCallback: (fn: unknown) => fn, setPendingMatchKind: (v: unknown) => { kind = v; }, setPendingMatchTxState: (v: unknown) => { pending = v; },
  });
  for (const value of [{ plaid_transaction_id: "a" }, null, { plaid_transaction_id: "b" }]) {
    kind = "manual"; set(value); assert.equal(kind, null); assert.equal(pending, value);
  }
});
test("debt and manual candidate clicks call their existing persistence handlers only on explicit action", async () => {
  for (const manual of [false, true]) {
    const calls: unknown[][] = []; const state: unknown[] = [];
    const fn = extract(manual ? "handleMatchPendingManual" : "handleMatchPendingBill", manual ? "openPendingTransactionCreator" : "handleMatchPendingManual", {
      pendingMatchTx: { plaid_transaction_id: "pending", transaction_date: "2026-10-22" }, savingMatch: false,
      pendingBillMatchOptions: ranked, pendingManualMatchOptions: ranked,
      setSavingMatch: (v: unknown) => state.push(v), setPendingMatchTx: () => {}, setDetailItem: () => {},
      matchPendingTransactionToBill: async (...args: unknown[]) => { calls.push(args); }, matchPendingTransactionToManual: async (...args: unknown[]) => { calls.push(args); },
      Alert: { alert() {} }, showFormError() {},
    });
    assert.equal(calls.length, 0); await fn("missing"); assert.equal(calls.length, 0);
    await fn("card"); assert.equal(calls.length, 1); assert.deepEqual(calls[0].slice(0,2), ["pending", "card"]);
    assert.deepEqual(state, [true,false]);
    if (!manual) assert.equal(calls[0][2], "2026-10-23");
  }
});

test("one suggestion spans eligible current targets, retaining its own kind and the existing threshold", () => {
  const bills = [{ id: "rent", is_debt: false }, { id: "card", is_debt: true }];
  const before = JSON.stringify(ranked);
  const debt = ranked.find(option => option.billId === "card")!;
  assert.equal(strongestPendingMatch(ranked, [], bills)?.billId, "rent");
  assert.equal(strongestPendingMatch([debt], [], bills)?.kind, "debt");
  const manual = [{ ...debt, billId: "manual-exact-id", score: 100 }];
  assert.equal(strongestPendingMatch(ranked, manual, bills)?.kind, "manual");
  assert.equal(strongestPendingMatch(ranked, manual, bills)?.targetType, "manual");
  assert.equal(JSON.stringify(ranked), before);
  assert.equal(strongestPendingMatch(ranked, [], []), null);
  assert.equal(strongestPendingMatch([{ ...debt, score: 47.99 }], [], bills), null);
  assert.equal(strongestPendingMatch([{ ...debt, score: 48 }], [], bills)?.billId, "card");
  assert.equal(strongestPendingMatch([], [], bills), null);
});

test("combined suggestion preserves canonical score, amount, distance and name ordering across types", () => {
  const candidate = (id: string, values: Partial<(typeof ranked)[number]>) => ({ ...ranked[0], billId: id, ...values });
  for (const [winner, other] of [
    [candidate("winner", { score: 90, amountDifference: 10 }), candidate("other", { score: 89, amountDifference: 0 })],
    [candidate("winner", { amountDifference: 1 }), candidate("other", { amountDifference: 2 })],
    [candidate("winner", { daysApart: 3 }), candidate("other", { daysApart: null })],
    [candidate("winner", { name: "Alpha 2" }), candidate("other", { name: "Zulu 1" })],
  ]) {
    const bills = [{ id: "other" }];
    const manual = [winner]; const original = JSON.stringify([manual, other]);
    assert.equal(strongestPendingMatch([other], manual, bills)?.billId, "winner");
    assert.equal(JSON.stringify([manual, other]), original);
  }
});

function renderSuggestion(suggestion: ReturnType<typeof strongestPendingMatch>, savingMatch = false) {
  const s = source();
  const start = s.indexOf("{pendingMatchSuggestion ? (");
  const end = s.indexOf("What does this payment cover?", start);
  const expression = s.slice(start + 1, s.lastIndexOf(") : null}", end) + ") : null".length);
  const calls: unknown[][] = [];
  const bindings = revealedPrivacyBindings({
    React: { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }) },
    Pressable: "button", View: "view", Text: "text", Feather: "icon",
    pendingMatchSuggestion: suggestion, pendingMatchKindLabels: { bill: "Bill", debt: "Debt", manual: "Manual transaction" },
    savingMatch, styles: {}, c: {},
    handleMatchPendingManual: (id: string) => calls.push(["manual", id]),
    handleMatchPendingBill: (id: string) => calls.push(["bill", id]),
  });
  const js = transpileModule(`const result = (${expression});`, {
    fileName: "suggestion.tsx", compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React },
  }).outputText;
  const rendered = new Function(...Object.keys(bindings), `${js}; return result;`)(...Object.values(bindings));
  return { rendered, calls };
}

test("unfiltered suggestion renders actual target kind and exact explicit action; saving disables it", () => {
  for (const kind of ["bill", "debt", "manual"] as const) {
    const candidate = { ...ranked[0], billId: `${kind}-exact-id` };
    const suggestion = strongestPendingMatch(kind === "manual" ? [] : [candidate], kind === "manual" ? [candidate] : [], [{ id: candidate.billId, is_debt: kind === "debt" }]);
    const { rendered, calls } = renderSuggestion(suggestion);
    assert.equal(calls.length, 0, "rendering never matches automatically");
    assert.match(rendered.props.accessibilityLabel, new RegExp(`Use suggested ${kind === "manual" ? "manual transaction" : kind}`));
    assert.equal(rendered.props.disabled, false);
    rendered.props.onPress();
    assert.deepEqual(calls, [[kind === "manual" ? "manual" : "bill", candidate.billId]]);
    assert.equal(renderSuggestion(suggestion, true).rendered.props.disabled, true);
  }
  assert.equal(renderSuggestion(null).rendered, null);
});

test("suggestion is before filters in one unmatched scroll region and independent of selected type", () => {
  const s = source();
  const create = s.indexOf('accessibilityLabel="Create transaction for pending charge"');
  const suggestion = s.indexOf("{pendingMatchSuggestion ? (", create);
  const filters = s.indexOf("What does this payment cover?", suggestion);
  const emptyCopy = s.indexOf("Choose a type for other entries", filters);
  assert.ok(create < suggestion && suggestion < filters && filters < emptyCopy);
  assert.doesNotMatch(s.slice(suggestion, filters), /pendingMatchKind[^L]/);
  assert.doesNotMatch(s.slice(s.indexOf("const pendingMatchSuggestion ="), s.indexOf("const bucketMatchOptions =")), /pendingMatchKind/);
  assert.equal((s.slice(s.lastIndexOf("<ScrollView", create), emptyCopy).match(/<ScrollView/g) ?? []).length, 1);
});

function extractBudgetCallback(name: string, bindings: Record<string, unknown>) {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const marker = `  const ${name} = useCallback(`;
  const start = context.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length, `actual ${name} callback exists`);
  const end = context.indexOf("\n  }, [", start) + 4;
  assert.ok(end > start);
  const js = transpileModule(`const callback = ${context.slice(start, end)};`, {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return callback;`)(...Object.values(bindings));
}

test("actual matching and creation callbacks reject inferred holds before demo state or persistence", async () => {
  for (const demoMode of [false, true]) {
    for (const pending of [
      { plaid_transaction_id: "pending-hold:checking:50.00", name: "Pending bank hold" },
      { plaid_transaction_id: "cached-hold", name: "Pending BANK hold" },
    ]) {
      let calls = 0;
      const forbidden = () => { calls++; throw new Error("unexpected state or persistence"); };
      const bindings = {
        user: { id: "owner" }, assertCanEditHousehold: () => {},
        pendingBankTransactions: [{ ...pending, amount: -50, transaction_date: "2026-11-03" }],
        isInferredPendingBankHold, demoMode,
        setPendingPlanMatches: forbidden, setTransactions: forbidden,
        supabase: { from: forbidden }, createPendingActivityTransactionAtomically: forbidden,
        markSaveStarted: forbidden, runTrackedFinancialMutation: forbidden,
      };
      const match = extractBudgetCallback("matchPendingTransactionToPlan", bindings);
      const create = extractBudgetCallback("createTransactionForPendingCharge", bindings);
      await assert.rejects(match(pending.plaid_transaction_id, "bill", "debt", "2026-11-03", 50), /transaction details for this balance hold/);
      await assert.rejects(create(pending.plaid_transaction_id, { amount: -50, date: "2026-11-03", category: "Other" }), /transaction details for this balance hold/);
      assert.equal(calls, 0);
    }
  }
});

test("actual matching callback upserts real debt and manual targets with the original source identity", async () => {
  for (const targetType of ["bill", "manual"] as const) {
    const requests: { table: string; payload?: Record<string, unknown>; conflict?: unknown }[] = [];
    let savedRows: unknown[] = [];
    let completed = false;
    const pending = { plaid_transaction_id: "real-pending", plaid_account_id: "checking", amount: -50, transaction_date: "2026-11-03", name: "Card payment" };
    const target = { id: "debt", name: "Card", is_debt: true };
    const manual = { id: "manual", date: "2026-11-03", amount: -50, category: "Other", source: "manual", note: "Card payment" };
    const fn = extractBudgetCallback("matchPendingTransactionToPlan", {
      user: { id: "owner" }, assertCanEditHousehold: () => {}, pendingBankTransactions: [pending],
      bills: [target], transactions: [manual], pendingPlanMatches: [], demoMode: false,
      isInferredPendingBankHold, manualActivityMatchCandidates,
      genId: () => "match", roundMoney: (n: number) => Math.round(n * 100) / 100,
      scopedPayload: (payload: Record<string, unknown>) => ({ ...payload, household_id: "household", budget_id: "budget" }),
      markSaveStarted: () => "operation", markSaveCompleted: () => { completed = true; },
      markSaveFailed: () => assert.fail("real pending match should save"),
      normalizePendingPlanMatchRow: (row: unknown) => row,
      setPendingPlanMatches: (update: (rows: unknown[]) => unknown[]) => { savedRows = update(savedRows); },
      supabase: { from(table: string) {
        const request: (typeof requests)[number] = { table }; requests.push(request);
        return { upsert(payload: Record<string, unknown>, conflict: unknown) {
          request.payload = payload; request.conflict = conflict;
          return { select: () => ({ single: async () => ({ data: { id: "saved", ...payload }, error: null }) }) };
        } };
      } },
    });
    await fn(pending.plaid_transaction_id, targetType, targetType === "bill" ? target.id : manual.id, "2026-11-03", 50);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].table, "pending_plan_matches");
    assert.deepEqual(requests[0].conflict, { onConflict: "household_id,pending_plaid_transaction_id" });
    assert.equal(requests[0].payload?.pending_plaid_transaction_id, pending.plaid_transaction_id);
    assert.equal(requests[0].payload?.pending_account_id, pending.plaid_account_id);
    assert.equal(requests[0].payload?.target_id, targetType === "bill" ? target.id : manual.id);
    assert.equal(requests[0].payload?.target_type, targetType);
    assert.equal(requests[0].payload?.household_id, "household");
    assert.equal(requests[0].payload?.pending_amount, 50);
    assert.equal(requests[0].payload?.status, "active");
    assert.equal(requests[0].payload?.user_id, "owner");
    assert.equal(requests[0].payload?.created_by, "owner");
    assert.equal(completed, true);
    assert.equal(savedRows.length, 1);
  }
});

test("pending matcher refuses inferred sources and stale hold actions without opening or saving", async () => {
  const pending = { plaid_transaction_id: "pending-hold:checking:50.00", name: "Pending bank hold", amount: -50 };
  let selected: unknown = "unset";
  const set = extract("setPendingMatchTx", "[pendingTransactionSource, setPendingTransactionSource]", {
    useCallback: (fn: unknown) => fn, setPendingMatchKind: () => {}, setPendingMatchTxState: (v: unknown) => { selected = v; },
  });
  set(pending); assert.equal(selected, null);
  for (const [start, end] of [
    ["handleMatchPendingBill", "handleMatchPendingManual"],
    ["handleMatchPendingManual", "openPendingTransactionCreator"],
    ["openPendingTransactionCreator", "pendingTransactionInitialValues"],
  ]) {
    const fn = extract(start, end, { pendingMatchTx: pending, savingMatch: false });
    await fn("debt");
  }
});
