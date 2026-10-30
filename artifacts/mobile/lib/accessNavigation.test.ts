import { revealedPrivacyBindings, revealedPrivacyModule } from "./privacyTestHarness";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import { SPENDING_BUCKETS_ROUTE, requestedSettingsSection } from "./settingsNavigation";
import { SETTINGS_GROUPS, TOOLS_AND_LISTS, settingsSectionById, visibleSearchSettings, formatCountStatus, attentionCountStatus } from "./settingsHub";
import { buildUniversalSearchIndex } from "./universalSearch";
import * as reviewTools from "./reviewCenter";
import * as transactionNames from "./transactionNames";
import * as targetFilters from "./matchTargetFilters";
import * as bucketTools from "./spendingBuckets";
import * as pendingTools from "./pendingPlanMatches";
import * as billMatching from "./billMatching";
import * as candidateTools from "./billMatchCandidates";
import * as competitiveTools from "./competitiveGrowth";
import * as surplusRouting from "./billSurplusRouting";
import * as snowballFunding from "./snowballFunding";
import * as forecastDisplay from "./forecastDisplay";

function flatten(node: any): any[] {
  return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
}
function text(node: any): string {
  return Array.isArray(node) ? node.map(text).join(" ") : node && typeof node === "object" ? text(node.props?.children) : typeof node === "string" ? node : "";
}

const open = { id: "open", name: "Holiday", goal_type: "planned_expense", target_amount: 200, current_amount: 50, target_date: "2026-11-01" };
const closed = { ...open, id: "closed", name: "Closed trip", closed_at: "2026-10-23" };
const archived = { ...closed, id: "archived", name: "Archived trip", archived_at: "2026-10-23" };
const pending = { id: "bank", source: "plaid", review_status: "needs_review", date: "2026-10-23", amount: -50, note: "Bank charge", category: "Other" };

function reviewHarness(goals: any[] = [open, closed, archived], canEdit = true) {
  const exported: any = {}, states: any[] = [], effects: Array<() => void> = [];
  let cursor = 0, dirty = false, added = 0;
  const budget: any = {
    activeHousehold: { householdId: "home", budgetId: "budget", role: canEdit ? "owner" : "viewer" }, canEditHousehold: canEdit,
    startupCoreReady: true, transactions: [pending], bills: [], incomes: [], goals, decisions: [], extraPayments: [], categories: [], pendingPlanMatches: [],
    settings: { debtPayoffEnabled: false, safety_floor: 200, forecast_horizon_months: 6 },
    getMonthlyBills: () => [], getBillOccurrencesInMonth: () => [], getBillMonthlyTotal: () => 0,
    getExtraPayment: () => null, getRemainingDebtPlanForMonth: () => null,
    refreshBankData: async () => {}, previewDebtSnowball: () => ({ safeMaximum: 0, selectedExtra: 0, months: [], allocations: [] }),
    addGoal: async () => { added++; },
  };
  const React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) };
  const hooks = {
    __esModule: true, default: React,
    useState: (initial: any) => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], (next: any) => { const value = typeof next === "function" ? next(states[index]) : next; if (!Object.is(value, states[index])) { states[index] = value; dirty = true; } }]; },
    useRef: (initial: any) => { const index = cursor++; return states[index] ??= { current: initial }; },
    useMemo: (fn: () => any) => { cursor++; return fn(); },
    useEffect: (fn: () => void, deps: any[]) => { const index = cursor++; if (!states[index] || deps.some((value, i) => !Object.is(value, states[index][i]))) { states[index] = deps; effects.push(fn); } },
  };
  const modules: Record<string, any> = { transactionNames, reviewCenter: reviewTools, matchTargetFilters: targetFilters, spendingBuckets: bucketTools, pendingPlanMatches: pendingTools, billMatching, billMatchCandidates: candidateTools, competitiveGrowth: competitiveTools, billSurplusRouting: surplusRouting, snowballFunding, forecastDisplay };
  const js = transpileModule(readFileSync("components/ReviewCenter.tsx", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  new Function("exports", "require", js)(exported, (name: string) => {
    const privacyModule = revealedPrivacyModule(name);
    if (privacyModule) return privacyModule;
    if (name === "react") return hooks;
    if (name === "react-native") return { ...Object.fromEntries(["View", "Text", "Pressable", "Modal", "ScrollView"].map(value => [value, value])), Alert: { alert() {} }, StyleSheet: { create: (value: any) => value, hairlineWidth: 1 } };
    const leaf = name.split("/").at(-1)!;
    if (leaf === "BucketVisual") return { BucketThumbnail: "BucketThumbnail" };
    if (name.includes("/components/")) return { [leaf]: leaf };
    if (leaf === "BudgetContext") return { useBudget: () => budget };
    if (leaf === "BucketPersonalizationContext") return { useBucketPersonalization: () => ({ available: true, unavailableReason: null, open() {} }) };
    if (leaf === "AuthContext") return { useAuth: () => ({ user: { id: "user" } }) };
    if (leaf === "useLocalDay") return { useLocalDay: () => "2026-10-24" };
    if (leaf === "useColors") return { useColors: () => new Proxy({}, { get: () => "#000000" }) };
    if (leaf === "launchMode") return { FOUNDING_FREE_LAUNCH: true };
    if (leaf === "haptics") return { impactAsync() {}, notificationAsync() {}, ImpactFeedbackStyle: {}, NotificationFeedbackType: {} };
    return modules[leaf] ?? {};
  });
  const render = (mode: "review" | "buckets" = "buckets") => {
    let tree: any;
    for (let attempt = 0; attempt < 5; attempt++) { cursor = 0; dirty = false; tree = exported.ReviewCenter({ viewMode: mode }); effects.splice(0).forEach(fn => fn()); if (!dirty) break; }
    return tree;
  };
  return { budget, render, added: () => added };
}

test("Dashboard bucket shortcuts and bucket search use the same dedicated list destination", () => {
  assert.deepEqual(SPENDING_BUCKETS_ROUTE, { pathname: "/(tabs)/more", params: { section: "buckets" } });
  assert.equal(requestedSettingsSection(["buckets"], undefined), "buckets");
  for (const file of ["app/(tabs)/index.tsx", "components/desktop/DesktopDashboard.tsx"]) {
    const source = readFileSync(file, "utf8"), start = source.indexOf('accessibilityLabel="Open spending buckets"');
    assert.ok(start >= 0); assert.match(source.slice(start, source.indexOf("</Pressable>", start)), /router\.push\(SPENDING_BUCKETS_ROUTE\)/);
  }
  const results = buildUniversalSearchIndex({ bills: [], goals: [open, { ...open, id: "savings", goal_type: "savings" }], transactions: [], categories: [], settings: [] } as any);
  assert.deepEqual(results.find(item => item.id === "open")?.params, SPENDING_BUCKETS_ROUTE.params);
  assert.equal(results.find(item => item.id === "open")?.kind, "Bucket");
  assert.equal(results.find(item => item.id === "open")?.icon, "shopping-bag");
  assert.equal(results.find(item => item.id === "savings")?.kind, "Goal");
  const modalSource = readFileSync("components/UniversalSearchModal.tsx", "utf8");
  assert.match(modalSource, /KIND_ORDER[^\n]*"Bucket"/);
  assert.deepEqual(results.find(item => item.id === "savings")?.params, { section: "goals" });
});

test("Tools and lists has predictable browse destinations without mixing true settings groups", () => {
  assert.deepEqual(TOOLS_AND_LISTS.sectionIds, ["buckets", "goals", "review", "reports", "subscriptions"]);
  assert.equal(settingsSectionById("goals").label, "Savings goals");
  assert.equal(settingsSectionById("buckets").label, "Buckets");
  assert.ok(SETTINGS_GROUPS.every(group => group.sectionIds.every(id => !TOOLS_AND_LISTS.sectionIds.includes(id as any))));
  const source = readFileSync("components/settings/MoreHub.tsx", "utf8");
  assert.match(source, /\[TOOLS_AND_LISTS, \.\.\.visibleSettingsGroups\(isAdmin\)\]\.map/);
});

test("search hides both admin-only destinations from ordinary users and keeps both for admins", () => {
  for (const isAdmin of [false, true]) {
    const results = buildUniversalSearchIndex({ bills: [], goals: [], transactions: [], categories: [], settings: visibleSearchSettings(isAdmin) });
    for (const id of ["admin", "updates"]) assert.equal(results.some(item => item.kind === "Settings" && item.id === id), isAdmin);
    assert.ok(results.some(item => item.kind === "Settings" && item.id === "buckets"));
  }
});

test("bucket mode renders active/closed lists without bank review and supports archived history", () => {
  const harness = reviewHarness(); let tree = harness.render();
  assert.match(text(tree), /Holiday.*Closed trip/); assert.doesNotMatch(text(tree), /Match the bank|Bank charge|You’re caught up/);
  const labels = flatten(tree).map(node => node.props.accessibilityLabel);
  assert.ok(labels.includes("Create spending bucket")); assert.ok(labels.includes("Edit Holiday bucket"));
  for (const node of flatten(tree).filter(node => /^(Edit |Close |Reopen |Delete |Show archived)/.test(node.props.accessibilityLabel ?? ""))) {
    const style = typeof node.props.style === "function" ? node.props.style({ pressed: false }) : node.props.style;
    assert.ok([style].flat(Infinity).some((value: any) => value?.minHeight >= 44));
  }
  flatten(tree).find(node => node.props.accessibilityLabel === "Show archived spending buckets").props.onPress();
  tree = harness.render(); assert.match(text(tree), /Archived trip/);
});

test("empty bucket mode remains actionable and standalone creation retains affordability checks", async () => {
  const harness = reviewHarness([]); let tree = harness.render();
  assert.match(text(tree), /No spending buckets yet/);
  flatten(tree).find(node => node.props.accessibilityLabel === "Create spending bucket").props.onPress();
  tree = harness.render(); const modal = flatten(tree).find(node => node.type === "GoalModal");
  assert.equal(modal.props.visible, true); assert.equal(modal.props.lockedMode, "budget"); assert.equal(modal.props.skipAffordabilityCheck, false);
  const { id, ...draft } = open;
  await modal.props.onSave(draft); assert.equal(harness.added(), 1);
});

test("viewers see bucket balances without mutation controls; review mode still requires an editor", () => {
  const harness = reviewHarness([open], false), tree = harness.render();
  assert.match(text(tree), /Holiday.*Planned.*Spent/);
  assert.equal(flatten(tree).some(node => /^(Create spending|Edit |Close |Reopen |Delete |Archive |Restore )/.test(node.props.accessibilityLabel ?? "")), false);
  assert.match(text(harness.render("review")), /Review Center is read-only/);
});

test("role downgrade closes bucket editing/remainder UI and rejects captured editor saves", async () => {
  const harness = reviewHarness([open]); let tree = harness.render();
  flatten(tree).find(node => node.props.accessibilityLabel === "Create spending bucket").props.onPress();
  tree = harness.render(); const save = flatten(tree).find(node => node.type === "GoalModal").props.onSave;
  flatten(tree).find(node => node.props.accessibilityLabel === "Close Holiday bucket").props.onPress();
  tree = harness.render(); assert.ok(flatten(tree).some(node => node.type === "BillSurplusModal" && node.props.itemType === "bucket" && node.props.visible));
  harness.budget.canEditHousehold = false;
  tree = harness.render(); assert.match(text(tree), /Holiday/);
  assert.equal(flatten(tree).some(node => ["GoalModal", "BillSurplusModal"].includes(node.type) && node.props.visible), false);
  await assert.rejects(save({ ...open, id: undefined }), /household or editing access changed/); assert.equal(harness.added(), 0);
});

test("ordinary review retains its transaction queue and collapsed bucket manager", () => {
  const tree = reviewHarness([open]).render("review");
  assert.match(text(tree), /Match the bank.*Bank charge/);
  assert.equal(flatten(tree).some(node => node.props.accessibilityLabel === "Edit Holiday bucket"), false);
  assert.ok(flatten(tree).some(node => node.props.accessibilityLabel === "Show spending bucket management"));
});


test("Goal editor close requests return to the bucket list with the existing scoped payload", () => {
  const source = readFileSync("components/GoalModal.tsx", "utf8"), start = source.indexOf("  const openCloseBucket =");
  const body = source.slice(start, source.indexOf("  const [name", start));
  const routes: unknown[] = []; let closes = 0;
  const bindings = revealedPrivacyBindings({ SPENDING_BUCKETS_ROUTE, canCloseBucket: true, savingRef: { current: false }, closeNavigationRef: { current: false }, onClose: () => closes++, router: { push: (route: unknown) => routes.push(route) }, currentBucket: { id: "bucket" }, user: { id: "user" }, activeHousehold: { householdId: "home" } });
  const fn = new Function(...Object.keys(bindings), `${transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText}; return openCloseBucket;`)(...Object.values(bindings));
  fn(); fn(); assert.equal(closes, 1); assert.equal(routes.length, 1);
  const route = routes[0] as any; assert.equal(route.params.section, "buckets"); assert.equal(route.params.closeBucketId, "bucket"); assert.equal(route.params.closeBucketScope, "user:home"); assert.ok(route.params.closeBucketAt);
});

test("changing bucket-list household clears old editing state before another household is shown", () => {
  const harness = reviewHarness([open]); let tree = harness.render();
  flatten(tree).find(node => node.props.accessibilityLabel === "Edit Holiday bucket").props.onPress();
  tree = harness.render(); assert.ok(flatten(tree).find(node => node.type === "GoalModal").props.visible);
  harness.budget.activeHousehold = { householdId: "other", budgetId: "other-budget", role: "owner" };
  harness.budget.goals = [];
  tree = harness.render(); assert.match(text(tree), /No spending buckets yet/); assert.doesNotMatch(text(tree), /Holiday/);
  assert.equal(flatten(tree).find(node => node.type === "GoalModal").props.visible, false);
});


test("Tools summaries count savings and active/closed buckets in their own visible lists", () => {
  const source = readFileSync("app/(tabs)/more.tsx", "utf8"), start = source.indexOf("  const hubStatuses =");
  const body = source.slice(start, source.indexOf("  const saveSubscriptionDecisions", start));
  const goals = [{ ...open, id: "savings", goal_type: "savings" }, open, closed, archived];
  const bindings = revealedPrivacyBindings({ goals, growthGoals: goals.filter(goal => goal.goal_type !== "planned_expense"), useMemo: (fn: () => unknown) => fn(), formatCountStatus, attentionCountStatus,
    activeAccounts: [], reviewTransactionCount: 0, subscriptions: [], smartReminders: [], setupIsComplete: true, setupComplete: 0, setupSteps: [], themeMode: "dark", presetName: "FlowLedger", backupExported: false, deletedTransactions: [], membershipStatusLabel: "Free", newFeedbackCount: 0 });
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const statuses = new Function(...Object.keys(bindings), `${js}; return hubStatuses;`)(...Object.values(bindings));
  assert.equal(statuses.goals.label, "1 goal"); assert.equal(statuses.buckets.label, "2 buckets");
  assert.equal(statuses.appearance.label, "FlowLedger");
});


test("closing the standalone bucket editor keeps its copy and affordability mode during dismissal", () => {
  const harness = reviewHarness([]); let tree = harness.render();
  flatten(tree).find(node => node.props.accessibilityLabel === "Create spending bucket").props.onPress();
  tree = harness.render(); let modal = flatten(tree).find(node => node.type === "GoalModal");
  assert.equal(modal.props.visible, true); modal.props.onClose();
  tree = harness.render(); modal = flatten(tree).find(node => node.type === "GoalModal");
  assert.equal(modal.props.visible, false); assert.equal(modal.props.title, "Create spending bucket");
  assert.equal(modal.props.saveLabel, "Create bucket"); assert.equal(modal.props.hint, undefined);
  assert.equal(modal.props.skipAffordabilityCheck, false);
  const editing = reviewHarness([open]); tree = editing.render();
  flatten(tree).find(node => node.props.accessibilityLabel === "Edit Holiday bucket").props.onPress();
  modal = flatten(editing.render()).find(node => node.type === "GoalModal");
  assert.equal(modal.props.editGoal.id, "open"); assert.equal(modal.props.title, undefined);
  assert.equal(modal.props.skipAffordabilityCheck, false);
});
