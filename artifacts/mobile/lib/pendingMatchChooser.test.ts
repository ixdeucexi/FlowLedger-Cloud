import { revealedPrivacyBindings } from "./privacyTestHarness";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import { rankBillMatches, manualActivityMatchCandidates } from "./billMatching";
import { pendingMatchesForKind, strongestPendingMatch } from "./pendingMatchChooser";

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
  bindings = revealedPrivacyBindings(bindings);
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
