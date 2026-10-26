import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import { parseMoneyInput } from "./moneyFormInput";
import { monthlyIncomeAnchorDate } from "./schedule";

function evaluateDeclarations(file: string, startToken: string, endToken: string, bindings: Record<string, unknown>, result: string) {
  const source = readFileSync(file, "utf8"), start = source.indexOf(startToken);
  assert.ok(start >= 0);
  const body = source.slice(start, source.indexOf(endToken, start));
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return ${result};`)(...Object.values(bindings));
}

test("income's actual monthly estimate uses the full grouped amount and rejects malformed previews", () => {
  for (const [frequency, expected] of [["monthly", 1200.5], ["weekly", 1200.5 * 52 / 12], ["biweekly", 1200.5 * 26 / 12]] as const) {
    const estimate = evaluateDeclarations("components/IncomeModal.tsx", "  const parsedPreviewAmount =", "  const isRecurring =", { amount: "1,200.50", frequency, parseMoneyInput }, "({ parsedPreviewAmount, monthlyEquiv })");
    assert.equal(estimate.parsedPreviewAmount, 1200.5); assert.equal(estimate.monthlyEquiv, expected);
  }
  const invalid = evaluateDeclarations("components/IncomeModal.tsx", "  const parsedPreviewAmount =", "  const isRecurring =", { amount: "25oops", frequency: "monthly", parseMoneyInput }, "({ parsedPreviewAmount, monthlyEquiv })");
  assert.equal(invalid.parsedPreviewAmount, null); assert.equal(invalid.monthlyEquiv, 0);
});

test("income's actual save handler visibly reports missing payday and persistence errors without closing the draft", async () => {
  for (const payday of ["", "2026-10-23"]) {
    let saves = 0, closed = 0, saving = false; const errors: string[] = [];
    const source = readFileSync("components/IncomeModal.tsx", "utf8"), start = source.indexOf("  const handleSave =");
    const body = source.slice(start, source.indexOf("  const handleAddUpdate =", start));
    const bindings = {
      saving: false, amount: "1,200.50", parseMoneyInput, name: "Income", firstPayDate: payday,
      showFormError: (title: string) => errors.push(title),
      Haptics: { impactAsync() {}, ImpactFeedbackStyle: { Medium: "medium" } },
      history: [], frequency: "monthly", monthlyLastDay: false, monthlyIncomeAnchorDate, editItem: null,
      setSaving: (value: boolean) => { saving = value; }, onClose: () => closed++,
      onSave: async () => { saves++; throw new Error("Offline"); },
    };
    const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
    const save = new Function(...Object.keys(bindings), `${js}; return handleSave;`)(...Object.values(bindings));
    await save(); assert.equal(saves, payday ? 1 : 0); assert.equal(closed, 0); assert.equal(saving, false);
    assert.deepEqual(errors, [payday ? "Couldn’t save income" : "Payday needed"]);
  }
});

test("snowball's actual confirmation gate validates the full amount, floor and selected preview", () => {
  for (const [amount, safeMaximum, selectedExtra, expected] of [
    ["1,200.50", 500, 500, false], ["1,200.50", 1500, 1200.5, true],
    ["25oops", 500, 25, false], ["1,20.50", 500, 1, false], ["5.123", 500, 5.123, false],
    ["0", 500, 0, false], ["50", 500, 25, false], ["50", 500, 50, true],
    ["50", Number.NaN, 50, false], ["50", 500, Number.NaN, false],
  ] as const) {
    const gate = evaluateDeclarations("components/SnowballPreviewModal.tsx", "  const requested =", "  const methodName =", { amount, parseMoneyInput, preview: { safeMaximum, selectedExtra, allocations: [{}] } }, "({ requested, valid, exceedsSafeMaximum })");
    assert.equal(gate.valid, expected, `${amount}/${safeMaximum}/${selectedExtra}`);
    if (amount === "1,200.50") assert.equal(gate.requested, 1200.5);
  }
});

test("the actual snowball editor stays available through clear, invalid draft and valid reentry", () => {
  const exported: any = {};
  const react = { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: { ...(props as object), children } }) };
  const components = Object.fromEntries(["Modal", "Pressable", "ScrollView", "Text", "TextInput", "View"].map(name => [name, name]));
  const js = transpileModule(readFileSync("components/SnowballPreviewModal.tsx", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  new Function("exports", "require", js)(exported, (name: string) => {
    if (name === "react") return { __esModule: true, default: react, useState: (value: unknown) => [value, () => {}], useEffect() {} };
    if (name === "react-native") return { ...components, StyleSheet: { create: (styles: unknown) => styles } };
    if (name.endsWith("moneyFormInput")) return { parseMoneyInput };
    if (name.endsWith("useColors")) return { useColors: () => new Proxy({}, { get: () => "#000000" }) };
    if (name.endsWith("useDesktopExperience")) return { useDesktopExperience: () => false };
    if (name.endsWith("useBackDismiss")) return { useBackDismiss() {} };
    if (name.endsWith("dateLabels")) return { MONTH_NAMES: [] };
    return {};
  });
  const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten)
    : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
  let amount = "50";
  const preview = { safeMaximum: 500, selectedExtra: 50, allocations: [{ billId: "card", billName: "Card", payment: 50 }], months: [], payoffOrder: [], debtFreeDate: null };
  for (const draft of ["", "25oops", "50"]) {
    const before = flatten(exported.SnowballPreviewModal({ visible: true, method: "snowball", amount, preview: amount === "50" ? preview : null, onAmountChange: (value: string) => { amount = value; } }));
    const editor = before.find(node => node.type === "TextInput");
    assert.ok(editor, `input missing before changing ${amount} to ${draft}`);
    editor.props.onChangeText(draft);
    const after = flatten(exported.SnowballPreviewModal({ visible: true, method: "snowball", amount, preview: draft === "50" ? preview : null }));
    assert.equal(after.filter(node => node.type === "TextInput").length, 1);
    assert.equal(after.find(node => node.type === "TextInput").props.value, draft);
    const confirm = after.find(node => node.type === "Pressable" && node.props.disabled !== undefined && JSON.stringify(node.props.children).includes("Confirm Payment"));
    assert.ok(confirm); assert.equal(confirm.props.disabled, draft !== "50");
  }
});

test("Review Center maps manual candidates in linear work while preserving debt flags and payloads", () => {
  const source = readFileSync("components/ReviewCenter.tsx", "utf8"), start = source.indexOf("      const manualTransactionById =");
  assert.ok(start >= 0);
  const body = source.slice(start, source.indexOf("      goals.filter", start));
  const transactions = Array.from({ length: 20000 }, (_, i) => ({ id: `tx-${i}`, linked_bill_id: i % 2 ? "debt" : undefined, debt_applied_bill_id: i % 3 ? undefined : "debt" }));
  const targets = transactions.slice(-1000).map(transaction => ({ billId: transaction.id, name: transaction.id, category: "Other", plannedAmount: 50, occurrenceDates: ["2026-10-23"] }));
  let indexed = 0, lookups = 0;
  class CountedMap<K, V> extends Map<K, V> {
    constructor(entries: Iterable<readonly [K, V]>) { const values = [...entries]; indexed += values.length; super(values); }
    get(key: K) { lookups++; return super.get(key); }
  }
  const candidates: unknown[] = [];
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const bills: unknown[] = [], pendingPlanMatches = [{ id: "explicit-pending-link" }];
  const manualCandidates = (...args: unknown[]) => {
    assert.equal(args[0], transactions); assert.equal(args[1], "2026-10-23"); assert.equal(args[2], "posted");
    assert.equal(args[3], bills); assert.equal(args[4], true); assert.equal(args[5], pendingPlanMatches);
    return targets;
  };
  new Function("transactions", "manualActivityMatchCandidates", "current", "bills", "pendingPlanMatches", "candidates", "Map", js)(transactions, manualCandidates, { date: "2026-10-23", id: "posted" }, bills, pendingPlanMatches, candidates, CountedMap);
  assert.equal(indexed, 20000); assert.equal(lookups, 1000);
  assert.deepEqual(candidates, targets.map((target, index) => ({ type: "manual", id: target.billId, name: target.name, category: target.category, plannedAmount: 50, occurrenceDate: "2026-10-23", isDebt: Boolean(transactions[19000 + index].linked_bill_id || transactions[19000 + index].debt_applied_bill_id) })));
});

test("actual Calendar plan match rows describe the decision without calling it a spending bucket", () => {
  const source = readFileSync("components/ReviewCenter.tsx", "utf8"), start = source.indexOf("          {target.type === \"income\" ? \"Expected income\"");
  assert.ok(start >= 0);
  const end = source.indexOf(": {money", start), expression = source.slice(start, end).trim().slice(1, -1);
  const label = new Function("target", `return (${expression});`);
  assert.equal(label({ type: "decision" }), "Calendar plan"); assert.equal(label({ type: "goal" }), "Set-aside bucket");
});
