import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import { bucketPurchaseCandidates, bucketPurchaseHistory } from "./bucketPurchases";
import { spendingBucketSummary } from "./spendingBuckets";
import { createTransactionNameResolver } from "./transactionNames";

function flatten(node: any): any[] {
  return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
}
function copy(node: any): string {
  return Array.isArray(node) ? node.map(copy).join(" ") : node && typeof node === "object" ? copy(node.props?.children) : typeof node === "string" ? node : "";
}
const bucket = { id: "bucket", name: "Holiday", goal_type: "planned_expense", target_amount: 500, current_amount: 100, target_date: "2026-12-20" };
const purchase = { id: "prior", amount: -100, date: "2026-10-20", category: "Shopping", note: "Prior purchase", source: "manual", review_status: "matched", review_resolution: "goal", linked_plan_id: "bucket", linked_plan_type: "goal", review_allocations: [{ type: "planned_expense", source: "goal", targetId: "bucket", amount: 100 }] };
const bank = { id: "bank", amount: -50, date: "2026-10-26", category: "Shopping", note: "Bank purchase", source: "plaid", plaid_account_id: "checking", review_status: "needs_review" };
const manual = { id: "manual", amount: -25, date: "2026-10-25", category: "Shopping", note: "Manual purchase", source: "manual" };

function harness(component = "BucketDetailModal", overrides: Record<string, any> = {}) {
  const states: any[] = [], effects: Array<() => void> = [], cleanups: Array<() => void> = [], exported: any = {};
  let cursor = 0, dirty = false;
  const budget: any = { activeHousehold: { householdId: "home", budgetId: "budget", role: "owner" }, canEditHousehold: true,
    goals: [{ ...bucket }], transactions: [{ ...purchase }, { ...bank }, { ...manual }, { ...bank, id: "unknown", note: "Unknown account", plaid_account_id: "unknown" }],
    transactionAccountIdentities: [], categories: ["Other", "Shopping", "Debt"], bills: [{ id: "debt", is_debt: true, balance: 100, name: "Card" }], accounts: [], settings: { safety_floor: 100, forecast_horizon_months: 6 },
    addBucketPurchase: async () => "recorded", removeBucketPurchase: async () => {}, updateGoal: async () => {}, getDailyBalances: () => [],
    previewBucketPurchaseSafetyStop: () => null, previewTransactionSafetyStop: () => null, previewBucketBudgetSafetyStop: () => null, ...overrides,
  };
  const react = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) };
  const hooks = { __esModule: true, default: react,
    useState(initial: any) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (next: any) => { const value = typeof next === "function" ? next(states[i]) : next; if (!Object.is(value, states[i])) { states[i] = value; dirty = true; } }]; },
    useRef(initial: any) { const i = cursor++; return states[i] ??= { current: initial }; },
    useMemo(fn: () => any) { cursor++; return fn(); }, useDeferredValue(value: any) { cursor++; return value; },
    useEffect(fn: () => any, deps: any[]) { const i = cursor++; if (!states[i] || deps.some((value, index) => !Object.is(value, states[i][index]))) { states[i] = deps; effects.push(() => { const cleanup = fn(); if (typeof cleanup === "function") cleanups.push(cleanup); }); } },
  };
  const props: any = component === "BucketDetailModal" ? { bucketId: "bucket", onClose() {}, onCloseBucket() {}, onReopenBucket() {} } : { visible: true, onClose() {}, onSave: async () => {} };
  const js = transpileModule(readFileSync(`components/${component}.tsx`, "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  new Function("exports", "require", js)(exported, (name: string) => {
    if (name === "react") return hooks;
    if (name === "react-native") return { ...Object.fromEntries(["View", "Text", "Modal", "Pressable", "ScrollView", "TextInput", "KeyboardAvoidingView"].map(value => [value, value])), Platform: { OS: "web" }, Alert: { alert() {} }, StyleSheet: { create: (value: any) => value, hairlineWidth: 1 } };
    if (name === "expo-router") return { useRouter: () => ({ push() {} }) };
    const leaf = name.split("/").at(-1)!;
    if (name.includes("/components/")) return { [leaf]: leaf, ConfirmActionOverlay: "ConfirmActionOverlay" };
    if (leaf === "BudgetContext") return { useBudget: () => budget };
    if (leaf === "AuthContext") return { useAuth: () => ({ user: { id: "user" } }) };
    if (leaf === "useColors") return { useColors: () => new Proxy({}, { get: () => "#000000" }) };
    if (leaf === "useDesktopExperience") return { useDesktopExperience: () => false };
    if (leaf === "useBackDismiss") return { useBackDismiss() {} };
    if (leaf === "transactionNames") return { createTransactionNameResolver };
    if (leaf === "bucketPurchases") return { bucketPurchaseCandidates, bucketPurchaseHistory };
    if (leaf === "spendingBuckets") return { spendingBucketSummary };
    if (leaf === "billMatching") return { createPlaidTransactionAccountKindClassifier: () => (tx: any) => tx.plaid_account_id === "checking" ? "checking" : "unknown" };
    if (leaf === "dateLabels") return { localDateString: () => "2026-10-26" };
    if (leaf === "moneyFormInput") return { parseMoneyInput: (value: string) => value && Number.isFinite(Number(value)) ? Number(value) : null };
    if (leaf === "transactionDebt") return { transactionDebtId: () => undefined };
    if (leaf === "haptics") return { impactAsync() {}, ImpactFeedbackStyle: {} };
    if (leaf === "safetyStop") return { buildBucketSafetyStop: () => null };
    if (leaf === "formInputAlert") return { showFormError() {} };
    return {};
  });
  const render = () => { let tree: any; for (let n = 0; n < 8; n++) { cursor = 0; dirty = false; tree = exported[component](props); effects.splice(0).forEach(fn => fn()); if (!dirty) break; } return tree; };
  const button = (label: string) => flatten(render()).find(node => node.type === "Pressable" && node.props.accessibilityLabel === label);
  return { budget, props, render, button, unmount: () => cleanups.forEach(fn => fn()) };
}

test("bucket detail keeps purchase history readable and mutation controls scoped to editors", () => {
  const h = harness(); let tree = h.render();
  assert.match(copy(tree), /Planned.*Spent.*Remaining.*Add purchase.*Purchases.*Prior purchase/);
  assert.ok(h.button("Add purchase to Holiday"));
  h.budget.canEditHousehold = false; tree = h.render();
  assert.match(copy(tree), /Prior purchase/); assert.equal(h.button("Add purchase to Holiday"), undefined);
  assert.equal(h.button("Remove Prior purchase from bucket"), undefined); assert.equal(h.button("Adjust Holiday budget"), undefined);
  for (const state of [{ closed_at: "2026-10-25" }, { current_amount: 500 }]) {
    const closed = harness("BucketDetailModal", { goals: [{ ...bucket, ...state }] });
    assert.equal(closed.button("Add purchase to Holiday"), undefined);
    assert.match(copy(closed.render()), /Reopen this bucket|Adjust the budget/);
  }
});

test("bucket purchase picker filters first, confirms one existing transaction and retains failed selection", async () => {
  let resolve!: () => void, reject!: (error: Error) => void;
  const intents: any[] = [];
  let waiting = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const h = harness("BucketDetailModal", { addBucketPurchase: async (intent: any) => { intents.push(intent); await waiting; return intent.transactionId; } });
  h.button("Add purchase to Holiday").props.onPress();
  assert.ok(h.button("Bank transaction")); assert.ok(h.button("Manual transaction")); assert.ok(h.button("Record purchase"));
  h.button("Bank transaction").props.onPress();
  assert.ok(h.button("Select Bank purchase, $50.00")); assert.equal(h.button("Select Unknown account, $50.00"), undefined);
  h.button("Select Bank purchase, $50.00").props.onPress();
  const confirm = h.button("Confirm add purchase to bucket"); const first = confirm.props.onPress(); await confirm.props.onPress();
  assert.deepEqual(intents, [{ bucketId: "bucket", transactionId: "bank" }]);
  reject(new Error("Fictional save failed")); await first; await new Promise(resolve => setImmediate(resolve));
  assert.match(copy(h.render()), /Fictional save failed/); assert.ok(h.button("Confirm add purchase to bucket"));
  waiting = new Promise<void>(yes => { resolve = yes; });
  const retry = h.button("Confirm add purchase to bucket").props.onPress(); resolve(); await retry; await new Promise(resolve => setImmediate(resolve));
  assert.match(copy(h.render()), /Purchase added. Your bucket stays open/);
});

test("record purchase reuses one proposed id through retries and rejects stale scope callbacks", async () => {
  const intents: any[] = []; let fail = true;
  const h = harness("BucketDetailModal", { addBucketPurchase: async (intent: any) => { intents.push(intent); if (fail) throw new Error("Retry"); return intent.transactionId; } });
  h.button("Add purchase to Holiday").props.onPress(); h.button("Record purchase").props.onPress();
  const editor = flatten(h.render()).find(node => node.type === "AddTransactionModal");
  const payload = { amount: -25, date: "2026-10-26", category: "Other", note: "New purchase" };
  await assert.rejects(editor.props.onSave(payload), /Retry/); fail = false; await editor.props.onSave(payload);
  assert.equal(intents[0].transactionId, intents[1].transactionId); assert.match(intents[0].transactionId, /^bucket-purchase-/);
  h.budget.activeHousehold = { householdId: "other", budgetId: "other" }; h.render();
  await assert.rejects(editor.props.onSave(payload), /editing access changed/); assert.equal(intents.length, 2);
});

test("bucket recording locks expense mode, calls the combined preview and exposes save failures", async () => {
  const previews: any[] = []; const saved: any[] = [];
  const h = harness("AddTransactionModal", { previewBucketPurchaseSafetyStop: (id: string, tx: any) => { previews.push({ id, tx }); return null; }, previewTransactionSafetyStop: () => { throw new Error("Ordinary preview must not run"); } });
  Object.assign(h.props, { creationContext: "bucket_purchase", bucketId: "bucket", onSave: async (tx: any) => { saved.push(tx); throw new Error("Fictional persistence failure"); } });
  let tree = h.render(); assert.doesNotMatch(copy(tree), /Apply Toward Debt|Add Transfer|Income name/);
  flatten(tree).find(node => node.type === "TextInput" && node.props.placeholder === "0.00").props.onChangeText("25");
  await h.button("Save bucket purchase").props.onPress(); tree = h.render();
  assert.equal(previews.length, 1); assert.equal(previews[0].id, "bucket"); assert.equal(saved[0].amount, -25); assert.equal(saved[0].linked_bill_id, undefined);
  assert.match(copy(tree), /Fictional persistence failure/);
});

function settingsBucketBack(section = "buckets") {
  const window = { history: { state: { flowledgerLayer: "section-layer" } } };
  const navigated: string[] = []; let callback!: (event?: { state?: unknown }) => void;
  const source = readFileSync("app/(tabs)/more.tsx", "utf8");
  const start = source.indexOf("  const bucketOverlayHistoryRef =");
  const end = source.indexOf("  useEffect(() => {", start);
  assert.ok(start >= 0 && end > start);
  const body = transpileModule(source.slice(start, end), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const bindings = { window, Platform: { OS: "web" }, activeSettingsSection: section,
    useRef: (value: any) => ({ current: value }), useCallback: (fn: any) => fn,
    useBackDismiss: (_active: boolean, fn: (event?: { state?: unknown }) => void) => { callback = fn; },
    openSettingsSection: (value: string) => navigated.push(value),
  };
  const changed = new Function(...Object.keys(bindings), `${body}; return onBucketOverlayChange;`)(...Object.values(bindings));
  return { changed, navigated, back: (event?: { state?: unknown }) => callback(event), layer: (value: string) => { window.history.state.flowledgerLayer = value; } };
}

test("Settings ancestor ignores bucket-owned nested disposal without replacing its section listener", () => {
  for (const section of ["buckets", "review"]) for (const closeAtNested of [false, true]) {
    const h = settingsBucketBack(section);
    h.layer("flowledger-editor-bucket"); h.changed(true);
    h.layer("flowledger-editor-bucket-history"); h.back();
    assert.deepEqual(h.navigated, [], "purchase confirmation owned pop must stay in bucket");
    h.layer(closeAtNested ? "flowledger-editor-bucket-history" : "flowledger-editor-bucket"); h.changed(false);
    h.layer("flowledger-editor-bucket"); h.back();
    assert.deepEqual(h.navigated, [], "late X-close cleanup must not leave Settings");
    h.layer("section-layer"); h.back(); assert.deepEqual(h.navigated, ["overview"]);
  }
});

test("Settings bucket Back ownership does not swallow unrelated editor or section navigation", () => {
  const h = settingsBucketBack(); h.layer("flowledger-editor-bucket"); h.changed(true); h.changed(false);
  h.layer("flowledger-editor-unrelated"); h.back(); assert.deepEqual(h.navigated, ["overview"]);
  const other = settingsBucketBack("money"); other.layer("flowledger-editor-bucket"); other.changed(true); other.back();
  assert.deepEqual(other.navigated, ["overview"]);
});

test("Settings owned disposal uses the pop snapshot after router replacement and respects explicit null", () => {
  const h = settingsBucketBack(); h.layer("flowledger-editor-bucket-history"); h.changed(true); h.changed(false);
  h.layer("router-replaced"); h.back({ state: { flowledgerLayer: "flowledger-editor-bucket" } });
  assert.deepEqual(h.navigated, []);
  h.layer("flowledger-editor-bucket"); h.back({ state: null });
  assert.deepEqual(h.navigated, ["overview"]);
});

test("existing Back listeners receive an optional event without changing no-argument callbacks", () => {
  let onPop!: (event: any) => void; let calls = 0, received: unknown;
  const effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const exported: any = {};
  const window = { history: { state: {}, pushState() {} }, location: { href: "https://example.test" }, addEventListener(_type: string, callback: any) { onPop = callback; }, removeEventListener() {} };
  const source = transpileModule(readFileSync("hooks/useBackDismiss.ts", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  new Function("exports", "require", "window", source)(exported, (name: string) => {
    if (name === "react") return { useRef: (value: any) => ({ current: value }), useEffect: (fn: () => void) => effects.push(fn) };
    if (name === "react-native") return { Platform: { OS: "web" } };
    if (name.endsWith("useOverlayActivity")) return { useOverlayActivity() {} };
    return {};
  }, window);
  exported.useBackDismiss(true, () => { calls++; }); effects.splice(0).forEach(fn => { const cleanup: any = fn(); if (cleanup) cleanups.push(cleanup); });
  onPop({ state: null }); assert.equal(calls, 1); cleanups.splice(0).forEach(fn => fn());
  exported.useBackDismiss(true, (event: unknown) => { received = event; }); effects.splice(0).forEach(fn => fn());
  const snapshot = { state: { route: "bucket" } }; onPop(snapshot); assert.equal(received, snapshot);
});

test("adjusting a bucket previews the changed reservation and preserves its id through safety confirmation", async () => {
  const saved: any[] = [], previews: any[] = [];
  const h = harness("GoalModal", { previewBucketBudgetSafetyStop: (goal: any) => { previews.push(goal); return { itemName: "Holiday", amount: 600, scheduledDate: "2026-12-20", lowestBalance: 90, lowestBalanceDate: "2026-12-20", safetyFloor: 100, shortfall: 10 }; } });
  Object.assign(h.props, { editGoal: { ...bucket, created_at: "2026-10-01" }, lockedMode: "budget", hideBucketLifecycle: true, onSave: async (goal: any) => { saved.push(goal); } });
  let tree = h.render();
  flatten(tree).find(node => node.type === "TextInput" && node.props.placeholder === "2000.00").props.onChangeText("600");
  const save = flatten(h.render()).find(node => node.type === "Pressable" && copy(node).includes("Update Bucket"));
  await save.props.onPress(); tree = h.render();
  assert.equal(previews.length, 1); assert.equal(previews[0].current_amount, 100); assert.equal(previews[0].target_amount, 600);
  assert.equal(saved.length, 0);
  const warning = flatten(tree).find(node => node.type === "FloSafetyStopModal"); assert.equal(warning.props.visible, true);
  warning.props.onScheduleAnyway(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved[0].id, "bucket"); assert.equal(saved[0].current_amount, 100); assert.equal(saved[0].target_amount, 600);
});


test("fully spent bucket close confirmation stays local, retains failure and prevents duplicate writes", async () => {
  const h = harness("BucketDetailModal", { goals: [{ ...bucket, target_amount: 100 }] });
  let resolve!: (value: boolean) => void, calls = 0;
  h.props.onCloseBucket = () => { throw new Error("Full detail close must not open global confirmation"); };
  h.props.onConfirmCloseBucket = () => { calls++; return new Promise<boolean>(yes => { resolve = yes; }); };
  h.button("Close Holiday bucket").props.onPress(); assert.ok(h.button("Confirm close bucket"));
  h.button("Keep bucket open").props.onPress(); assert.equal(h.button("Confirm close bucket"), undefined);
  h.button("Close Holiday bucket").props.onPress(); const confirmation = h.button("Confirm close bucket");
  confirmation.props.onPress(); confirmation.props.onPress(); assert.equal(calls, 1);
  resolve(false); await new Promise(resolve => setImmediate(resolve)); assert.ok(h.button("Confirm close bucket"), "failed close retains the confirmation");
  h.button("Confirm close bucket").props.onPress(); resolve(true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2); assert.equal(h.button("Confirm close bucket"), undefined);
});


test("stale full-close confirmation refreshes the detail before a new explicit remainder choice", async () => {
  const h = harness("BucketDetailModal", { goals: [{ ...bucket, target_amount: 100 }] });
  let directCloses = 0; const choices: any[] = [];
  h.props.onConfirmCloseBucket = async () => { directCloses++; return true; };
  h.props.onCloseBucket = (goal: any) => choices.push(goal);
  h.button("Close Holiday bucket").props.onPress();
  assert.equal(h.button("Adjust Holiday budget").props.disabled, true);
  assert.equal(h.button("Remove Prior purchase from bucket").props.disabled, true);
  const oldConfirmation = h.button("Confirm close bucket");
  h.budget.goals = [{ ...bucket, target_amount: 150 }]; h.render();
  assert.equal(h.button("Add purchase to Holiday").props.disabled, true);
  assert.match(copy(h.render()), /budget changed.*\$50.00 remaining/);
  oldConfirmation.props.onPress(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(directCloses, 0); assert.equal(choices.length, 0);
  assert.equal(h.button("Confirm close bucket"), undefined);
  assert.match(copy(h.render()), /Bucket budget changed.*choose Close bucket again/);
  assert.equal(h.button("Adjust Holiday budget").props.disabled, false);
  h.button("Close Holiday bucket").props.onPress();
  assert.equal(choices.length, 1); assert.equal(choices[0].target_amount, 150);
});


test("bucket purchase history and picker use saved names while retaining bank-name search", () => {
  const h = harness();
  h.budget.transactions[0] = { ...purchase, merchant_name: "BANK PRIOR", note: "Family gift", user_edited_at: "2026-10-26" };
  h.budget.transactions[1] = { ...bank, merchant_name: "BANK POS 123", note: "Family dinner", user_edited_at: "2026-10-26" };
  assert.match(copy(h.render()), /Family gift/); assert.ok(h.button("Remove Family gift from bucket"));
  h.button("Add purchase to Holiday").props.onPress(); h.button("Bank transaction").props.onPress();
  for (const query of ["Family dinner", "BANK POS 123"]) {
    flatten(h.render()).find(node => node.type === "TextInput" && node.props.accessibilityLabel === "Search bucket purchase transactions").props.onChangeText(query);
    assert.ok(h.button("Select Family dinner, $50.00"));
  }
});

test("unplanned-charge and deleted-transaction labels retain saved names and restore accessibility text", () => {
  const transaction = { ...bank, merchant_name: "BANK POS 123", note: "Saved dinner", user_edited_at: "2026-10-26" };
  const unplanned = harness("UnplannedChargeModal");
  Object.assign(unplanned.props, { transaction, categories: ["Other"], saving: false });
  assert.match(copy(unplanned.render()), /Saved dinner/); assert.doesNotMatch(copy(unplanned.render()), /BANK POS 123/);
  const deleted = harness("RecentlyDeletedTransactions", { deletedTransactions: [transaction] });
  assert.match(copy(deleted.render()), /Saved dinner/); assert.ok(deleted.button("Restore Saved dinner"));
});


test("deleted and unplanned charge surfaces resolve live confirmed bill and income names", () => {
  const transaction = { ...bank, match_reason: "confirmed_bill_match", linked_bill_id: "bill", review_status: "matched", review_resolution: "bill", review_allocations: [{ type: "bill", targetId: "bill", name: "Old electricity name", amount: 50 }] };
  const bills = [{ id: "bill", name: "Current electricity name" }];
  const deleted = harness("RecentlyDeletedTransactions", { bills, deletedTransactions: [transaction] });
  assert.ok(deleted.button("Restore Current electricity name"));
  const unplanned = harness("UnplannedChargeModal", { bills }); Object.assign(unplanned.props, { transaction, categories: ["Other"], saving: false });
  assert.match(copy(unplanned.render()), /Current electricity name/);
  const payroll = { ...transaction, amount: 50, match_reason: "confirmed_income_match", review_resolution: "income", linked_bill_id: undefined, linked_income_id: "payroll", review_allocations: [{ type: "income", targetId: "payroll", name: "Old payroll", amount: 50 }] };
  deleted.budget.incomes = [{ id: "payroll", name: "Current payroll" }]; deleted.budget.deletedTransactions = [payroll];
  assert.ok(deleted.button("Restore Current payroll"));
});
