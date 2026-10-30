import { revealedPrivacyBindings, revealedPrivacyModule } from "./privacyTestHarness";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import * as schedule from "./schedule";
import { MONTH_NAMES } from "./dateLabels";
import { parseMoneyInput } from "./moneyFormInput";

function settingsHandlers() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const state = { calls: 0, haptics: 0, busy: false, newCategory: "New category", renaming: "Old" as string | null, errors: [] as string[], confirmation: null as any };
  const categoryDraftRef = { current: { renamingCategory: "Old", renameValue: "Renamed" } };
  const mutate = () => { state.calls++; return pending; };
  const bindings = revealedPrivacyBindings({
    Haptics: { impactAsync: () => { state.haptics++; }, ImpactFeedbackStyle: {} },
    deleteIncome: mutate, deleteCategory: mutate, addCategory: mutate, updateCategory: mutate,
    confirmAction: (options: any) => { state.confirmation = options; },
    newCategory: state.newCategory, renameValue: "Renamed", bills: [], transactions: [],
    categoryMutationInFlightRef: { current: false }, categoryDraftRef,
    setCategorySaveBusy: (busy: boolean) => { state.busy = busy; },
    setNewCategory: (next: (current: string) => string) => { state.newCategory = next(state.newCategory); },
    setRenamingCategory: (next: string | null) => { state.renaming = next; },
    showFormError: (title: string) => { state.errors.push(title); },
  });
  const source = readFileSync("app/(tabs)/more.tsx", "utf8");
  const body = source.slice(source.indexOf("  const handleDeleteIncome ="), source.indexOf("  const openAccount ="));
  const handlers = new Function(...Object.keys(bindings), `${transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText}; return { handleDeleteIncome, handleAddCategory, handleRenameCategory, handleDeleteCategory };`)(...Object.values(bindings));
  return { state, handlers, categoryDraftRef, resolve, reject };
}

test("Settings delete confirmations wait for persistence and propagate failures to the dialog", async () => {
  for (const kind of ["income", "category"]) {
    const h = settingsHandlers();
    if (kind === "income") h.handlers.handleDeleteIncome({ id: "income", name: "Paycheck" });
    else h.handlers.handleDeleteCategory("Old");
    const deletion = h.state.confirmation.onConfirm();
    assert.ok(deletion instanceof Promise);
    assert.equal(h.state.calls, 1); assert.equal(h.state.haptics, 0);
    const rejected = assert.rejects(deletion, /Offline/);
    h.reject(new Error("Offline")); await rejected;
    assert.equal(h.state.haptics, 0);
    const success = settingsHandlers();
    if (kind === "income") success.handlers.handleDeleteIncome({ id: "income", name: "Paycheck" });
    else success.handlers.handleDeleteCategory("Old");
    const finished = success.state.confirmation.onConfirm(); success.resolve(); await finished;
    assert.equal(success.state.haptics, 1);
  }
});

test("Settings category saves retain failed drafts and block duplicate pending mutations", async () => {
  for (const kind of ["add", "rename"]) {
    const h = settingsHandlers();
    const save = () => kind === "add" ? h.handlers.handleAddCategory() : h.handlers.handleRenameCategory("Old");
    const first = save(); await save();
    assert.equal(h.state.calls, 1); assert.equal(h.state.busy, true);
    assert.equal(h.state.newCategory, "New category"); assert.equal(h.state.renaming, "Old");
    h.reject(new Error("Offline")); await first;
    assert.equal(h.state.busy, false); assert.equal(h.state.haptics, 0);
    assert.equal(h.state.newCategory, "New category"); assert.equal(h.state.renaming, "Old");
    assert.equal(h.state.errors.length, 1);
  }
  const add = settingsHandlers(); const pending = add.handlers.handleAddCategory();
  add.state.newCategory = "Newer draft"; add.resolve(); await pending;
  assert.equal(add.state.newCategory, "Newer draft");
  const rename = settingsHandlers(); const renaming = rename.handlers.handleRenameCategory("Old");
  rename.categoryDraftRef.current.renameValue = "Newer draft"; rename.resolve(); await renaming;
  assert.equal(rename.state.renaming, "Old");
});

function flatten(node: any): any[] {
  return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
}
function text(node: any): string {
  return Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : typeof node === "string" ? node : "";
}
function incomeModal(clock: string, editItem?: any) {
  const states: any[] = [], effects: Array<() => void> = [], exports: any = {}, saved: any[] = [];
  let cursor = 0, dirty = false;
  const react = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) };
  const hooks = { __esModule: true, default: react,
    useState(initial: any) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], (value: any) => { const next = typeof value === "function" ? value(states[index]) : value; if (states[index] !== next) { states[index] = next; dirty = true; } }]; },
    useEffect(fn: () => void, deps: any[]) { const index = cursor++; if (!states[index] || deps.some((value, i) => value !== states[index][i])) { states[index] = deps; effects.push(fn); } },
  };
  const FixedDate = new Proxy(Date, { construct(target, args) { return Reflect.construct(target, args.length ? args : [clock]); } });
  const source = transpileModule(readFileSync("components/IncomeModal.tsx", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  new Function("exports", "require", "Date", source)(exports, (name: string) => {
    const privacyModule = revealedPrivacyModule(name);
    if (privacyModule) return privacyModule;
    if (name === "react") return hooks;
    if (name === "react-native") return { ...Object.fromEntries(["Modal", "Pressable", "ScrollView", "Text", "TextInput", "View", "KeyboardAvoidingView"].map(key => [key, key])), Platform: { OS: "web" }, StyleSheet: { create: (style: any) => style } };
    if (name.endsWith("/schedule")) return schedule;
    if (name.endsWith("/moneyFormInput")) return { parseMoneyInput };
    if (name.endsWith("/dateLabels")) return { MONTH_NAMES };
    if (name.endsWith("/useColors")) return { useColors: () => new Proxy({}, { get: () => "#000000" }) };
    if (name.endsWith("/useDesktopExperience")) return { useDesktopExperience: () => false };
    if (name.endsWith("/useBackDismiss")) return { useBackDismiss() {} };
    if (name.endsWith("/haptics")) return { impactAsync() {}, ImpactFeedbackStyle: {} };
    if (name.endsWith("/DatePickerField")) return { DatePickerField: "DatePickerField" };
    return { __esModule: true, default: {} };
  }, FixedDate);
  const render = () => {
    let tree: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      cursor = 0; dirty = false;
      tree = exports.IncomeModal({ visible: true, editItem, onClose() {}, onSave: async (item: any) => { saved.push(item); } });
      effects.splice(0).forEach(effect => effect()); if (!dirty) break;
    }
    return tree;
  };
  const button = (label: string) => flatten(render()).find(node => node.type === "Pressable" && text(node).startsWith(label));
  const fill = () => {
    flatten(render()).find(node => node.type === "TextInput" && node.props.placeholder === "e.g. Main Job").props.onChangeText("Last-day income");
    flatten(render()).find(node => node.type === "TextInput" && node.props.placeholder === "0.00").props.onChangeText("1000");
  };
  const picker = () => flatten(render()).find(node => node.type === "DatePickerField");
  return { render, button, fill, picker, saved, save: async () => { await button(editItem ? "Update" : "Add Income").props.onPress(); return saved.at(-1); } };
}

test("Last day saves real first paydays and a day-31 schedule across short months and edit round trips", async () => {
  for (const [clock, first, next] of [
    ["2026-11-10T12:00:00", "2026-11-30", "2026-12-31"],
    ["2026-04-10T12:00:00", "2026-04-30", "2026-05-31"],
    ["2026-02-10T12:00:00", "2026-02-28", "2026-03-31"],
    ["2028-02-10T12:00:00", "2028-02-29", "2028-03-31"],
    ["2026-12-31T12:00:00", "2026-12-31", "2027-01-31"],
  ]) {
    const h = incomeModal(clock); h.fill(); h.button("Last day").props.onPress();
    assert.equal(h.picker().props.value, first);
    const saved = await h.save(); assert.equal(saved.start_date, first);
    assert.equal(Number(saved.next_payment_date.slice(8)), 31);
    const [year, month, day] = first.split("-").map(Number);
    assert.deepEqual(schedule.getIncomeOccurrenceDays(saved, month - 1, year), [day]);
    const [nextYear, nextMonth, nextDay] = next.split("-").map(Number);
    assert.deepEqual(schedule.getIncomeOccurrenceDays(saved, nextMonth - 1, nextYear), [nextDay]);
    assert.deepEqual(schedule.getUpcomingIncomeOccurrenceDates(saved, first, 2), [first, next]);
    const reopened = incomeModal(clock, { ...saved, id: "income" });
    assert.equal(reopened.picker().props.value, first);
    assert.equal(reopened.button("Last day").props.accessibilityState.selected, true);
    assert.deepEqual(await reopened.save(), { ...saved, excluded_dates: [], id: "income" });
  }
});

test("custom dates and frequency changes clear Last day while First day keeps its own schedule", async () => {
  const custom = incomeModal("2026-11-10T12:00:00"); custom.fill(); custom.button("Last day").props.onPress();
  custom.picker().props.onChange("2026-11-18");
  const saved = await custom.save(); assert.equal(saved.next_payment_date, "2026-11-18");
  assert.deepEqual(schedule.getIncomeOccurrenceDays(saved, 11, 2026), [18]);
  const changed = incomeModal("2026-11-10T12:00:00"); changed.fill(); changed.button("Last day").props.onPress();
  changed.button("Weekly").props.onPress(); changed.button("Monthly").props.onPress();
  assert.equal(changed.button("Last day").props.accessibilityState.selected, false);
  assert.equal((await changed.save()).next_payment_date, "2026-11-30");
  const first = incomeModal("2026-12-10T12:00:00"); first.fill(); first.button("First day").props.onPress();
  assert.equal(first.picker().props.value, "2027-01-01");
  assert.equal((await first.save()).start_date, "2027-01-01");
});
