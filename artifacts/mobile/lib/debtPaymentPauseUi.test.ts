import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import * as pauseDomain from "./debtPaymentPause";
import * as dateLabels from "./dateLabels";
import * as editPersistence from "./billEditPersistence";
import * as moneyInput from "./moneyFormInput";
import * as billImportance from "./billImportance";
import { matchesBillSearch } from "./billSearch";
import { orderActiveDebtsForStrategy } from "./debtOrder";
import { createNestedOverlayHistory } from "./nestedOverlayHistory";
import { revealedPrivacyModule } from "./privacyTestHarness";

function flatten(node: any): any[] {
  return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
}
function copy(node: any): string {
  return Array.isArray(node) ? node.map(copy).join(" ") : node && typeof node === "object" ? copy(node.props?.children) : typeof node === "string" ? node : "";
}
const debt = { id: "first", name: "First card", amount: 100, balance: 800, interest_rate: 12, category: "Debt", priority: 0, due_day: 15, day_of_week: 0, smart_priority: "must", is_debt: true, is_recurring: true, frequency: "monthly", include_in_snowball: true, created_at: "2026-01-01" };
const savedPause = { id: "pause-1", start_date: "2026-01-31", resume_date: "2026-03-31", redirect_payment: true };

function browserHistory() {
  const stack: any[] = [{ route: "previous" }, { route: "bills" }];
  const listeners = new Set<(event: any) => void>();
  const queue: (() => void)[] = [];
  let index = 1;
  const host = {
    history: {
      get state() { return stack[index]; },
      pushState(value: any) { stack.splice(index + 1); stack.push(value); index++; },
      replaceState(value: any) { stack[index] = value; },
      back() { queue.push(() => { if (index > 0) { index--; const event = { state: stack[index] }; [...listeners].forEach(listener => listener(event)); } }); },
    },
    location: { href: "https://example.test/bills?view=debt" },
    addEventListener(_type: string, callback: (event: any) => void) { listeners.add(callback); },
    removeEventListener(_type: string, callback: (event: any) => void) { listeners.delete(callback); },
  };
  return { host, position: () => index, listeners, flush() { while (queue.length) queue.shift()!(); } };
}

const compiled = new Map<string, string>();
function harness(component: string, props: Record<string, any> = {}, options: { budget?: Record<string, any>; browser?: ReturnType<typeof browserHistory>; native?: boolean; today?: string; view?: string } = {}) {
  const states: any[] = [], effects: (() => void)[] = [], cleanups = new Map<number, () => void>();
  const budget: any = { bills: [{ ...debt }], categories: ["Other", "Debt"], settings: { debtPayoffEnabled: true }, householdTimeZone: "Pacific/Kiritimati", activeHousehold: { householdId: "home", budgetId: "budget", role: "owner" }, canEditHousehold: true, pauseDebtPayments: async () => {}, editDebtPaymentPause: async () => {}, resumeDebtPayments: async () => {}, getDebtMonthSettlements: () => new Map(), pendingPlanMatches: [], pendingBankTransactions: [], getMonthlyBills: () => budget.bills, getBillOccurrencesInMonth: () => [15], getBillMonthlyTotal: (bill: any) => bill.amount, getBillEffectiveMonthlyTotal: (bill: any) => bill.amount, getPaidAmount: () => 0, getExtraPayment: () => undefined, getDebtPlanForMonth: () => null, getRemainingDebtPlanForMonth: () => null, previewDebtSnowball: () => ({ safeMaximum: 0 }), ...options.budget };
  let cursor = 0, dirty = false, lastBack: (() => void) | undefined, lastDepth: boolean | number | undefined;
  const zones: string[] = [];
  const react = { createElement: (type: any, elementProps: any, ...children: any[]) => ({ type, props: { ...elementProps, children } }) };
  const hooks = {
    __esModule: true, default: react,
    useState(initial: any) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (next: any) => { const value = typeof next === "function" ? next(states[i]) : next; if (!Object.is(states[i], value)) { states[i] = value; dirty = true; } }]; },
    useRef(initial: any) { const i = cursor++; return states[i] ??= { current: initial }; },
    useMemo(fn: () => any, deps?: any[]) { const i = cursor++; const prior = states[i]; if (!prior || !deps || deps.some((value, index) => !Object.is(value, prior.deps[index]))) states[i] = { deps, value: fn() }; return states[i].value; },
    useCallback(fn: any, deps?: any[]) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn: () => any, deps?: any[]) { const i = cursor++; const prior = states[i]; if (!prior || !deps || deps.some((value, index) => !Object.is(value, prior[index]))) { states[i] = deps; effects.push(() => { cleanups.get(i)?.(); const cleanup = fn(); if (typeof cleanup === "function") cleanups.set(i, cleanup); }); } },
  };
  const native = { ...Object.fromEntries(["Modal", "Pressable", "Text", "View", "ScrollView", "TextInput", "KeyboardAvoidingView", "Switch", "FlatList", "ActivityIndicator"].map(name => [name, name])), Keyboard: { dismiss() {} }, Platform: { OS: options.native ? "android" : "web" }, StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {}, hairlineWidth: 1 } };
  const hookModule: any = {};
  if (options.browser) {
    const source = transpileModule(readFileSync("hooks/useBackDismiss.ts", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
    new Function("exports", "require", "window", source)(hookModule, (name: string) => name === "react" ? hooks : name === "react-native" ? native : name.endsWith("nestedOverlayHistory") ? { createNestedOverlayHistory } : { useOverlayActivity() {} }, options.browser.host);
  }
  const exported: any = {};
  const path = component === "DebtsDesktop" ? "components/desktop/DesktopBillsDebtsPage.tsx" : component === "BillsScreen" ? "app/(tabs)/bills.tsx" : `components/${component}.tsx`;
  if (!compiled.has(path)) compiled.set(path, transpileModule(readFileSync(path, "utf8") + (component === "DebtsDesktop" ? "\nexport { DebtsDesktop };" : ""), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText);
  new Function("exports", "require", "requestAnimationFrame", "cancelAnimationFrame", compiled.get(path)!)(exported, (name: string) => {
    const privacy = revealedPrivacyModule(name); if (privacy) return privacy;
    if (name === "react") return hooks;
    if (name === "react-native") return native;
    if (name === "expo-router") return { useLocalSearchParams: () => ({ view: options.view ?? "debt" }), useRouter: () => ({ setParams() {}, push() {} }) };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    const leaf = name.split("/").at(-1)!;
    if (leaf === "BudgetContext") return { useBudget: () => budget };
    if (leaf === "AuthContext") return { useAuth: () => ({ user: { id: "owner" } }) };
    if (leaf === "AppDiscoveryContext") return { useAppDiscovery: () => ({ dismissedNotificationIds: [], dismissNotification() {} }) };
    if (leaf === "useColors") return { useColors: () => new Proxy({}, { get: () => "#123456" }) };
    if (leaf === "useDesktopExperience") return { useDesktopExperience: () => false };
    if (leaf === "useLocalDay") return { useLocalDay: () => options.today ?? "2026-01-31" };
    if (leaf === "useBackDismiss") return { useBackDismiss(active: boolean, back: () => void, blocks: boolean, depth: boolean | number) { lastBack = back; lastDepth = depth; if (options.browser) hookModule.useBackDismiss(active, back, blocks, depth); } };
    if (leaf === "dateLabels") return dateLabels;
    if (leaf === "debtPaymentPause") return pauseDomain;
    if (leaf === "billEditPersistence") return editPersistence;
    if (leaf === "moneyFormInput") return moneyInput;
    if (leaf === "billImportance") return billImportance;
    if (leaf === "billSearch") return { matchesBillSearch };
    if (leaf === "dailyCheckingClose") return { localDateInTimeZone(_date: Date, zone: string) { zones.push(zone); return options.today ?? "2026-01-31"; } };
    if (leaf === "debtOrder") return { orderActiveDebtsForStrategy };
    if (leaf === "snowball") return { effectiveDebtMinimum: (amount: number, boost: number) => amount + boost };
    if (leaf === "debtPaymentPlan") return { requiredDebtPlanTotal: (bill: any, count: number) => bill.amount * count };
    if (leaf === "debtPlanDomain") return { debtOccurrenceProgress: () => ({ label: "Scheduled", hasPartial: false }) };
    if (leaf === "overdueBills") return { buildOverdueBillOccurrences: () => [], groupOverdueBills: () => [] };
    if (leaf === "pendingPlanMatches") return { activePendingPlanMatches: () => [], pendingOccurrenceKeySet: () => new Set() };
    if (leaf === "haptics") return { impactAsync() {}, ImpactFeedbackStyle: {} };
    if (leaf === "colors") return { __esModule: true, default: { radius: 12 } };
    if (leaf === "DesktopUI") return { ...Object.fromEntries(["CardHeader", "DesktopCard", "DesktopPage", "DesktopSearch", "EmptyState", "FilterButton", "PageHeader", "PrimaryButton", "StatusBadge", "SummaryMetricCard", "Toggle"].map(name => [name, name])), desktopPalette: {}, desktopTableStyles: {} };
    if (name.includes("/components/")) return { [leaf]: leaf, ConfirmActionOverlay: "ConfirmActionOverlay" };
    return {};
  }, (callback: () => void) => { callback(); return 1; }, () => {});
  const render = () => { let tree: any; for (let i = 0; i < 10; i++) { cursor = 0; dirty = false; tree = (exported[component] ?? exported.default)(props); effects.splice(0).forEach(run => run()); if (!dirty) return tree; } throw new Error("Render did not settle"); };
  const button = (label: string) => flatten(render()).find(node => node.type === "Pressable" && node.props.accessibilityLabel === label);
  const child = (name: string) => flatten(render()).find(node => node.type === name);
  return { props, budget, render, button, child, zones, back: () => lastBack!(), depth: () => lastDepth, unmount: () => cleanups.forEach(cleanup => cleanup()) };
}

function pauseHarness(extra: Record<string, any> = {}, options: Parameters<typeof harness>[2] = {}) {
  const writes: any[] = [], pending: boolean[] = []; let closes = 0;
  const props: any = { visible: true, bill: { ...debt }, today: "2026-01-31", canEdit: true, redirectEnabled: true, openDateField: null, step: "dates",
    onOpenDateFieldChange(field: string | null) { props.openDateField = field; }, onSavingChange(value: boolean) { pending.push(value); }, onClose() { closes++; }, onSave: async (input: any) => { writes.push(input); }, ...extra };
  props.onStepChange = (step: string) => { props.step = step; extra.onStepChange?.(step); };
  return { ...harness("DebtPaymentPauseModal", props, options), writes, pending, closes: () => closes };
}

test("opening and cancelling a debt pause never saves; default resume clamps calendar month boundaries", () => {
  for (const [today, resume] of [["2026-01-31", "2026-03-31"], ["2026-12-31", "2027-02-28"], ["2027-12-31", "2028-02-29"]]) {
    const h = pauseHarness({ today });
    const fields = flatten(h.render()).filter(node => node.type === "DatePickerField");
    assert.equal(fields[0].props.value, today); assert.equal(fields[1].props.value, resume);
    h.button("Cancel").props.onPress(); assert.deepEqual(h.writes, []); assert.equal(h.closes(), 1);
  }
});

test("pause choice is final, explicit and reversible without writing or losing dates", async () => {
  const h = pauseHarness();
  assert.equal(h.button("Pause payments"), undefined);
  assert.equal(h.button("Yes, use payoff order"), undefined);
  h.button("Continue").props.onPress();
  assert.equal(h.props.step, "transfer");
  assert.equal(h.button("Pause payments").props.disabled, true);
  assert.equal(h.button("Yes, use payoff order").props.accessibilityState.checked, false);
  assert.equal(h.button("No, keep it available").props.accessibilityState.checked, false);
  assert.equal(h.button("Yes, use payoff order").props["aria-checked"], false);
  assert.equal(h.button("No, keep it available").props["aria-checked"], false);
  await h.button("Pause payments").props.onPress();
  assert.equal(h.writes.length, 0);
  let prevented = 0;
  h.button("Yes, use payoff order").props.onKeyDown({ key: " ", preventDefault() { prevented++; }, stopPropagation() {} });
  assert.equal(h.button("Yes, use payoff order").props["aria-checked"], true);
  assert.equal(h.writes.length, 0);
  h.button("No, keep it available").props.onKeyDown({ key: " ", preventDefault() { prevented++; }, stopPropagation() {} });
  assert.equal(prevented, 2);
  assert.equal(h.button("No, keep it available").props["aria-checked"], true);
  h.button("Back").props.onPress();
  assert.equal(h.props.step, "dates");
  assert.deepEqual(flatten(h.render()).filter(node => node.type === "DatePickerField").map(node => node.props.value), ["2026-01-31", "2026-03-31"]);
  h.button("Continue").props.onPress();
  assert.equal(h.button("No, keep it available").props.accessibilityState.checked, true);
  assert.equal(h.button("Yes, use payoff order").props["aria-checked"], false);
  assert.equal(h.button("No, keep it available").props["aria-checked"], true);
  h.button("Close debt payment pause").props.onPress();
  assert.equal(h.closes(), 1);
  assert.equal(h.writes.length, 0);
  const native = pauseHarness({}, { native: true });
  native.button("Continue").props.onPress();
  assert.equal(native.button("Yes, use payoff order").props.onKeyDown, undefined);
  assert.equal(native.button("No, keep it available").props.onKeyDown, undefined);
});

test("pause save waits for persistence, blocks rapid duplicate submits and retains choice and dates after a retryable failure", async () => {
  let fail!: (error: Error) => void, finish!: () => void;
  let promise = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const writes: any[] = [];
  const h = pauseHarness({ onSave: (input: any) => { writes.push(input); return promise; } });
  flatten(h.render()).find(node => node.type === "DatePickerField" && node.props.label === "Pause starts").props.onChange("2026-02-05");
  flatten(h.render()).find(node => node.type === "DatePickerField" && node.props.label === "Payments resume").props.onChange("2026-04-05");
  h.button("Continue").props.onPress(); h.button("Yes, use payoff order").props.onPress();
  const submit = h.button("Pause payments"); const first = submit.props.onPress(); await submit.props.onPress();
  assert.deepEqual(writes, [{ startDate: "2026-02-05", resumeDate: "2026-04-05", redirectPayment: true }]);
  assert.equal(h.closes(), 0); assert.equal(h.button("Back").props.disabled, true);
  assert.ok(["Yes, use payoff order", "No, keep it available"].every(label => h.button(label).props.disabled));
  h.button("No, keep it available").props.onPress();
  h.button("No, keep it available").props.onKeyDown({ key: " ", preventDefault() {}, stopPropagation() {} });
  assert.equal(h.button("Yes, use payoff order").props["aria-checked"], true);
  assert.equal(h.button("No, keep it available").props["aria-checked"], false);
  h.button("Back").props.onPress(); assert.equal(h.props.step, "transfer");
  h.button("Close debt payment pause").props.onPress(); assert.equal(h.closes(), 0);
  fail(new Error("Fictional connection failed")); await first;
  assert.match(copy(h.render()), /Fictional connection failed/); assert.equal(h.closes(), 0);
  assert.equal(h.button("Yes, use payoff order").props.accessibilityState.checked, true);
  h.button("Back").props.onPress();
  const values = flatten(h.render()).filter(node => node.type === "DatePickerField").map(node => node.props.value);
  assert.deepEqual(values, ["2026-02-05", "2026-04-05"]);
  h.button("Continue").props.onPress();
  promise = new Promise<void>(resolve => { finish = resolve; });
  const retry = h.button("Pause payments").props.onPress(); finish(); await retry;
  assert.equal(h.closes(), 1); assert.equal(writes.length, 2); assert.deepEqual(writes[1], writes[0]); assert.deepEqual(h.pending, [true, false, true, false]);
});

test("plan-off pause offers an explicit pause-only choice and rejects stale disabled yes callbacks", async () => {
  const h = pauseHarness({ redirectEnabled: false });
  h.button("Continue").props.onPress();
  const yes = h.button("Yes, use payoff order");
  assert.equal(yes.props.accessibilityState.checked, false); assert.equal(yes.props.disabled, true);
  assert.match(copy(h.render()), /You can still pause this debt/);
  yes.props.onPress();
  yes.props.onKeyDown({ key: " ", preventDefault() {}, stopPropagation() {} });
  assert.equal(h.button("Pause payments").props.disabled, true);
  h.button("No, keep it available").props.onPress(); await h.button("Pause payments").props.onPress();
  assert.deepEqual(h.writes, [{ startDate: "2026-01-31", resumeDate: "2026-03-31", redirectPayment: false }]);
});

test("losing the global payoff plan invalidates a prior yes and requires a fresh explicit choice", async () => {
  const h = pauseHarness(); h.button("Continue").props.onPress(); h.button("Yes, use payoff order").props.onPress();
  h.props.redirectEnabled = false;
  assert.equal(h.button("Yes, use payoff order").props.accessibilityState.checked, false);
  assert.equal(h.button("Pause payments").props.disabled, true);
  await h.button("Pause payments").props.onPress(); assert.equal(h.writes.length, 0);
  h.button("No, keep it available").props.onPress(); await h.button("Pause payments").props.onPress();
  assert.equal(h.writes[0].redirectPayment, false);
});

test("invalid or overlapping dates and unavailable debts cannot invoke the saved pause callback", async () => {
  const invalid = pauseHarness();
  flatten(invalid.render()).find(node => node.type === "DatePickerField" && node.props.label === "Payments resume").props.onChange("2026-01-31");
  await invalid.button("Continue").props.onPress(); assert.equal(invalid.writes.length, 0); assert.match(copy(invalid.render()), /resume after/);
  const overlap = pauseHarness({ bill: { ...debt, debt_payment_pauses: [savedPause] } });
  await overlap.button("Continue").props.onPress(); assert.equal(overlap.writes.length, 0); assert.match(copy(overlap.render()), /cannot overlap/);
  for (const overrides of [{ canEdit: false }, { bill: { ...debt, balance: 0 } }, { bill: { ...debt, end_date: "2026-01-31" } }, { bill: { ...debt, is_debt: false } }]) {
    const h = pauseHarness(overrides); await h.button("Continue").props.onPress(); assert.equal(h.writes.length, 0); assert.equal(h.button("Continue").props.disabled, true);
  }
});

function editorHarness(options: Parameters<typeof harness>[2] = {}) {
  let closes = 0;
  const props: any = { visible: true, editBill: { ...debt }, forceDebt: true, onClose() { closes++; props.visible = false; }, onSave: async () => {}, onStopFuture: async () => {} };
  return { ...harness("AddBillModal", props, options), closes: () => closes };
}

test("shared debt editor saves only pause metadata and retains selection, original minimum and other unsaved fields", async () => {
  const writes: any[] = [], updates: any[] = [];
  const h = editorHarness({ budget: { pauseDebtPayments: async (id: string, input: any) => { writes.push({ id, input }); h.budget.bills = [{ ...debt, debt_payment_pauses: [savedPause] }]; } } });
  h.props.onSave = async (...args: any[]) => { updates.push(args); };
  flatten(h.render()).find(node => node.type === "TextInput" && node.props.placeholder === "e.g. Car Loan").props.onChangeText("Unsaved card name");
  h.button("Pause debt payments").props.onPress();
  const overlay = h.child("DebtPaymentPauseModal"); assert.equal(overlay.props.visible, true);
  await overlay.props.onSave({ startDate: "2026-01-31", resumeDate: "2026-03-31", redirectPayment: true }); overlay.props.onClose();
  assert.equal(h.closes(), 0); assert.equal(h.props.editBill.id, "first"); assert.match(copy(h.render()), /Payments paused/); assert.ok(h.button("Resume now"));
  assert.equal(h.zones.at(-1), "Pacific/Kiritimati"); assert.equal(writes.length, 1); assert.equal(updates.length, 0);
  const update = flatten(h.render()).find(node => node.type === "Pressable" && copy(node).includes("Update Debt")); await update.props.onPress();
  assert.equal(updates[0][0].name, "Unsaved card name"); assert.equal(updates[0][0].amount, 100);
  assert.deepEqual(updates[0][0].debt_payment_pauses, [savedPause]); assert.deepEqual(updates[0][1], ["name"]);
});

test("debt actions never stop the bill and stale/read-only pause callbacks are rejected", async () => {
  let writes = 0;
  const h = editorHarness({ budget: { pauseDebtPayments: async () => { writes++; } } });
  h.button("More bill actions").props.onPress(); assert.equal(h.button("Pause First card"), undefined);
  h.button("Pause debt payments").props.onPress(); const oldSave = h.child("DebtPaymentPauseModal").props.onSave;
  h.budget.canEditHousehold = false; h.render();
  await assert.rejects(oldSave({ startDate: "2026-01-31", resumeDate: "2026-03-31", redirectPayment: true }), /editing access changed/);
  assert.equal(writes, 0);
});

test("resume and scheduled cancellation retain errors and send exactly the selected saved pause id", async () => {
  for (const [start, label] of [["2026-01-01", "Resume now"], ["2026-02-01", "Cancel scheduled pause"]]) {
    const calls: any[] = []; let fail = true;
    const h = editorHarness({ budget: { bills: [{ ...debt, debt_payment_pauses: [{ ...savedPause, start_date: start }] }], resumeDebtPayments: async (...args: any[]) => { calls.push(args); if (fail) throw new Error("Try fictional resume again"); } } });
    await h.button(label).props.onPress(); assert.match(copy(h.render()), /Try fictional resume again/); assert.equal(h.closes(), 0);
    fail = false; await h.button(label).props.onPress(); assert.deepEqual(calls, [["first", "pause-1"], ["first", "pause-1"]]);
  }
});

test("browser Back closes calendar, pause, then editor while cancellation consumes only its owned entry", () => {
  const browser = browserHistory(), h = editorHarness({ browser }); h.render(); assert.equal(browser.position(), 2);
  h.button("Pause debt payments").props.onPress(); h.render(); assert.equal(browser.position(), 3);
  h.child("DebtPaymentPauseModal").props.onOpenDateFieldChange("start"); h.render(); assert.equal(h.depth(), 2);
  browser.host.history.back(); browser.flush(); h.render();
  assert.equal(h.child("DebtPaymentPauseModal").props.openDateField, null); assert.equal(h.child("DebtPaymentPauseModal").props.visible, true); assert.equal(h.closes(), 0); assert.equal(browser.position(), 3);
  browser.host.history.back(); browser.flush(); h.render(); assert.equal(h.child("DebtPaymentPauseModal").props.visible, false); assert.equal(h.closes(), 0); assert.equal(browser.position(), 2);
  h.button("Pause debt payments").props.onPress(); h.render();
  h.child("DebtPaymentPauseModal").props.onClose(); h.render(); browser.flush(); h.render(); assert.equal(h.closes(), 0); assert.equal(browser.position(), 2);
  browser.host.history.back(); browser.flush(); h.render(); assert.equal(h.closes(), 1); assert.equal(browser.position(), 1); assert.equal(browser.listeners.size, 0);
});

test("closing a calendar through UI keeps the next browser Back available for the pause", () => {
  const browser = browserHistory(), h = editorHarness({ browser }); h.button("Pause debt payments").props.onPress(); h.render();
  h.child("DebtPaymentPauseModal").props.onOpenDateFieldChange("resume"); h.render();
  h.child("DebtPaymentPauseModal").props.onOpenDateFieldChange(null); h.render();
  browser.host.history.back(); browser.flush(); h.render(); assert.equal(h.child("DebtPaymentPauseModal").props.visible, false); assert.equal(h.closes(), 0);
  h.unmount();
});

test("browser Back respects confirmation depth and pending-save rearm, then failure preserves the next Back order", async () => {
  let fail!: (error: Error) => void, calls = 0;
  const browser = browserHistory();
  const h = editorHarness({ browser, budget: { pauseDebtPayments: () => { calls++; return new Promise<void>((_resolve, reject) => { fail = reject; }); } } });
  h.button("Pause debt payments").props.onPress();
  const child = pauseHarness(h.child("DebtPaymentPauseModal").props);
  child.button("Continue").props.onPress(); h.render();
  assert.equal(h.depth(), 2);
  assert.equal(h.child("DebtPaymentPauseModal").props.step, "transfer");
  child.button("Yes, use payoff order").props.onPress();
  const request = child.button("Pause payments").props.onPress(); h.render();
  for (let attempt = 0; attempt < 2; attempt++) {
    browser.host.history.back(); browser.flush(); h.render();
    assert.equal(h.child("DebtPaymentPauseModal").props.visible, true);
    assert.equal(h.child("DebtPaymentPauseModal").props.step, "transfer");
    assert.equal(browser.position(), 3); assert.equal(h.closes(), 0);
  }
  fail(new Error("Fictional rejected pause")); await request; h.render();
  assert.match(copy(child.render()), /Fictional rejected pause/); assert.equal(calls, 1);
  browser.host.history.back(); browser.flush(); h.render();
  assert.equal(h.child("DebtPaymentPauseModal").props.step, "dates");
  assert.equal(h.child("DebtPaymentPauseModal").props.visible, true);
  assert.equal(h.closes(), 0);
  browser.host.history.back(); browser.flush(); h.render();
  assert.equal(h.child("DebtPaymentPauseModal").props.visible, false); assert.equal(browser.position(), 2);
  browser.host.history.back(); browser.flush(); h.render(); assert.equal(h.closes(), 1); assert.equal(browser.position(), 1);
});

test("confirmation UI Back preserves the calendar and editor history ownership", () => {
  const browser = browserHistory(), h = editorHarness({ browser });
  h.button("Pause debt payments").props.onPress();
  h.child("DebtPaymentPauseModal").props.onStepChange("transfer"); h.render();
  assert.equal(h.depth(), 2);
  h.child("DebtPaymentPauseModal").props.onStepChange("dates"); h.render(); browser.flush(); h.render();
  assert.equal(h.depth(), 1);
  h.child("DebtPaymentPauseModal").props.onOpenDateFieldChange("resume"); h.render();
  browser.host.history.back(); browser.flush(); h.render();
  assert.equal(h.child("DebtPaymentPauseModal").props.openDateField, null);
  assert.equal(h.child("DebtPaymentPauseModal").props.step, "dates");
  browser.host.history.back(); browser.flush(); h.render();
  assert.equal(h.child("DebtPaymentPauseModal").props.visible, false); assert.equal(h.closes(), 0);
  h.unmount();
});

test("native requestClose honors pending-save, calendar, pause and existing payment-history priorities without saving", () => {
  let writes = 0; const h = editorHarness({ native: true, budget: { pauseDebtPayments: async () => { writes++; } } });
  h.button("Pause debt payments").props.onPress();
  h.child("DebtPaymentPauseModal").props.onStepChange("transfer"); h.render();
  h.child("DebtPaymentPauseModal").props.onSavingChange(true); h.child("Modal").props.onRequestClose(); h.render();
  assert.equal(h.child("DebtPaymentPauseModal").props.step, "transfer");
  h.child("DebtPaymentPauseModal").props.onSavingChange(false); h.child("Modal").props.onRequestClose(); h.render();
  assert.equal(h.child("DebtPaymentPauseModal").props.step, "dates");
  h.child("DebtPaymentPauseModal").props.onOpenDateFieldChange("start"); h.render();
  h.child("DebtPaymentPauseModal").props.onSavingChange(true); h.child("Modal").props.onRequestClose(); h.render(); assert.equal(h.child("DebtPaymentPauseModal").props.openDateField, "start");
  h.child("DebtPaymentPauseModal").props.onSavingChange(false); h.child("Modal").props.onRequestClose(); h.render(); assert.equal(h.child("DebtPaymentPauseModal").props.openDateField, null);
  h.child("Modal").props.onRequestClose(); h.render(); assert.equal(h.child("DebtPaymentPauseModal").props.visible, false); assert.equal(h.closes(), 0);
  h.button("Payment history for First card").props.onPress(); h.render(); assert.ok(h.child("BillPaymentHistoryPanel"));
  h.child("Modal").props.onRequestClose(); h.render(); assert.equal(h.child("BillPaymentHistoryPanel"), undefined); assert.equal(h.closes(), 0); assert.equal(writes, 0);
  h.child("Modal").props.onRequestClose(); assert.equal(h.closes(), 1);
});

test("shared date picker preserves uncontrolled callbacks and exposes controlled dates with accessible pending state", () => {
  const dates: string[] = [];
  const h = harness("DatePickerField", { label: "Pause starts", value: "2026-01-31", onChange: (date: string) => dates.push(date) });
  h.button("Pause starts: January 31, 2026").props.onPress(); assert.equal(h.button("Pause starts: January 31, 2026").props.accessibilityState.expanded, true);
  h.button("Next month").props.onPress(); h.button("February 28, 2026").props.onPress(); assert.deepEqual(dates, ["2026-02-28"]);
  assert.equal(h.button("Pause starts: January 31, 2026").props.accessibilityState.expanded, false);
  h.props.open = true; h.props.disabled = true; assert.equal(h.button("February 28, 2026")?.props.disabled, true); assert.equal(h.button("Pause starts: January 31, 2026").props.disabled, true);
});

test("desktop debt list keeps a saved paused debt visible in the same rank and opens the same saved record", () => {
  const opened: any[] = [], bills: any[] = [{ ...debt }, { ...debt, id: "second", name: "Second card", balance: 2400 }];
  const h = harness("DebtsDesktop", { bills, search: "", onSearch() {}, sort: "snowball", onSort() {}, onAdd() {}, onOpen: (bill: any) => opened.push(bill), onPlan() {}, getOccurrences: () => [15], datedPlan: { payments: [{ billId: "first", totalPayment: 0 }, { billId: "second", totalPayment: 200 }], allocations: [] }, now: new Date(2026, 0, 31, 12) });
  const rows = () => flatten(h.render()).filter(node => node.type === "Pressable" && ["first", "second"].includes(node.props.key));
  assert.deepEqual(rows().map(row => row.props.key), ["first", "second"]);
  bills[0] = { ...bills[0], debt_payment_pauses: [savedPause] };
  assert.deepEqual(rows().map(row => row.props.key), ["first", "second"]);
  const badges = flatten(rows()[0]).filter(node => node.type === "StatusBadge").map(node => node.props.label);
  assert.ok(badges.includes("Payments paused")); assert.ok(badges.includes("Smallest")); assert.match(copy(rows()[0]), /\$800.00/); assert.match(copy(rows()[0]), /\$0.00/);
  rows()[0].props.onPress(); assert.equal(opened[0], bills[0]); assert.equal(opened[0].balance, 800); assert.equal(opened[0].amount, 100); assert.equal(opened[0].include_in_snowball, true);
});

test("mobile debt hero renders canonical remaining cash for pause-only and no-recipient plans while keeping lender minimums and rank", () => {
  for (const [remaining, extra, enabled] of [[0, 0, false], [0, 0, true], [150, 75, true]] as const) {
    const bills = [{ ...debt, debt_payment_pauses: [savedPause] }, { ...debt, id: "second", name: "Second card", balance: 2400 }];
    const plan = { plannedPayment: remaining, payments: [{ billId: "first", totalPayment: 0 }, { billId: "second", totalPayment: remaining }], allocations: extra ? [{ kind: "required", amount: 75, targetBillId: "second" }, { kind: "rollover", amount: extra, targetBillId: "second" }] : [] };
    const h = harness("BillsScreen", {}, { budget: { bills, settings: { debtPayoffEnabled: enabled }, getExtraPayment: () => ({ id: "saved-extra", amount: 25 }), getDebtPlanForMonth: () => plan, getRemainingDebtPlanForMonth: () => plan } });
    const list = h.child("FlatList"), header = list.props.ListHeaderComponent;
    if (enabled) {
      const remainingPanel = flatten(header).find(node => node.type === "View" && node.props.children.length === 2 && copy(node.props.children[0]).includes("PAYOFF EXTRA") && copy(node.props.children[1]).includes("REMAINING PLAN"));
      assert.ok(remainingPanel); assert.match(copy(remainingPanel.props.children[0]), new RegExp(`PAYOFF EXTRA.*\\+\\$\\s*${extra}`));
      assert.match(copy(remainingPanel.props.children[1]), new RegExp(`REMAINING PLAN.*\\$\\s*${remaining}`));
      assert.match(copy(header), /\$\s*200\s+Required \/ month/); assert.match(copy(header), /Current target\s+Second card/);
    }
    assert.deepEqual(list.props.data.map((bill: any) => bill.id), ["first", "second"]);
    const pausedCard = copy(list.props.renderItem({ item: bills[0] }));
    assert.match(pausedCard, /#1.*First card.*\$800\.00.*Payments paused/);
    assert.match(pausedCard, /Required \/ month.*\$100\.00/);
    assert.match(pausedCard, /Payments paused — keeps its payoff position/);
    assert.doesNotMatch(pausedCard, /Target first — put all extra here/);
  }
  const upcoming = { ...debt, debt_payment_pauses: [{ ...savedPause, start_date: "2026-02-01" }] };
  const scheduled = harness("BillsScreen", {}, { budget: { bills: [upcoming] } });
  const scheduledCard = copy(scheduled.child("FlatList").props.renderItem({ item: upcoming }));
  assert.match(scheduledCard, /#1.*First card.*Pause scheduled/);
  assert.match(scheduledCard, /Current payoff target/);
  assert.doesNotMatch(scheduledCard, /Payments paused — keeps its payoff position/);
  for (const enabled of [true, false]) {
    for (const paused of [true, false]) {
      const ordered = [
        { ...debt, debt_payment_pauses: [{ ...savedPause, start_date: paused ? "2026-01-31" : "2026-02-01" }] },
        { ...debt, id: "second", name: "Second card", balance: 2400 },
        { ...debt, id: "third", name: "Third card", balance: 6400 },
      ];
      const h = harness("BillsScreen", {}, { budget: { bills: ordered, settings: { debtPayoffEnabled: enabled } } });
      const list = h.child("FlatList");
      assert.deepEqual(list.props.data.map((bill: any) => bill.id), ["first", "second", "third"]);
      const cards = ordered.map(bill => copy(list.props.renderItem({ item: bill })));
      cards.forEach((card, index) => {
        assert.match(card, new RegExp(`#${index + 1}`));
        assert.doesNotMatch(card, /Target first|Pay off #[0-9]+ first/);
      });
      assert.match(cards[0], paused ? /Payments paused — keeps its payoff position/ : enabled ? /Current payoff target/ : /Follows your saved payoff order/);
      assert.match(cards[1], enabled && paused ? /Current payoff target/ : /Follows your saved payoff order/);
      assert.match(cards[2], /Follows your saved payoff order/);
      assert.equal(cards.filter(card => card.includes("Current payoff target")).length, enabled ? 1 : 0);
    }
  }
});

test("desktop dashboard selects the currently eligible debt while preserving open debt totals through automatic resume", () => {
  const source = readFileSync("components/desktop/DesktopDashboard.tsx", "utf8");
  const body = source.slice(source.indexOf("  const payoffDebts ="), source.indexOf("  const {\n    planned: dashboardPlanned,"));
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const select = new Function("bills", "pauseToday", "useMemo", "activeDebtPaymentPause", `${js}; return { payoffDebts, payoffBalance, payoffTarget };`);
  const bills = [{ ...debt, debt_payment_pauses: [savedPause] }, { ...debt, id: "second", name: "Second card", balance: 2400 }];
  const paused = select(bills, "2026-02-10", (fn: () => unknown) => fn(), pauseDomain.activeDebtPaymentPause);
  assert.equal(paused.payoffTarget.id, "second"); assert.equal(paused.payoffBalance, 3200); assert.deepEqual(paused.payoffDebts.map((bill: any) => bill.id), ["first", "second"]);
  const resumed = select(bills, "2026-03-31", (fn: () => unknown) => fn(), pauseDomain.activeDebtPaymentPause);
  assert.equal(resumed.payoffTarget.id, "first"); assert.equal(resumed.payoffBalance, 3200);
});


test("mobile bills and debt cards retain exact full currency and cents beside their saved names", () => {
  const largeDebt = { ...debt, name: "Long saved debt name with a full balance", balance: 12345678.91, amount: 123456.78 };
  const debtHarness = harness("BillsScreen", {}, { budget: { bills: [largeDebt] } });
  const debtCard = debtHarness.child("FlatList").props.renderItem({ item: largeDebt });
  assert.match(copy(debtCard), /Long saved debt name with a full balance/);
  assert.match(copy(debtCard), /\$12,345,678\.91/);
  assert.match(copy(debtCard), /Required \/ month.*\$123,456\.78/);
  const balance = flatten(debtCard).find(node => node.type === "Text" && copy(node).includes("$12,345,678.91"));
  assert.equal(balance.props.sensitive, true);
  const ordinaryBill = { ...debt, is_debt: false, name: "Long saved household bill name", amount: 1234567.89, category: "Other" };
  const billHarness = harness("BillsScreen", {}, { view: "bills", budget: { bills: [ordinaryBill] } });
  const billCard = billHarness.child("FlatList").props.renderItem({ item: ordinaryBill });
  assert.match(copy(billCard), /Long saved household bill name/);
  assert.match(copy(billCard), /\$1,234,567\.89/);
  const amount = flatten(billCard).find(node => node.type === "Text" && copy(node).includes("$1,234,567.89"));
  assert.equal(amount.props.sensitive, true);
});


function editPauseHarness(pause = savedPause, extra: Record<string, any> = {}) {
  return pauseHarness({ bill: { ...debt, debt_payment_pauses: [{ ...pause }] }, editingPause: { ...pause }, ...extra });
}

function pauseField(h: ReturnType<typeof pauseHarness>, label: string) {
  return flatten(h.render()).find(node => node.type === "DatePickerField" && node.props.label === label);
}

test("edit pause prefills the captured dates and choice, locking only an elapsed start", () => {
  for (const [start, locked, move] of [["2026-01-01", true, true], ["2026-01-31", false, false], ["2026-02-15", false, true]] as const) {
    const interval = { ...savedPause, start_date: start, redirect_payment: move };
    const h = editPauseHarness(interval);
    assert.match(copy(h.render()), /Edit payment pause/);
    assert.equal(pauseField(h, "Pause starts").props.value, start);
    assert.equal(pauseField(h, "Pause starts").props.disabled, locked);
    assert.equal(pauseField(h, "Payments resume").props.value, interval.resume_date);
    if (locked) {
      pauseField(h, "Pause starts").props.onChange("2026-02-02");
      pauseField(h, "Pause starts").props.onOpenChange(true);
      assert.equal(pauseField(h, "Pause starts").props.value, start);
      assert.equal(h.props.openDateField, null);
      assert.match(copy(h.render()), /start date stays the same/);
      assert.equal(pauseField(h, "Payments resume").props.minDate, "2026-02-01");
    }
    h.button("Continue").props.onPress();
    assert.equal(h.button("Yes, use payoff order").props["aria-checked"], move);
    assert.equal(h.button("No, keep it available").props["aria-checked"], !move);
    assert.equal(h.button("Save changes").props.disabled, false);
    assert.equal(h.button("Pause payments"), undefined);
    assert.deepEqual(h.writes, []);
    h.button("Back").props.onPress(); h.button("Cancel").props.onPress();
    assert.deepEqual(h.writes, []);
  }
});

test("editing an active pause keeps draft dates and choice through rejection, Back, duplicate submit and retry", async () => {
  const original = { ...savedPause, start_date: "2026-01-01" };
  let reject!: (error: Error) => void, finish!: () => void;
  let pending = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
  const writes: any[] = [];
  const h = editPauseHarness(original, { onSave: (input: any) => { writes.push(input); return pending; } });
  pauseField(h, "Payments resume").props.onChange("2026-04-05");
  h.button("Continue").props.onPress(); h.button("No, keep it available").props.onPress();
  assert.match(copy(h.render()), /changes apply from today/);
  const submit = h.button("Save changes");
  const first = submit.props.onPress(); await submit.props.onPress();
  assert.deepEqual(writes, [{ startDate: "2026-01-01", resumeDate: "2026-04-05", redirectPayment: false }]);
  h.button("Back").props.onPress(); h.button("Close debt payment pause").props.onPress();
  assert.equal(h.props.step, "transfer"); assert.equal(h.closes(), 0);
  assert.equal(h.button("Save changes").props.disabled, true);
  reject(new Error("Fictional edit unavailable")); await first;
  assert.match(copy(h.render()), /Fictional edit unavailable/);
  assert.equal(h.button("No, keep it available").props["aria-checked"], true);
  h.button("Back").props.onPress();
  assert.equal(pauseField(h, "Pause starts").props.value, "2026-01-01");
  assert.equal(pauseField(h, "Payments resume").props.value, "2026-04-05");
  h.props.bill = { ...h.props.bill, name: "Refreshed display name" };
  assert.equal(pauseField(h, "Payments resume").props.value, "2026-04-05");
  h.button("Continue").props.onPress();
  pending = new Promise<void>(resolve => { finish = resolve; });
  const retry = h.button("Save changes").props.onPress(); finish(); await retry;
  assert.deepEqual(writes, [writes[0], writes[0]]); assert.equal(h.closes(), 1);
});

test("edit validation rejects missing, changed, ended and overlapping saved intervals without creating a pause", async () => {
  const original = { ...savedPause, start_date: "2026-02-01" };
  for (const history of [[], [{ ...original, resume_date: "2026-04-01" }], [{ ...original, redirect_payment: false }]]) {
    const h = editPauseHarness(original, { bill: { ...debt, debt_payment_pauses: history } });
    h.button("Continue").props.onPress();
    assert.match(copy(h.render()), /changed or ended.*Reopen/);
    assert.deepEqual(h.writes, []); assert.equal(h.props.step, "dates");
    assert.match(copy(h.render()), /Edit payment pause/);
  }
  const ended = editPauseHarness({ ...savedPause, start_date: "2026-01-01", resume_date: "2026-01-20" });
  ended.button("Continue").props.onPress();
  assert.match(copy(ended.render()), /pause has ended.*Reopen/); assert.deepEqual(ended.writes, []);
  const overlap = editPauseHarness(original, { bill: { ...debt, debt_payment_pauses: [original, { id: "later", start_date: "2026-04-01", resume_date: "2026-05-01", redirect_payment: false }] } });
  pauseField(overlap, "Payments resume").props.onChange("2026-04-15");
  overlap.button("Continue").props.onPress();
  assert.match(copy(overlap.render()), /cannot overlap/); assert.deepEqual(overlap.writes, []);
  const active = editPauseHarness({ ...savedPause, start_date: "2026-01-01" });
  pauseField(active, "Payments resume").props.onChange("2026-01-31");
  active.button("Continue").props.onPress(); assert.match(copy(active.render()), /Use Resume now/);
  assert.deepEqual(active.writes, []);
});

test("plan-off edits retain an existing true choice without enabling new transfers or resetting an explicit No", async () => {
  for (const move of [true, false]) {
    const h = editPauseHarness({ ...savedPause, redirect_payment: move }, { redirectEnabled: false });
    pauseField(h, "Payments resume").props.onChange("2026-04-05");
    h.button("Continue").props.onPress();
    assert.equal(h.button("Yes, use payoff order").props.disabled, true);
    assert.equal(h.button("Yes, use payoff order").props["aria-checked"], move);
    assert.equal(h.button("Save changes").props.disabled, false);
    if (move) assert.match(copy(h.render()), /Saved choice kept.*No payments move while Debt Payoff Plan is off/);
    h.button("Yes, use payoff order").props.onPress();
    await h.button("Save changes").props.onPress();
    assert.deepEqual(h.writes, [{ startDate: "2026-01-31", resumeDate: "2026-04-05", redirectPayment: move }]);
  }
  const no = editPauseHarness(savedPause, { redirectEnabled: false });
  no.button("Continue").props.onPress(); no.button("No, keep it available").props.onPress();
  no.props.redirectEnabled = true; no.render(); no.props.redirectEnabled = false; no.render();
  assert.equal(no.button("No, keep it available").props["aria-checked"], true);
  assert.doesNotMatch(copy(no.render()), /Saved choice kept/);
  await no.button("Save changes").props.onPress(); assert.equal(no.writes[0].redirectPayment, false);
});

test("shared editor exposes active/future Edit pause entries with a frozen selected snapshot and preserves unsaved debt fields", async () => {
  for (const start of ["2026-01-01", "2026-02-15"]) {
    const selected = { ...savedPause, start_date: start };
    const writes: any[] = [], creates: any[] = [], updates: any[] = [];
    const editedHistory = [{ ...selected, resume_date: "2026-04-05" }];
    const h = editorHarness({ budget: { bills: [{ ...debt, debt_payment_pauses: [selected] }], pauseDebtPayments: async (...args: any[]) => { creates.push(args); }, editDebtPaymentPause: async (...args: any[]) => { writes.push(args); h.budget.bills = [{ ...debt, debt_payment_pauses: editedHistory }]; } } });
    h.props.onSave = async (...args: any[]) => { updates.push(args); };
    flatten(h.render()).find(node => node.type === "TextInput" && node.props.placeholder === "e.g. Car Loan").props.onChangeText("Unsaved edited name");
    assert.ok(h.button("Edit pause")); assert.ok(h.button(start < "2026-01-31" ? "Resume now" : "Cancel scheduled pause"));
    h.button("More bill actions").props.onPress(); assert.ok(h.button("Edit saved payment pause"));
    h.button("Edit saved payment pause").props.onPress();
    const overlay = h.child("DebtPaymentPauseModal");
    assert.equal(overlay.props.visible, true); assert.deepEqual(overlay.props.editingPause, selected);
    assert.notEqual(overlay.props.editingPause, selected); assert.equal(Object.isFrozen(overlay.props.editingPause), true);
    h.budget.bills = [{ ...debt, debt_payment_pauses: [{ ...selected }] }]; h.render();
    assert.equal(h.child("DebtPaymentPauseModal").props.editingPause, overlay.props.editingPause);
    const input = { startDate: start, resumeDate: "2026-04-05", redirectPayment: true };
    await overlay.props.onSave(input); overlay.props.onClose();
    assert.deepEqual(writes, [["first", selected, input]]); assert.deepEqual(creates, []);
    assert.equal(h.closes(), 0);
    const update = flatten(h.render()).find(node => node.type === "Pressable" && copy(node).includes("Update Debt")); await update.props.onPress();
    assert.equal(updates[0][0].name, "Unsaved edited name"); assert.equal(updates[0][0].amount, 100);
    assert.deepEqual(updates[0][0].debt_payment_pauses, editedHistory); assert.deepEqual(updates[0][1], ["name"]);
  }
});

test("edit callbacks never fall back to create after role, scope, close or a reopened draft changes", async () => {
  for (const change of ["role", "scope", "close", "reopen"]) {
    const creates: any[] = [], edits: any[] = [];
    const h = editorHarness({ budget: { bills: [{ ...debt, debt_payment_pauses: [savedPause] }], pauseDebtPayments: async (...args: any[]) => { creates.push(args); }, editDebtPaymentPause: async (...args: any[]) => { edits.push(args); } } });
    h.button("Edit pause").props.onPress();
    const overlay = h.child("DebtPaymentPauseModal"), retained = overlay.props.onSave;
    if (change === "role") h.budget.canEditHousehold = false;
    else if (change === "scope") h.budget.activeHousehold = { ...h.budget.activeHousehold, householdId: "different" };
    else { overlay.props.onClose(); h.render(); if (change === "reopen") h.button("Edit pause").props.onPress(); }
    h.render();
    await assert.rejects(retained({ startDate: savedPause.start_date, resumeDate: "2026-04-05", redirectPayment: true }), /editing access changed|pause editor changed/);
    assert.deepEqual(creates, []); assert.deepEqual(edits, []);
  }
});

test("edit confirmation and calendar Back cancel drafts without saving or losing their parent editor", () => {
  const browser = browserHistory(), calls: any[] = [];
  const h = editorHarness({ browser, budget: { bills: [{ ...debt, debt_payment_pauses: [{ ...savedPause, start_date: "2026-02-01" }] }], editDebtPaymentPause: async (...args: any[]) => { calls.push(args); } } });
  h.button("Edit pause").props.onPress(); h.render();
  h.child("DebtPaymentPauseModal").props.onOpenDateFieldChange("resume"); h.render();
  browser.host.history.back(); browser.flush(); h.render();
  assert.equal(h.child("DebtPaymentPauseModal").props.openDateField, null);
  h.child("DebtPaymentPauseModal").props.onStepChange("transfer"); h.render();
  browser.host.history.back(); browser.flush(); h.render();
  assert.equal(h.child("DebtPaymentPauseModal").props.step, "dates");
  assert.equal(h.child("DebtPaymentPauseModal").props.visible, true);
  browser.host.history.back(); browser.flush(); h.render();
  assert.equal(h.child("DebtPaymentPauseModal").props.visible, false); assert.equal(h.closes(), 0);
  assert.deepEqual(calls, []);
  h.unmount();
});
