import test from "node:test";
import assert from "node:assert/strict";
import { applyCategoryBudgetMove, buildCategoryPlan, buildZeroBudgetSummary } from "./categoryPlanning";

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
