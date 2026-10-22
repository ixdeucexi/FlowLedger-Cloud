import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind } from "typescript";
import { rankBillMatches, manualActivityMatchCandidates } from "./billMatching";
import { pendingMatchesForKind } from "./pendingMatchChooser";

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
