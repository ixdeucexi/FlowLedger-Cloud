import test from "node:test";
import assert from "node:assert/strict";
import { applyCategoryBudgetChanges, changedCategoryBudgets, parseCategoryBudgetChanges, resolveCategoryBudgetRules, type CategoryBudgetRule } from "./categoryBudgetRules";

const rule = (category: string, amount: number | null, effective_month: string, repeats = true): CategoryBudgetRule => ({
  category, amount, effective_month, repeats,
});

test("monthly Gas and Kids allowances repeat from their effective month without writes", () => {
  const rules = [rule("Gas", 100, "2026-11-01"), rule("Kids", 50, "2026-11-01")];
  assert.deepEqual(resolveCategoryBudgetRules(9, 2026, {}, rules), {});
  assert.deepEqual(resolveCategoryBudgetRules(10, 2026, {}, rules), { Gas: 100, Kids: 50 });
  assert.deepEqual(resolveCategoryBudgetRules(0, 2027, {}, rules), { Gas: 100, Kids: 50 });
});

test("later repeating changes preserve earlier months and do not depend on query order", () => {
  const rules = [rule("Gas", 120, "2027-01-01"), rule("Gas", 100, "2026-11-01"), rule("Gas", 200, "2027-03-01")];
  assert.deepEqual(resolveCategoryBudgetRules(11, 2026, {}, rules), { Gas: 100 });
  assert.deepEqual(resolveCategoryBudgetRules(0, 2027, {}, rules), { Gas: 120 });
  assert.deepEqual(resolveCategoryBudgetRules(1, 2027, {}, [...rules].reverse()), { Gas: 120 });
});

test("one-month override does not replace the repeating allowance for later months", () => {
  const rules = [rule("Gas", 100, "2026-11-01"), rule("Gas", 75, "2026-12-01", false)];
  assert.deepEqual(resolveCategoryBudgetRules(11, 2026, {}, rules), { Gas: 75 });
  assert.deepEqual(resolveCategoryBudgetRules(0, 2027, {}, rules), { Gas: 100 });
});

test("an exact monthly budget wins over both repeating and one-month rules, including zero", () => {
  const rules = [rule("Gas", 100, "2026-11-01"), rule("Gas", 75, "2026-12-01", false)];
  assert.deepEqual(resolveCategoryBudgetRules(11, 2026, { Gas: 0, Kids: 50 }, rules), { Gas: 0, Kids: 50 });
  assert.deepEqual(resolveCategoryBudgetRules(0, 2027, {}, rules), { Gas: 100 });
});

test("a repeating clear stops the allowance from that month and can later restart", () => {
  const rules = [rule("Gas", 100, "2026-11-01"), rule("Gas", null, "2026-12-01"), rule("Gas", 80, "2027-02-01")];
  assert.deepEqual(resolveCategoryBudgetRules(10, 2026, {}, rules), { Gas: 100 });
  assert.deepEqual(resolveCategoryBudgetRules(11, 2026, {}, rules), {});
  assert.deepEqual(resolveCategoryBudgetRules(0, 2027, {}, rules), {});
  assert.deepEqual(resolveCategoryBudgetRules(1, 2027, {}, rules), { Gas: 80 });
});

test("a one-month clear suppresses the repeating allowance only for that month", () => {
  const rules = [rule("Gas", 100, "2026-11-01"), rule("Gas", null, "2026-12-01", false)];
  assert.deepEqual(resolveCategoryBudgetRules(11, 2026, {}, rules), {});
  assert.deepEqual(resolveCategoryBudgetRules(0, 2027, {}, rules), { Gas: 100 });
  assert.deepEqual(resolveCategoryBudgetRules(11, 2026, { Gas: 60 }, rules), { Gas: 60 });
});

test("zero is a real limit and decimals round to cents", () => {
  const rules = [rule("Gas", 100.125, "2026-11-01"), rule("Kids", 0, "2026-11-01")];
  assert.deepEqual(resolveCategoryBudgetRules(10, 2026, {}, rules), { Gas: 100.13, Kids: 0 });
  assert.deepEqual(resolveCategoryBudgetRules(10, 2026, { Gas: 1.005 }, rules), { Gas: 1.01, Kids: 0 });
});

test("invalid rows cannot erase a previously valid repeating limit", () => {
  const invalid = [
    rule("Gas", -50, "2026-12-01"), rule("Gas", NaN, "2026-12-01"),
    rule("Gas", Infinity, "2026-12-01"), rule("Gas", Number.MAX_VALUE, "2026-12-01"),
    rule("Gas", 300, "2026-13-01"), rule("Gas", 300, "2026-12-02"),
    rule("Gas", 300, "2026-2-01"), rule("Gas", 300, "1999-12-01"),
    rule("Gas", 300, "2201-01-01"), rule(" ", 300, "2026-11-01"),
    { ...rule("Gas", 500, "2026-12-01"), repeats: "true" },
    { ...rule("Gas", 500, "2026-12-01"), amount: "500" },
    null,
  ] as unknown as CategoryBudgetRule[];
  assert.deepEqual(resolveCategoryBudgetRules(11, 2026, { Kids: -1 }, [rule("Gas", 100, "2026-11-01"), ...invalid]), { Gas: 100 });
});

test("resolution preserves canonical names and never mutates rules or exact budgets", () => {
  const exact = Object.freeze({ "Kids / Activities": 50 });
  const rules = Object.freeze([Object.freeze(rule("Gas", 100, "2026-11-01"))]);
  const result = resolveCategoryBudgetRules(10, 2026, exact, rules);
  result.Gas = 200;
  assert.deepEqual(resolveCategoryBudgetRules(10, 2026, exact, rules), { Gas: 100, "Kids / Activities": 50 });
  assert.deepEqual(exact, { "Kids / Activities": 50 });
  assert.equal(rules[0]?.amount, 100);
});

test("category names that match object prototype fields remain ordinary own keys", () => {
  const result = resolveCategoryBudgetRules(10, 2026, {}, [rule("__proto__", 20, "2026-11-01"), rule("constructor", 30, "2026-11-01")]);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.equal(result.__proto__, 20);
  assert.equal(result.constructor, 30);
});

test("invalid target month or year is rejected instead of resolving the wrong period", () => {
  for (const [month, year] of [[-1, 2026], [12, 2026], [0.5, 2026], [NaN, 2026], [0, 1999], [0, 2201], [0, 2026.5]]) {
    assert.throws(() => resolveCategoryBudgetRules(month!, year!, {}, []), RangeError);
  }
});

test("changed monthly budgets preserve blank removals, explicit zero, commas, and cents", () => {
  assert.deepEqual(parseCategoryBudgetChanges({ Gas: "100", Kids: "50.25", Food: "1,250.99", Entertainment: "0", Shopping: "  ", Other: ".50" }, ["Gas", "Kids", "Food", "Entertainment", "Shopping", "Other"]), {
    Gas: 100, Kids: 50.25, Food: 1250.99, Entertainment: 0, Shopping: null, Other: 0.5,
  });
});

test("only changed categories are parsed or included and inputs stay unchanged", () => {
  const drafts = Object.freeze({ Gas: " 100.50 ", Kids: "invalid untouched value", Food: "30" });
  const changed = Object.freeze(["Gas"]);
  assert.deepEqual(parseCategoryBudgetChanges(drafts, changed), { Gas: 100.5 });
  assert.deepEqual(parseCategoryBudgetChanges(drafts, []), {});
  assert.deepEqual(drafts, { Gas: " 100.50 ", Kids: "invalid untouched value", Food: "30" });
  assert.deepEqual(changed, ["Gas"]);
});

test("invalid monthly money fields fail with the edited category name", () => {
  for (const raw of ["-1", "+1", "1.001", "1,00", "1,234,56", "1e2", "0x10", "NaN", "Infinity", "$100", "100abc", "100."]) {
    assert.throws(() => parseCategoryBudgetChanges({ Gas: raw }, ["Gas"]), /monthly budget for Gas/);
  }
});

test("monthly money parser accepts the SQL numeric limit and rejects larger amounts", () => {
  assert.deepEqual(parseCategoryBudgetChanges({ Gas: "999,999,999,999.99" }, ["Gas"]), { Gas: 999_999_999_999.99 });
  for (const raw of ["1,000,000,000,000.00", "1000000000000", "9999999999999.99"]) {
    assert.throws(() => parseCategoryBudgetChanges({ Gas: raw }, ["Gas"]), /monthly budget for Gas.*cannot exceed/);
  }
});

test("a missing changed draft cannot accidentally clear a category budget", () => {
  assert.throws(() => parseCategoryBudgetChanges({ Gas: "100" }, ["Kids"]), /monthly budget for Kids/);
  assert.throws(() => parseCategoryBudgetChanges({}, ["constructor"]), /monthly budget for constructor/);
});


test("changed-only edits preserve prototype-shaped names, removals, zero, and untouched categories", () => {
  const previous = Object.fromEntries([["constructor", 50], ["__proto__", 100], ["Kids", 25]]);
  const changes = Object.fromEntries([["constructor", null], ["__proto__", 0], ["Gas", 100]]);
  const next = applyCategoryBudgetChanges(previous, changes);
  assert.deepEqual(next, Object.fromEntries([["__proto__", 0], ["Kids", 25], ["Gas", 100]]));
  assert.deepEqual(changedCategoryBudgets(previous, next), changes);
  assert.deepEqual(previous, Object.fromEntries([["constructor", 50], ["__proto__", 100], ["Kids", 25]]));
  assert.equal(Object.getPrototypeOf(next), Object.prototype);
  assert.equal(Object.hasOwn(next, "__proto__"), true);
  assert.deepEqual(applyCategoryBudgetChanges({}, Object.fromEntries([["__proto__", 12.34]])), Object.fromEntries([["__proto__", 12.34]]));
});
