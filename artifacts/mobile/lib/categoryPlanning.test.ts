import test from "node:test";
import assert from "node:assert/strict";
import { buildCategoryPlan } from "./categoryPlanning";

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
