import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import ts from "typescript";
import { buildForecastAccountCatalog, resolveForecastAccountReference } from "./accountForecasts";
import { validPlannedTransferDate, plannedTransferOccurrenceDates, plannedTransferHasOutstandingReview } from "./plannedAccountTransfers";
import { parseMoneyInput, parseDecimalInput } from "./moneyFormInput";
import { addDateOnlyDays, dateOnlyToLocalDate, MONTH_NAMES } from "./dateLabels";

type Node = { type: any; props: any; children: Array<Node | string> };
const sourceBill = { id: "bill-1", household_id: "home", budget_id: "budget", name: "Kids Transfer", amount: 50,
  is_debt: false, is_recurring: true, frequency: "monthly", due_day: 4, start_date: "2026-07-04", end_date: null,
  funding_account_ref: "manual:checking" };
function harness(props: any = {}, pending?: () => Promise<unknown>, component = "PlannedTransferModal") {
  let slots: any[] = [], index = 0;
  const effects: Array<() => void> = [];
  const state = { user: { id: "actor" }, closed: 0, saved: 0, back: 0, calls: [] as any[],
    budget: { activeHousehold: { householdId: "home", budgetId: "budget" }, canEditHousehold: true,
      bills: [sourceBill], categories: ["Other"], settings: { debtPayoffEnabled: false }, plannedAccountTransfers: [] as any[], plannedTransferOccurrences: [] as any[],
      accountForecastReady: true, plannedTransfersReady: true, plannedTransfersError: null as string | null, demoMode: false, retryBudgetLoad: () => state.calls.push({ type: "retry", args: [] }), householdTimeZone: "America/Chicago",
      forecastAccounts: buildForecastAccountCatalog({ accounts: [
        { id: "checking", name: "Bills", account_type: "checking", current_balance: 1000, is_active: true },
        { id: "savings", name: "Spending", account_type: "savings", current_balance: 200, is_active: true },
      ] as any[], bankAccounts: [] }),
    },
    props: { visible: true, onClose: () => state.closed++, onSaved: () => state.saved++, onBackToBill: () => state.back++, onSave: (...args: any[]) => state.calls.push({ type: "bill", args }), ...props },
  };
  const changed = (a?: any[], b?: any[]) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const useState = (initial: any) => { const i = index++; if (!(i in slots)) slots[i] = { value: typeof initial === "function" ? initial() : initial };
    return [slots[i].value, (next: any) => { slots[i].value = typeof next === "function" ? next(slots[i].value) : next; }]; };
  const useRef = (initial: any) => { const i = index++; return slots[i] ?? (slots[i] = { current: initial }); };
  const useEffect = (fn: () => void, deps: any[]) => { const i = index++; if (!(i in slots) || changed(slots[i].deps, deps)) { slots[i] = { deps }; effects.push(fn); } };
  const primitive = (type: string) => ({ children, ...p }: any) => React.createElement(type, p, children);
  const mutation = async (type: string, ...args: any[]) => { state.calls.push({ type, args }); if (pending) return pending(); return {}; };
  const deps: Record<string, unknown> = {
    react: { ...React, useState, useRef, useEffect, useMemo: (fn: () => unknown) => fn() },
    "react-native": { KeyboardAvoidingView: "KeyboardAvoidingView", Modal: ({ visible, children, ...p }: any) => visible ? React.createElement("Modal", p, children) : null,
      Keyboard: { dismiss: () => {} }, Switch: "Switch",
      Platform: { OS: "web" }, ScrollView: "ScrollView", StyleSheet: { create: (x: any) => x, absoluteFillObject: {} } },
    "@expo/vector-icons/Feather": primitive("Icon"), "expo-crypto": { randomUUID: () => "stable-new-id" },
    "@/components/privacy/PrivacyPrimitives": { PrivacyView: "View", PrivacyPressable: "Pressable", PrivacyText: "Text", PrivacyTextInput: "Input" },
    "@/components/AccountForecastPicker": { AccountForecastPicker: primitive("AccountPicker"), accountForecastLabel: (a: any) => a.name },
    "@/components/DatePickerField": { DatePickerField: primitive("DatePicker") },
    "@/context/AuthContext": { useAuth: () => ({ user: state.user }) },
    "@/context/BudgetContext": { useBudget: () => ({ ...state.budget, savePlannedAccountTransfer: (...args: any[]) => mutation("save", ...args),
      convertBillToPlannedTransfer: (...args: any[]) => mutation("convert", ...args) }) },
    "@/hooks/useBackDismiss": { useBackDismiss: () => {} }, "@/hooks/useColors": { useColors: () => ({ primary: "#a855f7", foreground: "#fff", mutedForeground: "#aaa", card: "#101528", border: "#334155", background: "#030712", success: "#22c55e", warning: "#ffb400", destructive: "#f43f5e" }) },
    "@/lib/accountForecasts": { resolveForecastAccountReference }, "@/lib/financialProjection": { safeLocalDateInTimeZone: () => "2026-11-12" },
    "@/lib/moneyFormInput": { parseMoneyInput, parseDecimalInput }, "@/lib/dateLabels": { addDateOnlyDays, dateOnlyToLocalDate, MONTH_NAMES },
    "@/hooks/usePrivacyAlerts": { usePrivacyAlerts: () => ({ formError: () => {}, alert: () => {} }) },
    "@/lib/haptics": { impactAsync: () => {}, ImpactFeedbackStyle: { Medium: "medium", Light: "light" } },
    "@/constants/colors": { radius: 12 }, "@/components/ConfirmActionModal": { ConfirmActionOverlay: () => null },
    "@/components/PlannedTransferModal": { PlannedTransferModal: primitive("TransferEditor") },
    "@/components/PlannedTransferOccurrenceModal": { PlannedTransferOccurrenceModal: primitive("TransferDateEditor") },
    "@/components/BillFrequencyPicker": { BillFrequencyPicker: primitive("FrequencyPicker") },
    "@/components/BillPaymentHistoryPanel": { BillPaymentHistoryPanel: primitive("BillHistory") },
    "@/components/DebtPaymentPauseModal": { DebtPaymentPauseModal: primitive("PauseEditor") },
    "@/hooks/useDesktopExperience": { useDesktopExperience: () => false }, "@/hooks/useLocalDay": { useLocalDay: () => {} },
    "@/lib/dailyCheckingClose": { localDateInTimeZone: () => "2026-11-12" },
    "@/lib/debtPaymentPause": { activeDebtPaymentPause: () => undefined }, "@/lib/desktopModal": {},
    "@/lib/billImportance": { BILL_IMPORTANCE_OPTIONS: [], normalizeBillImportance: (v: unknown) => v ?? "must" },
    "@/lib/billEditPersistence": { billEditablePatch: (v: unknown) => v, changedBillEditableFields: () => [] }, "@/lib/plannedAccountTransfers": { validPlannedTransferDate, plannedTransferOccurrenceDates, plannedTransferHasOutstandingReview },
  };
  const code = ts.transpileModule(readFileSync(`components/${component}.tsx`, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} as any };
  new Function("require", "module", "exports", code)((name: string) => { if (!(name in deps)) throw Error(`Unexpected dependency ${name}`); return deps[name]; }, mod, mod.exports);
  const expand = (v: any): Array<Node | string> => { if (v == null || v === false || v === true) return []; if (typeof v === "string" || typeof v === "number") return [String(v)];
    if (Array.isArray(v)) return v.flatMap(expand); if (v.type === React.Fragment) return expand(v.props.children); if (typeof v.type === "function") return expand(v.type(v.props));
    return [{ type: v.type, props: v.props, children: expand(v.props.children) }]; };
  let tree: Array<Node | string> = [];
  const render = () => { for (let count = 0; count < 3; count++) { index = 0; tree = expand(mod.exports[component](state.props)); if (!effects.length) break; while (effects.length) effects.shift()!(); } return tree; };
  const all = (nodes = tree): Node[] => nodes.flatMap(v => typeof v === "string" ? [] : [v, ...all(v.children)]);
  const find = (label: string) => { const node = all().find(n => n.props.accessibilityLabel === label || n.type === "DatePicker" && n.props.label === label || n.type === "AccountPicker" && n.props.label === label); assert.ok(node, label); return node; };
  render();
  return { state, render, find, all, text: () => JSON.stringify(tree) };
}
async function pressSave(h: ReturnType<typeof harness>, label = "Change to transfer") { h.find(label).props.onPress(); await new Promise(resolve => setTimeout(resolve, 0)); h.render(); }
test("actual transfer editor keeps a new Bill draft, leaves destination explicit and returns without saving", () => {
  const h = harness({ initialValues: { name: "Kids", amount: "50.00", fromAccountRef: "manual:checking", frequency: "once" } });
  assert.equal(h.find("Transfer plan name").props.value, "Kids"); assert.equal(h.find("Transfer plan amount").props.value, "50.00");
  assert.equal(h.find("From account").props.value, "manual:checking"); assert.equal(h.find("To account").props.value, null);
  h.find("Back to bill").props.onPress(); assert.equal(h.state.back, 1); assert.equal(h.state.calls.length, 0);
});
test("actual conversion editor requires an explicit future date, account and confirmation before its one atomic mutation", async () => {
  const h = harness({ conversionBill: sourceBill });
  assert.equal(h.find("First transfer date").props.value, ""); assert.equal(h.find("First transfer date").props.minDate, "2026-11-13");
  assert.ok(!h.all().some(n => n.props.accessibilityLabel === "Pause this transfer plan" || n.props.accessibilityLabel === "Transfer frequency"));
  h.find("To account").props.onChange("manual:savings"); h.find("First transfer date").props.onChange("2026-11-12"); h.render();
  await pressSave(h); assert.equal(h.state.calls.length, 0); assert.match(h.text(), /after today/);
  h.find("First transfer date").props.onChange("2026-11-20"); h.render(); await pressSave(h); assert.equal(h.state.calls.length, 0); assert.match(h.text(), /Confirm that future/);
  h.find("Confirm changing future bill payments to a transfer").props.onPress(); h.render(); await pressSave(h);
  assert.equal(h.state.calls.length, 1); assert.equal(h.state.calls[0].type, "convert"); assert.equal(h.state.calls[0].args[0], sourceBill);
  assert.deepEqual(h.state.calls[0].args[1], { name: "Kids Transfer", amount: 50, from_account_ref: "manual:checking", to_account_ref: "manual:savings",
    frequency: "monthly", start_date: "2026-11-20", end_date: null, status: "active" }); assert.equal(h.state.saved, 1);
});
test("conversion rejection keeps the draft visible and never falls back to ordinary plan or Bill writes", async () => {
  const h = harness({ conversionBill: sourceBill }, async () => { throw Error("Finish reviewing this bill before changing it to a transfer."); });
  h.find("To account").props.onChange("manual:savings"); h.find("First transfer date").props.onChange("2026-11-20"); h.find("Confirm changing future bill payments to a transfer").props.onPress(); h.render();
  await pressSave(h); assert.equal(h.state.saved, 0); assert.equal(h.state.closed, 0); assert.equal(h.state.calls[0].type, "convert"); assert.match(h.text(), /Finish reviewing/);
  assert.equal(h.find("First transfer date").props.value, "2026-11-20");
});
test("held old-household conversion cannot close or save a new household editor", async () => {
  let resolve!: (v: unknown) => void; const gate = new Promise(r => { resolve = r; });
  const h = harness({ conversionBill: sourceBill }, () => gate); h.find("To account").props.onChange("manual:savings");
  h.find("First transfer date").props.onChange("2026-11-20"); h.find("Confirm changing future bill payments to a transfer").props.onPress(); h.render();
  h.find("Change to transfer").props.onPress(); await new Promise(r => setTimeout(r, 0));
  h.state.budget.activeHousehold.householdId = "other"; h.render(); resolve({}); await new Promise(r => setTimeout(r, 0)); h.render();
  assert.equal(h.state.saved, 0); assert.equal(h.state.closed, 0); assert.equal(h.find("Transfer plan name").props.value, "");
  assert.equal(h.find("Change to transfer").props.disabled, true); assert.match(h.text(), /household changed/);
});

test("actual Bill chooser suspends one modal and returns to its untouched draft without a write", () => {
  const h = harness({}, undefined, "AddBillModal");
  h.find("Bill name").props.onChangeText("Trip money"); h.find("Payment amount").props.onChangeText("125.50"); h.render();
  h.find("Transfer").props.onPress(); h.render();
  assert.equal(h.all().filter(n => n.type === "Modal").length, 0);
  const editor = h.all().find(n => n.type === "TransferEditor")!; assert.equal(editor.props.visible, true);
  assert.equal(editor.props.initialValues.name, "Trip money"); assert.equal(editor.props.initialValues.amount, "125.50"); assert.equal(editor.props.conversionBill, null);
  editor.props.onClose(); h.render(); assert.equal(h.find("Bill name").props.value, "Trip money"); assert.equal(h.find("Payment amount").props.value, "125.50"); assert.equal(h.state.calls.length, 0);
});
test("actual saved Bill conversion captures its unchanged source and leaves unsupported schedules in Bill editor", () => {
  const h = harness({ editBill: sourceBill }, undefined, "AddBillModal"); h.find("Bill name").props.onChangeText("Updated transfer name"); h.render();
  h.find("Change to transfer").props.onPress(); h.render(); const editor = h.all().find(n => n.type === "TransferEditor")!;
  assert.deepEqual(editor.props.conversionBill, sourceBill); assert.notEqual(editor.props.conversionBill, sourceBill); assert.equal(editor.props.initialValues.name, "Updated transfer name");
  editor.props.onBackToBill(); h.render(); assert.equal(h.find("Bill name").props.value, "Updated transfer name"); assert.equal(h.state.calls.length, 0);
  const unsupported = harness({ editBill: { ...sourceBill, frequency: "yearly" } }, undefined, "AddBillModal");
  assert.ok(!unsupported.all().some(n => n.props.accessibilityLabel === "Change to transfer")); assert.match(unsupported.text(), /monthly and one-time bills/);
});
test("converted source Bill is history-only even if the linked transfer is soft-deleted", () => {
  const h = harness({ editBill: sourceBill, onResume: () => {}, onDelete: () => {} }, undefined, "AddBillModal");
  h.state.budget.plannedAccountTransfers = [{ id: "plan", source_bill_id: sourceBill.id, deleted_at: "2026-11-12" }]; h.render();
  assert.match(h.text(), /Changed to transfer/); assert.ok(h.all().some(n => n.type === "BillHistory"));
  assert.ok(!h.all().some(n => ["Bill name", "More bill actions", "Change to transfer"].includes(n.props.accessibilityLabel)));
  assert.doesNotMatch(h.text(), /Update Bill|Resume payments/); assert.equal(h.state.calls.length, 0);
});

test("existing Bill editing waits for transfer status but new Bills remain available during a failed read", async () => {
  const h = harness({ editBill: sourceBill }, undefined, "AddBillModal"); h.state.budget.plannedTransfersReady = false; h.render();
  assert.match(h.text(), /Loading bill details/); assert.ok(h.all().some(n => n.type === "BillHistory"));
  assert.ok(!h.all().some(n => ["Bill name", "Update Bill", "More bill actions", "Change to transfer"].includes(n.props.accessibilityLabel)));
  h.state.budget.plannedTransfersError = "unavailable"; h.render(); assert.match(h.text(), /Couldn’t load bill details/);
  h.find("Retry loading bill details").props.onPress(); assert.equal(h.state.calls[0].type, "retry");
  const fresh = harness({}, undefined, "AddBillModal"); fresh.state.budget.plannedTransfersReady = false; fresh.render();
  fresh.find("Bill name").props.onChangeText("Electric"); fresh.find("Payment amount").props.onChangeText("75"); fresh.render(); fresh.find("Add Bill").props.onPress();
  await new Promise(r => setTimeout(r, 0)); fresh.render(); assert.equal(fresh.state.calls.length, 1); assert.equal(fresh.state.calls[0].type, "bill");
});

test("Bill-status read guards leave demo Bills and debt editing available", () => {
  const demo = harness({ editBill: sourceBill }, undefined, "AddBillModal"); demo.state.budget.plannedTransfersReady = false; demo.state.budget.demoMode = true; demo.render();
  assert.equal(demo.find("Bill name").props.value, "Kids Transfer"); assert.ok(demo.find("Update Bill"));
  const debt = harness({ editBill: { ...sourceBill, is_debt: true, balance: 300, interest_rate: 0 }, forceDebt: true }, undefined, "AddBillModal");
  debt.state.budget.plannedTransfersReady = false; debt.render(); assert.ok(debt.find("Debt name")); assert.ok(debt.find("Update Debt"));
});

const convertedPlan = { id: "converted-plan", household_id: "home", budget_id: "budget", name: "Kids Transfer", amount: 50,
  from_account_ref: "manual:checking", to_account_ref: "manual:savings", frequency: "monthly", start_date: "2026-12-04", end_date: null,
  status: "active", deleted_at: null, revision: 1, source_bill_id: sourceBill.id };
test("converted plan editor opens its original Bill history and returns to its unchanged transfer draft", () => {
  const h = harness({ transfer: convertedPlan }); h.find("Transfer plan name").props.onChangeText("Children spending"); h.render();
  h.find("Earlier bill payments").props.onPress(); h.render(); const panel = h.all().find(n => n.type === "BillHistory")!;
  assert.equal(panel.props.billId, sourceBill.id); assert.equal(panel.props.billName, sourceBill.name);
  assert.equal(h.all().filter(n => n.type === "Modal").length, 1);
  assert.ok(!h.all().some(n => n.props.accessibilityLabel === "Save transfer plan" || n.props.accessibilityLabel === "Transfer plan name"));
  h.find("Back to transfer").props.onPress(); h.render(); assert.equal(h.find("Transfer plan name").props.value, "Children spending"); assert.equal(h.state.calls.length, 0);
});
test("old household or actor cannot mount linked Bill history after a transfer editor scope change", () => {
  for (const changed of ["household", "actor"]) {
    const h = harness({ transfer: convertedPlan }); h.find("Earlier bill payments").props.onPress(); h.render();
    assert.ok(h.all().some(n => n.type === "BillHistory"));
    if (changed === "household") h.state.budget.activeHousehold.householdId = "other";
    else h.state.user.id = "other-actor";
    h.render(); assert.ok(!h.all().some(n => n.type === "BillHistory"));
    assert.ok(!h.all().some(n => n.props.accessibilityLabel === "Earlier bill payments")); assert.equal(h.state.calls.length, 0);
  }
});
test("retired linked transfer has a lightweight history entry and never shows editable or nominal plan money", () => {
  const retired = { ...convertedPlan, deleted_at: "2026-11-12" }; const h = harness({}, undefined, "PlannedTransferManager");
  h.state.budget.plannedAccountTransfers = [retired]; h.render(); h.find("Earlier bill payments for Kids Transfer").props.onPress(); h.render();
  const editor = h.all().find(n => n.type === "TransferEditor")!; assert.equal(editor.props.visible, true); assert.equal(editor.props.initialHistory, true); assert.equal(editor.props.historyOnly, true);
  assert.equal(editor.props.transfer, retired); assert.ok(!h.text().includes("$50.00")); assert.doesNotMatch(h.text(), /Resume plan|Confirm delete transfer plan/);
  const modal = harness({ transfer: retired, initialHistory: true, historyOnly: true }); assert.ok(modal.all().some(n => n.type === "BillHistory"));
  assert.ok(!modal.all().some(n => ["Back to transfer", "Save transfer plan", "Transfer plan name", "Pause this transfer plan"].includes(n.props.accessibilityLabel)));
  h.state.budget.activeHousehold.householdId = "other"; h.render(); assert.ok(!h.all().some(n => n.props.accessibilityLabel === "Earlier bill payments for Kids Transfer")); assert.equal(h.state.calls.length, 0);
});

test("dedicated transfer page keeps create/read-only guards and performs no writes on open", () => {
  const h = harness({ presentation: "page", title: "Transfers" }, undefined, "PlannedTransferManager");
  assert.match(h.text(), /Plans only. Move the money in your bank app./);
  assert.ok(h.all().some(n => n.props.accessibilityRole === "header" && n.children.includes("Transfers")));
  h.find("Plan a transfer").props.onPress(); h.render();
  assert.equal(h.all().find(n => n.type === "TransferEditor")!.props.visible, true);
  assert.equal(h.state.calls.length, 0);
  h.state.budget.canEditHousehold = false; h.render();
  assert.ok(!h.all().some(n => n.props.accessibilityLabel === "Plan a transfer"));
  assert.equal(h.state.calls.length, 0);
});

test("transfer page loading disables create and failed reads offer a scoped retry", () => {
  const h = harness({ presentation: "page" }, undefined, "PlannedTransferManager");
  h.state.budget.plannedTransfersReady = false; h.render();
  assert.equal(h.find("Plan a transfer").props.disabled, true);
  h.state.budget.plannedTransfersError = "Plans unavailable"; h.render();
  assert.ok(h.all().some(n => n.props.accessibilityRole === "alert" && n.children.includes("Plans unavailable")));
  h.find("Retry loading transfer plans").props.onPress();
  assert.deepEqual(h.state.calls, [{ type: "retry", args: [] }]);
  h.state.budget.plannedTransfersReady = true; h.state.budget.plannedTransfersError = null; h.render();
  assert.equal(h.find("Plan a transfer").props.disabled, false);
});
