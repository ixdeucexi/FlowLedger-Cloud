import test from "node:test";
import assert from "node:assert/strict";
import { applyCategoryBudgetMove, buildCategoryPlan, buildZeroBudgetSummary, categoryBudgetPeriod } from "./categoryPlanning";

test("builds category plan from budgeted bills and actual spending", () => {
  const rows = buildCategoryPlan(
    ["Food", "Utilities"],
    [{ category: "Food", amount: 500 }, { category: "Utilities", amount: 200 }],
    [{ category: "Food", amount: -125 }, { category: "Utilities", amount: -210 }],
  );

  const utilities = rows.find(row => row.category === "Utilities");
  assert.equal(utilities?.status, "over");
  assert.equal(utilities?.remaining, -10);

  const food = rows.find(row => row.category === "Food");
  assert.equal(food?.status, "available");
  assert.equal(food?.percentUsed, 25);
});

test("flags unbudgeted spending as over plan", () => {
  const rows = buildCategoryPlan([], [], [{ category: "Entertainment", amount: -40 }]);
  assert.equal(rows[0]?.category, "Entertainment");
  assert.equal(rows[0]?.budgeted, 0);
  assert.equal(rows[0]?.spent, 40);
  assert.equal(rows[0]?.status, "over");
});

test("watch status starts when category is mostly used", () => {
  const rows = buildCategoryPlan(["Gas"], [{ category: "Gas", amount: 100 }], [{ category: "Gas", amount: -90 }]);
  assert.equal(rows[0]?.status, "watch");
});

test("keeps user categories even when they have no budget or spending yet", () => {
  const rows = buildCategoryPlan(["Food", "Other", "Savings"], [], []);
  assert.deepEqual(rows.map(row => row.category).sort(), ["Food", "Other", "Savings"]);
});

test("explicit category budgets override bill-derived budgets", () => {
  const rows = buildCategoryPlan(
    ["Food"],
    [{ category: "Food", amount: 500 }],
    [{ category: "Food", amount: -125 }],
    [{ category: "Food", amount: 600 }],
  );

  assert.equal(rows[0]?.category, "Food");
  assert.equal(rows[0]?.budgeted, 600);
  assert.equal(rows[0]?.remaining, 475);
  assert.equal(rows[0]?.percentUsed, 21);
});

test("moves budget money between categories using current plan as the baseline", () => {
  const rows = buildCategoryPlan(
    ["Food", "Entertainment"],
    [{ category: "Food", amount: 500 }, { category: "Entertainment", amount: 100 }],
    [],
  );

  const budgets = applyCategoryBudgetMove({}, rows, "Food", "Entertainment", 50);

  assert.equal(budgets.Food, 450);
  assert.equal(budgets.Entertainment, 150);
});

test("ignores invalid category budget moves", () => {
  const rows = buildCategoryPlan(["Food"], [{ category: "Food", amount: 500 }], []);
  assert.deepEqual(applyCategoryBudgetMove({ Food: 500 }, rows, "Food", "Food", 50), { Food: 500 });
  assert.deepEqual(applyCategoryBudgetMove({ Food: 500 }, rows, "Food", "Other", -10), { Food: 500 });
});

test("balances planned income across spending, savings, and debt jobs", () => {
  const rows = buildCategoryPlan(
    ["Housing", "Savings", "Debt"],
    [
      { category: "Housing", amount: 1200 },
      { category: "Debt", amount: 300, is_debt: true },
    ],
    [],
    [
      { category: "Housing", amount: 1200 },
      { category: "Savings", amount: 500 },
      { category: "Debt", amount: 300 },
    ],
  );
  assert.deepEqual(buildZeroBudgetSummary(2000, rows), {
    plannedIncome: 2000,
    assigned: 2000,
    spent: 0,
    leftToAssign: 0,
    status: "balanced",
  });
});

test("distinguishes money left to assign from overassignment", () => {
  const rows = buildCategoryPlan(["Food"], [], [], [{ category: "Food", amount: 600 }]);
  assert.equal(buildZeroBudgetSummary(1000, rows).status, "to_assign");
  assert.equal(buildZeroBudgetSummary(500, rows).status, "overassigned");
});


test("one cent left or over is never presented as a balanced zero budget", () => {
  const rows = buildCategoryPlan(["Savings"], [], [], [{ category: "Savings", amount: 1999.99 }]);
  assert.equal(buildZeroBudgetSummary(2000, rows).leftToAssign, 0.01);
  assert.equal(buildZeroBudgetSummary(2000, rows).status, "to_assign");
  assert.equal(buildZeroBudgetSummary(1999.98, rows).leftToAssign, -0.01);
  assert.equal(buildZeroBudgetSummary(1999.98, rows).status, "overassigned");
});

test("spending affects availability without spending the assignments a second time", () => {
  const allowances = [{ category: "Food", amount: 100 }, { category: "Savings", amount: 900 }];
  const initial = buildCategoryPlan(["Food", "Savings"], [], [], allowances);
  const afterSpending = buildCategoryPlan(["Food", "Savings"], [], [{ category: "Food", amount: -125.37 }], allowances);
  assert.equal(buildZeroBudgetSummary(1000, initial).assigned, 1000);
  assert.equal(buildZeroBudgetSummary(1000, afterSpending).assigned, 1000);
  assert.equal(buildZeroBudgetSummary(1000, afterSpending).leftToAssign, 0);
  assert.equal(afterSpending.find(row => row.category === "Food")?.status, "over");
});

test("moving cents conserves assignments and cannot move money already spent", () => {
  const rows = buildCategoryPlan(["Food", "Savings"], [], [{ category: "Food", amount: -74.63 }], [{ category: "Food", amount: 100 }, { category: "Savings", amount: 900 }]);
  const next = applyCategoryBudgetMove({}, rows, "Food", "Savings", 25.37);
  assert.deepEqual(next, { Food: 74.63, Savings: 925.37 });
  assert.equal(Math.round((next.Food! + next.Savings!) * 100), 100000);
  for (const amount of [25.38, 101, Infinity, NaN, -1, 0, 0.001, 25.375]) {
    assert.deepEqual(applyCategoryBudgetMove({}, rows, "Food", "Savings", amount), {}, String(amount));
  }
});

test("invalid move sources never create money or phantom categories", () => {
  const rows = buildCategoryPlan(["Food", "Savings"], [], [], [{ category: "Food", amount: 100 }]);
  assert.deepEqual(applyCategoryBudgetMove({}, rows, "Missing", "Savings", 10), {});
  assert.deepEqual(applyCategoryBudgetMove({}, rows, "Food", "Missing", 10), {});
  for (const invalid of [NaN, Infinity, -1, 100.001]) {
    const budgets = { Food: invalid };
    assert.deepEqual(applyCategoryBudgetMove(budgets, rows, "Food", "Savings", 10), budgets);
  }
});

test("prototype-shaped category names remain ordinary own values in money moves", () => {
  const rows = buildCategoryPlan(["__proto__", "constructor"], [], [], [{ category: "__proto__", amount: 100 }]);
  const result = applyCategoryBudgetMove({}, rows, "__proto__", "constructor", 25.37);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(Object.entries(result), [["__proto__", 74.63], ["constructor", 25.37]]);
});

test("budget month links validate full month and year together", () => {
  assert.deepEqual(categoryBudgetPeriod("11", "2026"), { month: 11, year: 2026 });
  assert.deepEqual(categoryBudgetPeriod("0", "2027"), { month: 0, year: 2027 });
  for (const pair of [["12", "2026"], ["-1", "2026"], ["1", "1999"], ["1", "2201"], ["1.5", "2026"], [["1"], "2026"], ["1", undefined], ["01", "2026"]]) {
    assert.equal(categoryBudgetPeriod(pair[0], pair[1]), null);
  }
});


test("large valid two-decimal currency moves retain their cents", () => {
  const rows = buildCategoryPlan(["Savings", "Debt"], [], [], [{ category: "Savings", amount: 2345678901.23 }]);
  assert.deepEqual(applyCategoryBudgetMove({}, rows, "Savings", "Debt", 1234567890.12), { Savings: 1111111011.11, Debt: 1234567890.12 });
});

test("aggregated decimal spending stays in cents and leaves valid funds movable", () => {
  const rows = buildCategoryPlan(["Food", "Savings"], [], [
    { category: "Food", amount: -0.10 }, { category: "Food", amount: -0.20 },
  ], [{ category: "Food", amount: 100 }]);
  const food = rows.find(row => row.category === "Food")!;
  assert.equal(food.spent, 0.3);
  assert.equal(food.remaining, 99.7);
  assert.deepEqual(applyCategoryBudgetMove({}, rows, "Food", "Savings", 10), { Food: 90, Savings: 10 });
  assert.deepEqual(applyCategoryBudgetMove({}, rows, "Food", "Savings", 99.70), { Food: 0.3, Savings: 99.7 });
  assert.deepEqual(applyCategoryBudgetMove({}, rows, "Food", "Savings", 99.71), {});
});
