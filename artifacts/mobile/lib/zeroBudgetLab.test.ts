import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyZeroBudgetMoney,
  categorizeZeroBudgetTransaction,
  createZeroBudgetLabState,
  monthlyTarget,
  moveZeroBudgetCategory,
  postZeroBudgetTransaction,
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

  it("includes isolated posted and pending transactions for review testing", () => {
    const state = createZeroBudgetLabState(new Date(2026, 6, 21));
    assert.equal(state.transactions.filter(transaction => transaction.status === "needs_review").length, 4);
    assert.equal(state.transactions.filter(transaction => transaction.status === "pending").length, 1);
  });

  it("applies a posted transaction to a category exactly once and supports reassignment", () => {
    const state = createZeroBudgetLabState(new Date(2026, 6, 21));
    const groceryBefore = summarizeZeroBudget(state).categories.find(row => row.category.id === "groceries")!.spent;
    const categorized = categorizeZeroBudgetTransaction(state, "sample-walmart", "groceries");
    assert.equal(summarizeZeroBudget(categorized).categories.find(row => row.category.id === "groceries")?.spent, groceryBefore + 84.02);
    assert.equal(categorized.transactions.find(transaction => transaction.id === "sample-walmart")?.status, "categorized");

    const reassigned = categorizeZeroBudgetTransaction(categorized, "sample-walmart", "dining");
    assert.equal(summarizeZeroBudget(reassigned).categories.find(row => row.category.id === "groceries")?.spent, groceryBefore);
    assert.equal(summarizeZeroBudget(reassigned).categories.find(row => row.category.id === "dining")?.spent, 168.04);
  });

  it("keeps pending activity out of spending until it posts and is categorized", () => {
    const state = createZeroBudgetLabState(new Date(2026, 6, 21));
    const before = summarizeZeroBudget(state).spent;
    const ignored = categorizeZeroBudgetTransaction(state, "sample-apple-pending", "entertainment");
    assert.equal(summarizeZeroBudget(ignored).spent, before);

    const posted = postZeroBudgetTransaction(state, "sample-apple-pending");
    assert.equal(summarizeZeroBudget(posted).spent, before);
    const categorized = categorizeZeroBudgetTransaction(posted, "sample-apple-pending", "entertainment");
    assert.equal(summarizeZeroBudget(categorized).spent, before + 9.99);
  });
});
