import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import * as planner from "./snowballPlanner";
import * as snowball from "./snowball";
import * as debtDomain from "./debtPlanDomain";
import * as debtPayments from "./debtPaymentPlan";
import * as labels from "./dateLabels";
import * as funding from "./snowballFunding";
import * as review from "./reviewCenter";
import * as moneyInput from "./moneyFormInput";
import * as reportLayout from "./settingsLayout";

function flatten(node: any): any[] {
  return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
}
function text(node: any): string {
  return Array.isArray(node) ? node.map(text).join(" ") : node && typeof node === "object" ? text(node.props?.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
}

function harness(kind: "debt" | "reports", options: { premium?: boolean; viewer?: boolean; saved?: boolean } = {}) {
  const state: any = { premium: options.premium ?? false, userId: "owner", writes: [], removals: [], confirmations: [], alerts: [] };
  const today = labels.localDateString();
  const date = new Date(`${today}T12:00:00`);
  const debts = [
    { id: "small", name: "Small balance", balance: 100, amount: 20, interest_rate: 4, due_day: 5, is_debt: true, include_in_snowball: true },
    { id: "rate", name: "Highest interest", balance: 500, amount: 30, interest_rate: 20, due_day: 9, is_debt: true, include_in_snowball: true },
    { id: "excluded", name: "Excluded debt", balance: 1, amount: 1, interest_rate: 99, due_day: 12, is_debt: true, include_in_snowball: false },
  ];
  const saved = options.saved ? { id: "saved-plan", month: date.getMonth(), year: date.getFullYear(), payment_date: today, amount: 40, allocations: [{ billId: "small", billName: "Small balance", payment: 40 }], sources: [] } : null;
  const budget: any = {
    activeHousehold: { householdId: "home-a", budgetId: "budget-a", role: options.viewer ? "viewer" : "owner" },
    canEditHousehold: !options.viewer, bills: debts, transactions: [], extraPayments: saved ? [saved] : [],
    settings: { forecast_horizon_months: 12 },
    getMonthlyBills: () => debts, getBillOccurrencesInMonth: () => [5], getExtraPayment: () => saved,
    getDebtPlanForMonth: () => null, getRemainingDebtPlanForMonth: () => null, getDebtMonthSettlements: () => new Map(),
    previewDebtSnowball: (_month: number, _year: number, extra: number) => ({ safeMaximum: 100, selectedExtra: extra, debtFreeDate: "2027-06", allocations: extra > 0 ? [{ billId: "small", billName: "Small balance", payment: extra, paidOff: false }] : [] }),
    applyDebtSnowballPayment: async (...args: any[]) => { state.writes.push(args); },
    updateTransaction: async (...args: any[]) => { state.writes.push(args); },
    removeDebtSnowballPayment: async (...args: any[]) => { state.removals.push(args); },
    deleteTransaction: async (...args: any[]) => { state.removals.push(args); },
  };
  const hooks: any[] = [], effects: Array<() => void> = [], cleanups: Array<() => void> = [];
  let cursor = 0, dirty = false;
  const React: any = {
    Fragment: "Fragment",
    createElement: (type: any, props: any, ...children: any[]) => typeof type === "function" ? type({ ...props, children }) : ({ type, props: { ...props, children } }),
    useState: (initial: any) => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], (next: any) => { const value = typeof next === "function" ? next(hooks[i]) : next; if (!Object.is(value, hooks[i])) { hooks[i] = value; dirty = true; } }]; },
    useRef: (initial: any) => { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useMemo: (fn: () => any) => { cursor++; return fn(); },
    useEffect: (fn: () => void | (() => void), deps: any[]) => { const i = cursor++; if (!hooks[i] || deps.some((value, j) => !Object.is(value, hooks[i][j]))) { hooks[i] = deps; effects.push(() => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); }); } },
  };
  const membership = {
    get actualPlan() { return { householdId: budget.activeHousehold.householdId, tier: state.premium ? "pro" : "free", source: state.premium ? "billing" : "default" }; },
    get effectiveTier() { return state.premium ? "pro" : "free"; },
    loading: false,
    accessReady: true,
    accessError: null,
    hasFoundingAccess: false,
    refreshAccess: async () => {},
    isFeatureLocked: (feature: string) => ["debt_strategies", "long_term_reports"].includes(feature) && !state.premium,
    bypassFeature() {},
    isAdmin: false,
    previewTier: null,
  };
  const colors = new Proxy({}, { get: () => "#000000" });
  const modules: Record<string, any> = { snowballPlanner: planner, snowball, debtPlanDomain: debtDomain, debtPaymentPlan: debtPayments, dateLabels: labels, snowballFunding: funding, reviewCenter: review, moneyFormInput: moneyInput, settingsLayout: reportLayout };
  const cache: Record<string, any> = {};
  const load = (path: string) => {
    if (cache[path]) return cache[path];
    const exported: any = {}; cache[path] = exported;
    const js = transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
    new Function("exports", "require", js)(exported, (name: string) => {
      if (name === "react") return { __esModule: true, default: React, ...React };
      if (name.endsWith("/PrivacyPrimitives")) return { PrivacyText: "Text", PrivacyView: "View", PrivacyPressable: "Pressable", PrivacyTextInput: "TextInput" };
      if (name.endsWith("/usePrivacyAlerts")) return { usePrivacyAlerts: () => ({ alert: (...args: any[]) => state.alerts.push(args), formError: (...args: any[]) => state.alerts.push(args) }) };
      if (name === "react-native") return { View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", StyleSheet: { create: (v: any) => v }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
      if (name === "expo-router") return { useLocalSearchParams: () => ({}), useRouter: () => ({ push() {}, canGoBack: () => false, replace() {}, dismissTo() {} }) };
      const leaf = name.split("/").at(-1)!;
      if (leaf === "PlanFeatureGate") return load("components/PlanFeatureGate.tsx");
      if (leaf === "BudgetContext") return { useBudget: () => budget };
      if (leaf === "AuthContext") return { useAuth: () => ({ user: { id: state.userId } }) };
      if (leaf === "MembershipContext") return { useMembership: () => membership };
      if (leaf === "useColors") return { useColors: () => colors };
      if (leaf === "useDesktopExperience") return { useDesktopExperience: () => false };
      if (leaf === "membership") return { PLAN_FEATURE_COPY: { debt_strategies: { title: "Advanced payoff planning", description: "Compare strategies and try new extra payments with Pro." }, long_term_reports: { title: "Long-term report trends", description: "Explore six-month and yearly trends with Pro." } } };
      if (leaf === "launchMode") return { FOUNDING_FREE_LAUNCH: false };
      if (leaf === "confirmAction") return { confirmAction: (value: any) => state.confirmations.push(value) };
      if (leaf === "haptics") return { notificationAsync() {}, NotificationFeedbackType: { Success: "success" } };
      if (leaf === "colors") return { __esModule: true, default: colors };
      if (name.includes("/components/")) return { [leaf]: leaf };
      if (name.startsWith("@expo/")) return { __esModule: true, default: "Icon" };
      return modules[leaf] ?? {};
    });
    return exported;
  };
  const exported = load(kind === "debt" ? "app/snowball-plan.tsx" : "components/ReportsInsightsView.tsx");
  const reportProps: any = {
    monthLabel: "October 2026", summary: { income: 1750, spending: 500, net: 1250, categoryTotals: [{ category: "Food", amount: 500 }], debtTotal: 600, debtMinimums: 50, plannedBills: 300, subscriptionTotal: 20, goalProgress: [], insight: "Monthly report", topCategory: "Food" },
    reminders: [], categoryPlan: [], recurringCandidates: [], plannedMonthlyIncome: 1750,
    monthlyInsights: Array.from({ length: 12 }, (_, i) => ({ key: String(i), label: `HistoryMonth${i}`, income: 100, spending: 50 })),
    onOpenReview() {}, onOpenBills() {}, onOpenSubscriptions() {},
  };
  const render = () => {
    let tree: any;
    for (let i = 0; i < 8; i++) { cursor = 0; dirty = false; tree = kind === "debt" ? exported.default() : exported.ReportsInsightsView(reportProps); effects.splice(0).forEach(fn => fn()); if (!dirty) break; }
    return tree;
  };
  return { state, budget, render, unmount: () => cleanups.splice(0).forEach(fn => fn()) };
}

test("Free monthly reports stay readable while six-month/year trend values and controls stay gated", () => {
  const h = harness("reports"); const tree = h.render();
  assert.match(text(tree), /Your month at a glance/); assert.match(text(tree), /Food/); assert.match(text(tree), /1,750/);
  assert.match(text(tree), /Long-term report trends/); assert.doesNotMatch(text(tree), /HistoryMonth/);
  assert.equal(flatten(tree).filter(node => node.props?.accessibilityLabel === "Show one year").length, 0);
});

test("Pro and founding report access renders actual six-month/year trends without hiding monthly values", () => {
  for (const plan of ["pro", "founder"]) {
    const h = harness("reports", { premium: true }); let tree = h.render();
    assert.match(text(tree), /Your month at a glance/); assert.match(text(tree), /HistoryMonth11/);
    assert.doesNotMatch(text(tree), /HistoryMonth0\b/);
    flatten(tree).find(node => node.props?.accessibilityLabel === "Show one year").props.onPress();
    tree = h.render(); assert.match(text(tree), /HistoryMonth0\b/, plan);
  }
});

test("Free debt planning preserves the ladder/minimums/timeline while gating a new extra-payment editor", () => {
  const h = harness("debt"); const tree = h.render();
  assert.match(text(tree), /Your debt ladder/); assert.match(text(tree), /REQUIRED MINIMUM/); assert.match(text(tree), /payment timeline/);
  assert.match(text(tree), /Advanced payoff planning/);
  assert.equal(flatten(tree).filter(node => node.props?.accessibilityLabel === "Extra debt payment").length, 0);
  assert.equal(flatten(tree).filter(node => node.props?.accessibilityLabel === "Payoff strategy comparison").length, 0);
});

test("Pro strategy targets use canonical order and old save callbacks cannot survive downgrade or scope ABA", async () => {
  const h = harness("debt", { premium: true }); let tree = h.render();
  const comparison = flatten(tree).find(node => node.props?.accessibilityLabel === "Payoff strategy comparison");
  assert.match(text(comparison), /SNOWBALL.*Small balance.*AVALANCHE.*Highest interest/); assert.doesNotMatch(text(comparison), /Excluded debt/);
  flatten(tree).find(node => node.props?.accessibilityLabel === "Extra debt payment").props.onChangeText("40");
  tree = h.render(); const oldSave = flatten(tree).find(node => node.props?.accessibilityLabel === "Add extra payment to Forecast").props.onPress;
  h.state.premium = false; h.render(); await oldSave(); assert.equal(h.state.writes.length, 0);
  h.state.premium = true; tree = h.render(); await oldSave(); assert.equal(h.state.writes.length, 0);
  const scopeSave = flatten(tree).find(node => node.props?.accessibilityLabel === "Add extra payment to Forecast").props.onPress;
  h.budget.activeHousehold = { ...h.budget.activeHousehold, householdId: "home-b" }; h.render();
  h.budget.activeHousehold = { ...h.budget.activeHousehold, householdId: "home-a" }; tree = h.render();
  await scopeSave(); assert.equal(h.state.writes.length, 0);
  await flatten(tree).find(node => node.props?.accessibilityLabel === "Add extra payment to Forecast").props.onPress();
  assert.equal(h.state.writes.length, 1);
});

test("strategy comparisons use the selected month's canonical opening balances, excluding debts already closed", () => {
  const h = harness("debt", { premium: true });
  h.budget.getDebtPlanForMonth = () => ({
    payments: [{ billId: "small", balanceBefore: 0 }, { billId: "rate", balanceBefore: 450 }],
    balances: new Map([["small", 0], ["rate", 450]]), allocations: [],
  });
  const comparison = flatten(h.render()).find(node => node.props?.accessibilityLabel === "Payoff strategy comparison");
  assert.doesNotMatch(text(comparison), /Small balance/);
  assert.match(text(comparison), /Highest interest/);
  assert.match(text(comparison), /450\.00/);
  assert.doesNotMatch(text(comparison), /500\.00/);
});

test("a downgraded household can review, correct and remove its saved extra payment", async () => {
  const h = harness("debt", { saved: true }); let tree = h.render();
  assert.match(text(tree), /Adjust your extra payment/); assert.match(text(tree), /Extra payment history/);
  const save = flatten(tree).find(node => node.props?.accessibilityLabel === "Update extra payment in Forecast");
  assert.equal(save.props.disabled, false); await save.props.onPress(); assert.equal(h.state.writes.length, 1);
  assert.equal(h.state.writes[0][2], "saved-plan");
  const remove = flatten(tree).find(node => node.type === "Pressable" && text(node).trim() === "Remove"); remove.props.onPress();
  await h.state.confirmations[0].onConfirm(); assert.equal(h.state.removals.length, 1);
});

test("viewers and unmounted retained editors cannot dispatch an extra-payment write", async () => {
  const viewer = harness("debt", { premium: true, viewer: true }); let tree = viewer.render();
  flatten(tree).find(node => node.props?.accessibilityLabel === "Extra debt payment").props.onChangeText("40"); tree = viewer.render();
  const disabled = flatten(tree).find(node => node.props?.accessibilityLabel === "Add extra payment to Forecast"); assert.equal(disabled.props.disabled, true);
  await disabled.props.onPress(); assert.equal(viewer.state.writes.length, 0);
  const owner = harness("debt", { premium: true }); tree = owner.render();
  flatten(tree).find(node => node.props?.accessibilityLabel === "Extra debt payment").props.onChangeText("40"); tree = owner.render();
  const retained = flatten(tree).find(node => node.props?.accessibilityLabel === "Add extra payment to Forecast").props.onPress;
  owner.unmount(); await retained(); assert.equal(owner.state.writes.length, 0);
});
