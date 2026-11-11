import test from "node:test";
import assert from "node:assert/strict";
import { parseAccountBalance, parseCategoryAssignments, reportIncomeUsage } from "./moneyFormInput";
import { buildCategoryPlan } from "./categoryPlanning";
import { readFileSync } from "node:fs";
import { transpileModule, JsxEmit } from "typescript";
import { revealedPrivacyModule } from "./privacyTestHarness";

test("account balance preserves overdrafts and explicit zero but rejects missing or invalid values", () => {
  assert.equal(parseAccountBalance("-125.67"), -125.67);
  assert.equal(parseAccountBalance("0"), 0);
  for (const invalid of ["", " ", "NaN", "Infinity", "12oops"]) assert.equal(parseAccountBalance(invalid), null);
});
test("blank category assignments preserve bill defaults; explicit zero overrides them", () => {
  const budgets = parseCategoryAssignments({ Food: "", Utilities: "0", Debt: "  " });
  assert.deepEqual(budgets, { Utilities: 0 });
  const plan = buildCategoryPlan(["Food", "Utilities"], [{ category: "Food", amount: 250 }, { category: "Utilities", amount: 50 }], [], Object.entries(budgets).map(([category, amount]) => ({ category, amount })));
  assert.equal(plan.find(row => row.category === "Food")?.budgeted, 250);
  assert.equal(plan.find(row => row.category === "Utilities")?.budgeted, 0);
  for (const invalid of ["-1", "Infinity", "12oops"]) assert.throws(() => parseCategoryAssignments({ Food: invalid }));
});
test("reports display overspending percentage without overflowing its bar", () => {
  assert.deepEqual(reportIncomeUsage(100, 125), { label: "125%", barPercent: 100, overIncome: true, watch: true });
  assert.deepEqual(reportIncomeUsage(0, 20), { label: "No recorded income", barPercent: 100, overIncome: true, watch: false });
  assert.deepEqual(reportIncomeUsage(0, 0), { label: "No activity", barPercent: 0, overIncome: false, watch: false });
});

test("Accounts renders authoritative dated balances, never adding already-reconciled activity", () => {
  const source = readFileSync("app/(tabs)/more.tsx", "utf8");
  assert.doesNotMatch(source, /accountMonthDeltas|current_balance\s*\+\s*monthDelta/);
  assert.match(source, /<AccountForecastSettings/);
  const exported: any = {};
  const React = { createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props: { ...props, children } }) };
  let manual: any;
  const js = transpileModule(readFileSync("components/AccountForecastSettings.tsx", "utf8") + "\nexport { AccountPlanningCard };", { compilerOptions: { jsx: JsxEmit.React, module: 1, esModuleInterop: true } }).outputText;
  new Function("exports", "require", js)(exported, (name: string) => {
    const privacy = revealedPrivacyModule(name); if (privacy) return privacy;
    if (name === "react") return { __esModule: true, default: React, useState: (value: any) => [typeof value === "function" ? value() : value, () => {}], useEffect() {}, useRef: (current: unknown) => ({ current }) };
    if (name === "react-native") return { ScrollView: "ScrollView", Switch: "Switch", StyleSheet: { create: (value: unknown) => value } };
    if (name === "expo-router") return { useRouter: () => ({ push() {} }) };
    if (name.endsWith("BudgetContext")) return { useBudget: () => ({ accounts: [manual], transactions: [{ account_id: "checking", date: "2026-09-03", amount: -200 }], accountForecastPreferences: [], hiddenForecastAccountRefs: [], canEditHousehold: true, activeHousehold: { householdId: "fictional-household", budgetId: "fictional-budget" } }) };
    if (name.endsWith("AuthContext")) return { useAuth: () => ({ user: { id: "fictional-user" } }) };
    if (name.endsWith("useColors")) return { useColors: () => new Proxy({}, { get: () => "#000000" }) };
    if (name.endsWith("AccountForecastPicker")) return { accountForecastLabel: (account: any) => account.name };
    return { __esModule: true, default: "Icon" };
  });
  const paint = (currentBalance: number, asOfDate: string | null = "2026-09-09") => {
    manual = { id: "checking", name: "Checking", account_type: "checking", is_active: true, current_balance: currentBalance, balance_as_of: asOfDate };
    return JSON.stringify(exported.AccountPlanningCard({ account: { ref: "manual:checking", name: "Checking", type: "checking", source: "manual", active: true, aliases: ["manual:checking"], manualAccountId: "checking", currentBalance, availableBalance: null, asOfDate, savingsApy: null, safetyFloor: null }, initialOpen: false, onReconcileManualAccount() {} }));
  };
  const text = paint(1000);
  assert.match(text, /1,000\.00/);
  assert.doesNotMatch(text, /800\.00|Proj /);
  assert.match(text, /Balance as of.*2026/);
  assert.match(text, /Reconcile/);
  assert.match(paint(-125, null), /-\$125\.00/);
  assert.match(paint(0, null), /\$0\.00/);
  assert.match(paint(1000, null), /Balance date unavailable/);

});

import { parseMoneyInput, parseDecimalInput } from "./moneyFormInput";
test("strict money fields accept full decimals/grouping without silently parsing prefixes", () => {
  for (const [raw, expected] of [["1,200.50", 1200.5], [" 25.10 ", 25.1], [".50", 0.5], ["0", 0], ["1200", 1200]] as const) assert.equal(parseMoneyInput(raw), expected);
  for (const raw of ["25oops", "1,20.50", "12,34,567", "Infinity", "NaN", "1e3", "-1", "+10", "5.123", "5..2", "", "9007199254740992", "25.", "$25"]) assert.equal(parseMoneyInput(raw), null, raw);
  assert.equal(parseDecimalInput("5.875", 4), 5.875);
});
