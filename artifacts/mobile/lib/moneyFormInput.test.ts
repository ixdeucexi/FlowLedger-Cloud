import test from "node:test";
import assert from "node:assert/strict";
import { parseAccountBalance, parseCategoryAssignments, reportIncomeUsage } from "./moneyFormInput";
import { buildCategoryPlan } from "./categoryPlanning";
import { readFileSync } from "node:fs";
import { transpileModule, JsxEmit } from "typescript";
import { dateOnlyToLocalDate } from "./dateLabels";

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
  const start = source.indexOf("{accounts\n", source.indexOf("Forecast confidence:"));
  // Preserve CRLF checkouts too.
  const expressionStart = start >= 0 ? start : source.indexOf("{accounts\r\n", source.indexOf("Forecast confidence:"));
  assert.ok(expressionStart >= 0);
  const end = source.indexOf("{!accounts.some", expressionStart);
  const wrapped = source.slice(expressionStart, end).trim();
  const expression = wrapped.slice(1, -1);
  const js = transpileModule(`return (${expression});`, { compilerOptions: { jsx: JsxEmit.React } }).outputText;
  const render = new Function("accounts", "transactions", "React", "styles", "c", "stackCompactAccountControls", "View", "Text", "Pressable", "Feather", "openAccount", "dateOnlyToLocalDate", js);
  const createElement = (_type: unknown, _props: unknown, ...children: unknown[]) => children;
  const account = { id: "checking", name: "Checking", is_active: true, account_type: "checking", current_balance: 1000, balance_as_of: "2026-09-09" };
  const paint = (value: typeof account) => JSON.stringify(render([value], [{ account_id: "checking", date: "2026-09-03", amount: -200 }], { createElement }, {}, {}, false, "View", "Text", "Pressable", "Feather", () => {}, dateOnlyToLocalDate));
  const text = paint(account);
  assert.match(text, /1000\.00/);
  assert.doesNotMatch(text, /800\.00|Proj /);
  assert.match(text, /Balance as of.*2026/);
  assert.match(text, /Reconcile/);
  assert.match(paint({ ...account, current_balance: -125, balance_as_of: "" }), /-125\.00/);
  assert.match(paint({ ...account, balance_as_of: "" }), /Balance date unknown/);
});
