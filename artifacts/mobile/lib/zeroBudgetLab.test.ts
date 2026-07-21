import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyZeroBudgetMoney,
  createZeroBudgetLabState,
  monthlyTarget,
  moveZeroBudgetCategory,
  shiftZeroBudgetMonth,
  summarizeZeroBudget,
} from "./zeroBudgetLab";

describe("admin zero budget lab", () => {
  it("starts from isolated sample money with a ready-to-assign amount", () => {
    const state = createZeroBudgetLabState(new Date(2026, 6, 21));
    const summary = summarizeZeroBudget(state);
    assert.equal(state.selectedMonth, "2026-07");
    assert.equal(summary.income, 3028.42);
    assert.equal(summary.readyToAssign, 595.21);
  });

  it("assigning money reduces ready to assign without changing spending", () => {
    const state = createZeroBudgetLabState(new Date(2026, 6, 21));
    const next = applyZeroBudgetMoney(state, "vacation", 200, "assign");
    assert.equal(summarizeZeroBudget(next).readyToAssign, 395.21);
    assert.equal(summarizeZeroBudget(next).categories.find(row => row.category.id === "vacation")?.spent, 0);
  });

  it("sample spending changes category availability but not ready to assign", () => {
    const state = createZeroBudgetLabState(new Date(2026, 6, 21));
    const next = applyZeroBudgetMoney(state, "groceries", 50, "spend");
    assert.equal(summarizeZeroBudget(next).readyToAssign, summarizeZeroBudget(state).readyToAssign);
    assert.equal(summarizeZeroBudget(next).categories.find(row => row.category.id === "groceries")?.status, "overspent");
  });

  it("weekly targets become four weekly assignments for the monthly plan", () => {
    const state = createZeroBudgetLabState(new Date(2026, 6, 21));
    const groceries = state.categories.find(category => category.id === "groceries")!;
    assert.equal(monthlyTarget(groceries), 40);
  });

  it("month switching preserves targets while starting with fresh assignments", () => {
    const state = createZeroBudgetLabState(new Date(2026, 6, 21));
    const august = { ...state, selectedMonth: shiftZeroBudgetMonth(state.selectedMonth, 1) };
    const summary = summarizeZeroBudget(august);
    assert.equal(august.selectedMonth, "2026-08");
    assert.equal(summary.assigned, 0);
    assert.ok(summary.monthlyTargets > 0);
  });

  it("reorders categories only within their current group", () => {
    const state = createZeroBudgetLabState(new Date(2026, 6, 21));
    const next = moveZeroBudgetCategory(state, "phone", -1);
    assert.deepEqual(next.categories.filter(item => item.groupId === "bills").map(item => item.id), ["phone", "rent", "utilities"]);
  });
});
