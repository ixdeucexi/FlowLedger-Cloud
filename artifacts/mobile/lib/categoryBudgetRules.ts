import { parseMoneyInput } from "./moneyFormInput";
import { normalizeCategoryInput } from "./categoryCatalog";

const MAX_MONTHLY_CATEGORY_BUDGET = 999_999_999_999.99;

/** A saved monthly allowance change. A null amount explicitly clears a limit. */
export interface CategoryBudgetRule {
  category: string;
  amount: number | null;
  effective_month: string;
  repeats: boolean;
}

function cleanAmount(amount: unknown): number | undefined {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return undefined;
  const cents = Math.round((amount + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents / 100 : undefined;
}

function validCategory(category: unknown): category is string {
  return typeof category === "string" && category.trim().length > 0;
}

function validMonth(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2200;
}

/** Parse only edited fields; a blank is an explicit removal rather than zero. */
export function parseCategoryBudgetChanges(
  drafts: Readonly<Record<string, string>>,
  changedCategories: readonly string[],
): Record<string, number | null> {
  const changes = new Map<string, number | null>();
  for (const category of changedCategories) {
    if (!validCategory(category) || !Object.hasOwn(drafts, category) || typeof drafts[category] !== "string") {
      throw new Error(`Check the monthly budget for ${validCategory(category) ? category : "this category"}.`);
    }
    const raw = drafts[category]!;
    if (!raw.trim()) {
      changes.set(category, null);
      continue;
    }
    const amount = parseMoneyInput(raw);
    if (amount === null || amount < 0) {
      throw new Error(`Enter a valid monthly budget for ${category}, with up to two decimal places.`);
    }
    if (amount > MAX_MONTHLY_CATEGORY_BUDGET) {
      throw new Error(`The monthly budget for ${category} cannot exceed $999,999,999,999.99.`);
    }
    changes.set(category, amount);
  }
  return Object.fromEntries(changes);
}

/**
 * Resolve saved allowances without creating rows or changing earlier months.
 * An exact monthly value takes priority over a one-month rule, then the most
 * recent repeating change. Explicit clears suppress older repeating limits.
 */
export function resolveCategoryBudgetRules(
  month: number,
  year: number,
  exactBudgets: Readonly<Record<string, number>>,
  rules: readonly CategoryBudgetRule[],
): Record<string, number> {
  if (!Number.isInteger(month) || month < 0 || month > 11
    || !Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new RangeError("Choose a valid budget month and year.");
  }
  const targetMonth = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const recurring = new Map<string, CategoryBudgetRule>();
  const monthly = new Map<string, CategoryBudgetRule>();

  for (const rule of rules) {
    if (!rule || !validCategory(rule.category) || !validMonth(rule.effective_month)
      || typeof rule.repeats !== "boolean"
      || (rule.amount !== null && cleanAmount(rule.amount) === undefined)
      || rule.effective_month > targetMonth) continue;

    if (rule.repeats) {
      const previous = recurring.get(rule.category);
      if (!previous || rule.effective_month > previous.effective_month) recurring.set(rule.category, rule);
    } else if (rule.effective_month === targetMonth) {
      monthly.set(rule.category, rule);
    }
  }

  const resolved = new Map<string, number>();
  for (const [category, rule] of recurring) {
    if (rule.amount !== null) resolved.set(category, cleanAmount(rule.amount)!);
  }
  for (const [category, rule] of monthly) {
    if (rule.amount === null) resolved.delete(category);
    else resolved.set(category, cleanAmount(rule.amount)!);
  }
  for (const [category, amount] of Object.entries(exactBudgets)) {
    const clean = cleanAmount(amount);
    if (validCategory(category) && clean !== undefined) resolved.set(category, clean);
  }
  return Object.fromEntries(resolved);
}

/** Apply edits without prototype-shaped category names becoming object setters. */
export function applyCategoryBudgetChanges(
  budgets: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number | null>>,
): Record<string, number> {
  const result = new Map(Object.entries(budgets));
  for (const [category, amount] of Object.entries(changes)) {
    if (amount === null) result.delete(category);
    else result.set(category, amount);
  }
  return Object.fromEntries(result);
}

export function changedCategoryBudgets(
  previous: Readonly<Record<string, number>>,
  next: Readonly<Record<string, number>>,
): Record<string, number | null> {
  const before = new Map(Object.entries(previous));
  const after = new Map(Object.entries(next));
  return Object.fromEntries([...new Set([...before.keys(), ...after.keys()])]
    .filter(category => before.get(category) !== after.get(category))
    .map(category => [category, after.get(category) ?? null]));
}

/** Stage explicit zeroes without clearing saved values or inheriting bill defaults. */
export function buildCategoryBudgetRestartDraft(
  categories: readonly string[],
  rows: readonly { category: string; budgeted: number }[],
  savedBudgets: Readonly<Record<string, number>>,
): Record<string, string> {
  const catalog = new Map<string, string>();
  for (const category of categories) {
    const name = normalizeCategoryInput(category);
    const key = name.toLowerCase();
    if (name && key !== "income" && key !== "transfer" && !catalog.has(key)) catalog.set(key, category);
  }
  const names = new Set(catalog.values());
  for (const name of Object.keys(savedBudgets)) {
    const canonical = catalog.get(normalizeCategoryInput(name).toLowerCase());
    if (!canonical) throw new Error("Some saved categories are no longer available. Review categories in Plan settings before starting over.");
    names.add(canonical);
  }
  for (const row of rows) {
    const canonical = catalog.get(normalizeCategoryInput(row.category).toLowerCase());
    if (canonical) names.add(canonical);
    else if (row.budgeted > 0) throw new Error("Some planned categories are no longer available. Review categories in Plan settings before starting over.");
    // Historical activity without a budget stays visible and is never rewritten.
  }
  if (names.size > 500) throw new Error("Start over supports up to 500 categories. Review your categories in Plan settings first.");
  return Object.fromEntries([...names].map(name => [name, "0.00"]));
}
